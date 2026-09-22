/**
 * db/migrations/031_shipping_rules_ee_tariffs.sql.
 *
 * 030 seeded settings.shipping_rules with the brief's Estonian prices — parcel
 * machine 3.49, courier 5.99 — and that row wins over the code defaults in
 * computeShipping(). Both numbers sat below every sourced Omniva/SmartPosti/DPD
 * tariff for Estonia (docs/shipping.md § «Тарифы Montonio»), so 031 raises them
 * to 5.47 / 10.84 — but only where the row still says the brief's numbers.
 * Whatever the owner has since typed into Настройки → Доставка stays.
 *
 * The runner skips files recorded in _migrations, so to replay 031 against a
 * hand-shaped row these tests forget that one record and run setupDb() again —
 * which is exactly what a production database that ran 030 on 2026-09-03 goes
 * through on its next deploy. 148, 149 and 202 are replayed the same way.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exec, query } from "@/lib/db";
import { DEFAULT_SHIPPING_RULES, parseShippingRules, quoteFromRules, type ShippingRules } from "@/lib/shipping";
import { setupDb, teardownDb } from "./helpers";

const MIGRATION = "031_shipping_rules_ee_tariffs.sql";
/** 148 puts the per-country table into the row 030 seeded. */
const MIGRATION_148 = "148_shipping_country_prices.sql";
/** 149 carries Dim's two answers of 08.09.2026 into the same row. */
const MIGRATION_149 = "149_shipping_free_from_eu_lv_lt_parcel.sql";
/** 202 takes 148's frozen country prices back out, so they follow Montonio again. */
const MIGRATION_202 = "202_shipping_prices_follow_montonio.sql";

type Rules = {
  freeFrom?: number | null;
  freeFromByCountry?: Record<string, number | null>;
  methods: Record<string, Record<string, number>>;
  carriers?: Record<string, Record<string, number>>;
  countriesOff?: string[];
  markup?: { percent: number; fixed: number };
};
type Row = { value: Rules; updated_at: string | Date };

/** What 030 puts in the row — the brief's numbers, EE included. */
const SEED_030: Rules = {
  freeFrom: 59,
  methods: {
    parcel: { default: 4.99, EE: 3.49, LV: 4.99, LT: 4.99 },
    courier: { default: 9.9, EE: 5.99 },
    pickup: { default: 0 },
  },
};

/** …and what 031 leaves of it: the brief's EE numbers raised to the sourced ones. */
const SEED_031: Rules = {
  ...SEED_030,
  methods: {
    ...SEED_030.methods,
    parcel: { ...SEED_030.methods.parcel, EE: 5.47 },
    courier: { ...SEED_030.methods.courier, EE: 10.84 },
  },
};

/**
 * The only numbers a migrated row may still hold under `methods` after 202:
 * the fallback cells and the shop's own three home courier prices.
 */
const METHODS_AFTER_202 = {
  parcel: { default: 4.99 },
  courier: { default: 9.9, EE: 10.84, LV: 9.9, LT: 9.9 },
  pickup: { default: 0 },
};

/** countriesOff compared as a set — parseShippingRules() sorts it, the defaults need not. */
function withSortedOff(rules: ShippingRules): ShippingRules {
  return { ...rules, countriesOff: [...(rules.countriesOff ?? [])].sort() };
}

async function rulesRows(): Promise<Row[]> {
  return query<Row>("select value, updated_at from settings where key = 'shipping_rules'");
}

async function rulesRow(): Promise<Row> {
  const rows = await rulesRows();
  expect(rows).toHaveLength(1);
  return rows[0];
}

/**
 * Put `value` in the row (or drop it), forget `which` ran — one migration or
 * several — and run the migrations again. The runner applies them in file order.
 */
async function replay(value: Rules | null, which: string | string[] = MIGRATION): Promise<string[]> {
  if (value === null) {
    await query("delete from settings where key = 'shipping_rules'");
  } else {
    await query(
      `insert into settings (key, value) values ('shipping_rules', $1::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [JSON.stringify(value)],
    );
  }
  for (const name of Array.isArray(which) ? which : [which]) {
    await query("delete from _migrations where name = $1", [name]);
  }
  return setupDb();
}

describe("a fresh database", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);

  it("bills the sourced EE tariffs, not the brief's", async () => {
    const { value } = await rulesRow();
    // the courier cell is the shop's own price and stays in the row…
    expect(value.methods.courier.EE).toBe(10.84);
    // …the parcel cell follows the code default since 202, and that says 5.47
    expect(value.methods.parcel.EE).toBeUndefined();
    const rules = parseShippingRules(value);
    expect(quoteFromRules(rules, { country: "EE", method: "parcel", subtotal: 10 }).price).toBe(5.47);
    expect(quoteFromRules(rules, { country: "EE", method: "courier", subtotal: 10 }).price).toBe(10.84);
  });

  it("says the same numbers the code falls back to", async () => {
    // What docs/shipping.md promises: a missing row and a freshly migrated one
    // price a basket identically, so a new Railway database and CI's PGlite
    // both bill what DEFAULT_SHIPPING_RULES says. Since 202 the row no longer
    // spells those numbers out — an absent cell IS the default, «пустое поле —
    // цена Montonio» — so what is compared is what the row bills: the row as
    // computeShipping() reads it, against the rules a shop with no row runs on.
    const { value } = await rulesRow();
    expect(value.freeFrom).toBe(DEFAULT_SHIPPING_RULES.freeFrom);
    expect(withSortedOff(parseShippingRules(value))).toEqual(withSortedOff(DEFAULT_SHIPPING_RULES));
  });

  it("holds no country price but the shop's three home couriers", async () => {
    // A number in the row is an override, and an override does not move when
    // Montonio's tariff moves — which is how 148's cells kept the 30 cm cube's
    // prices on the bill after the 22.09.2026 re-quote. EE 10.84 and LV/LT 9.90
    // are the shop's own, not Montonio's, so they are the only ones left.
    const { value } = await rulesRow();
    expect(value.methods).toEqual(METHODS_AFTER_202);
  });

  it("switches off the seven countries Montonio cannot reach", async () => {
    const { value } = await rulesRow();
    expect([...(value.countriesOff ?? [])].sort()).toEqual(
      [...(DEFAULT_SHIPPING_RULES.countriesOff ?? [])].sort(),
    );
  });

  it("asks 200 € for free delivery outside the Baltics and Finland", async () => {
    const { value } = await rulesRow();
    expect(value.freeFromByCountry).toEqual(DEFAULT_SHIPPING_RULES.freeFromByCountry);
    expect(value.freeFromByCountry).toEqual({ EU: 200 });
    // …and the four home rows keep the 59 € they have always had
    expect(value.freeFrom).toBe(59);
  });
});

/*
 * 148 is the migration that actually changes what the live shop charges: the
 * row 030 seeded wins over DEFAULT_SHIPPING_RULES in computeShipping(), so a
 * database that ran 030 keeps billing 9.90 € to Greece however the code
 * defaults move. It fills only the cells that are missing.
 *
 * Which was also its flaw: the numbers it fills in are one day's tariff, and
 * they stay that day's tariff. 202 takes them back out — see further down.
 */
describe("replaying 148 over a row 030 already seeded", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);

  it("gives every country Montonio serves a price of its own", async () => {
    const applied = await replay(SEED_030, MIGRATION_148);
    expect(applied).toEqual([MIGRATION_148]);

    const { value } = await rulesRow();
    expect(value.methods.courier.GR).toBe(43.19);
    expect(value.methods.courier.DE).toBe(22.29);
    expect(value.methods.parcel.HR).toBe(59.59);
    // and the fallback cells are still the fallback cells
    expect(value.methods.courier.default).toBe(9.9);
    expect(value.methods.parcel.default).toBe(4.99);
    expect(value.methods.pickup).toEqual({ default: 0 });
  });

  it("leaves a price the owner has already set alone", async () => {
    await replay(
      {
        ...SEED_030,
        methods: {
          ...SEED_030.methods,
          courier: { ...SEED_030.methods.courier, DE: 14.9, GR: 9.9 },
        },
      },
      MIGRATION_148,
    );
    const { value } = await rulesRow();
    expect(value.methods.courier.DE).toBe(14.9);
    expect(value.methods.courier.GR).toBe(9.9);
    // …and still fills the countries he never touched
    expect(value.methods.courier.SE).toBe(21.59);
  });

  it("never moves the free-delivery threshold — that is the owner's decision", async () => {
    const owners: Rules = {
      ...SEED_030,
      freeFrom: 79,
      freeFromByCountry: { EU: 150, GR: null },
      carriers: { omniva: { EE: 3.29 } },
      markup: { percent: 10, fixed: 0.5 },
    };
    await replay(owners, MIGRATION_148);
    const { value } = await rulesRow();
    expect(value.freeFrom).toBe(79);
    expect(value.freeFromByCountry).toEqual({ EU: 150, GR: null });
    expect(value.carriers).toEqual({ omniva: { EE: 3.29 } });
    expect(value.markup).toEqual({ percent: 10, fixed: 0.5 });
  });

  it("takes the owner's answer about switched-off countries, empty included", async () => {
    await replay({ ...SEED_030, countriesOff: [] }, MIGRATION_148);
    expect((await rulesRow()).value.countriesOff).toEqual([]);

    await replay({ ...SEED_030, countriesOff: ["GB"] }, MIGRATION_148);
    expect((await rulesRow()).value.countriesOff).toEqual(["GB"]);
  });

  it("is idempotent — running its SQL again changes no price", async () => {
    await replay(SEED_030, MIGRATION_148);
    const before = await rulesRow();

    const sql = readFileSync(new URL(`../db/migrations/${MIGRATION_148}`, import.meta.url), "utf8");
    await exec(sql);

    expect((await rulesRow()).value).toEqual(before.value);
  });

  it("does not invent a row where there is none", async () => {
    const applied = await replay(null, MIGRATION_148);
    expect(applied).toEqual([MIGRATION_148]);
    expect(await rulesRows()).toHaveLength(0);
  });
});

/*
 * 149 is Dim's two answers of 08.09.2026 (docs/audit/2026-09-07-eu-rates.md,
 * questions 2 and 5): free delivery outside the Baltics and Finland starts at
 * 200 €, and the Latvian and Lithuanian parcel machine goes 4.99 → 5.59,
 * because the dearest locker a shopper there can pick costs the shop 5.58.
 * Neither cell is new — 030 seeded the parcel prices and nothing has ever
 * written freeFromByCountry — so the guards are «still says 4.99» and «has no
 * Europe threshold at all», not 148's «is missing».
 */
describe("replaying 149 over a row 030 already seeded", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);

  it("raises the Baltic parcel cells and gives Europe a floor of its own", async () => {
    const applied = await replay(SEED_030, MIGRATION_149);
    expect(applied).toEqual([MIGRATION_149]);

    const { value } = await rulesRow();
    expect(value.methods.parcel.LV).toBe(5.59);
    expect(value.methods.parcel.LT).toBe(5.59);
    expect(value.freeFromByCountry).toEqual({ EU: 200 });
    // the home floor, the courier table and the fallback cell are not its business
    expect(value.freeFrom).toBe(59);
    expect(value.methods.courier).toEqual(SEED_030.methods.courier);
    expect(value.methods.parcel.default).toBe(4.99);
  });

  it("leaves a parcel price the owner has already typed alone, one cell at a time", async () => {
    await replay(
      {
        ...SEED_030,
        methods: { ...SEED_030.methods, parcel: { ...SEED_030.methods.parcel, LV: 6.9 } },
      },
      MIGRATION_149,
    );
    const { value } = await rulesRow();
    expect(value.methods.parcel.LV).toBe(6.9);
    expect(value.methods.parcel.LT).toBe(5.59);
  });

  it("leaves a Europe threshold the owner has already set alone", async () => {
    await replay({ ...SEED_030, freeFrom: 79, freeFromByCountry: { EU: 150 } }, MIGRATION_149);
    const { value } = await rulesRow();
    expect(value.freeFromByCountry).toEqual({ EU: 150 });
    expect(value.freeFrom).toBe(79);
  });

  it("adds Europe beside a threshold he set for somewhere else", async () => {
    await replay({ ...SEED_030, freeFromByCountry: { FI: 99 } }, MIGRATION_149);
    expect((await rulesRow()).value.freeFromByCountry).toEqual({ FI: 99, EU: 200 });
  });

  it("is idempotent — running its SQL again changes nothing, not even updated_at", async () => {
    await replay(SEED_030, MIGRATION_149);
    const before = await rulesRow();

    const sql = readFileSync(new URL(`../db/migrations/${MIGRATION_149}`, import.meta.url), "utf8");
    await exec(sql);

    const after = await rulesRow();
    expect(after.value).toEqual(before.value);
    expect(new Date(after.updated_at).getTime()).toBe(new Date(before.updated_at).getTime());
  });

  it("does not invent a row where there is none", async () => {
    const applied = await replay(null, MIGRATION_149);
    expect(applied).toEqual([MIGRATION_149]);
    expect(await rulesRows()).toHaveLength(0);
  });
});

/*
 * 202, 22.09.2026. Renat measured his carton — 25 × 18 × 8 cm — and the tariff
 * table, quoted until then for a 30 cm cube that only fits DPD's biggest
 * drawer, was re-quoted for it: every international price fell one or more
 * size tiers. None of it reached a customer, because the cells 148 wrote win
 * over DEFAULT_SHIPPING_RULES. «Пустое поле — цена Montonio»: 202 deletes every
 * per-country cell that still says exactly what 148 wrote (for the LV/LT parcel
 * machine, what 149 wrote), so an untouched cell follows Montonio again and a
 * typed one stays. The three home couriers stay too — EE 10.84, LV/LT 9.90 are
 * the shop's own price, and without them the read would charge Montonio's
 * 6.89 / 8.09.
 */
describe("replaying 202 over a row carrying 148's numbers", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);

  /** What 030 → 031 → 148 → 149 leave: the live shop's row before 202. */
  async function rowBefore202(): Promise<Rules> {
    await replay(SEED_031, [MIGRATION_148, MIGRATION_149]);
    return (await rulesRow()).value;
  }

  it("takes out every cell that still says what 148 or 149 wrote", async () => {
    const before = await rowBefore202();
    // the 30 cm cube's prices, frozen into the row — a cell for every country
    expect(before.methods.courier.DE).toBe(22.29);
    expect(before.methods.parcel.PL).toBe(17.89);
    expect(before.methods.parcel.LV).toBe(5.59); // 149's literal
    expect(Object.keys(before.methods.parcel)).toHaveLength(1 + 22);
    expect(Object.keys(before.methods.courier)).toHaveLength(1 + 25);

    const applied = await replay(before, MIGRATION_202);
    expect(applied).toEqual([MIGRATION_202]);

    const { value } = await rulesRow();
    expect(value.methods).toEqual(METHODS_AFTER_202);
    // what 148 and 149 decided that is not a price is not 202's business
    expect(value.countriesOff).toEqual(before.countriesOff);
    expect(value.freeFromByCountry).toEqual({ EU: 200 });
    expect(value.freeFrom).toBe(59);
  });

  it("bills the carton, not the cube, once the cells are gone", async () => {
    const before = await rowBefore202();
    const price = (rules: ShippingRules, country: string, method: string) =>
      quoteFromRules(rules, { country, method, subtotal: 10 }).price;
    const stale = parseShippingRules(before);
    expect(price(stale, "DE", "courier")).toBe(22.29);
    expect(price(stale, "PL", "parcel")).toBe(17.89);

    await replay(before, MIGRATION_202);
    const now = parseShippingRules((await rulesRow()).value);
    expect(price(now, "DE", "courier")).toBe(DEFAULT_SHIPPING_RULES.methods.courier.DE);
    expect(price(now, "PL", "parcel")).toBe(DEFAULT_SHIPPING_RULES.methods.parcel.PL);
    expect(now.methods).toEqual(DEFAULT_SHIPPING_RULES.methods);
    // …and the home prices did not move a cent
    expect(price(now, "EE", "courier")).toBe(10.84);
    expect(price(now, "LV", "courier")).toBe(9.9);
    expect(price(now, "EE", "parcel")).toBe(5.47);
    expect(price(now, "LT", "parcel")).toBe(5.59);
  });

  it("keeps a cell the owner changed, one cell at a time", async () => {
    const before = await rowBefore202();
    await replay(
      {
        ...before,
        methods: {
          ...before.methods,
          courier: { ...before.methods.courier, DE: 25, FR: 24.2 },
          parcel: { ...before.methods.parcel, PL: 9.99, LV: 4.99 },
        },
      },
      MIGRATION_202,
    );
    const { value } = await rulesRow();
    expect(value.methods.courier.DE).toBe(25);
    // a cent off 148's 24.19 is still a number somebody typed
    expect(value.methods.courier.FR).toBe(24.2);
    expect(value.methods.parcel.PL).toBe(9.99);
    // 4.99 IS 148's literal for LV — but 149 replaced every 4.99 it found
    // there, so one that is back was typed, and it stays
    expect(value.methods.parcel.LV).toBe(4.99);
    // …while the cells beside them that nobody touched go
    expect(value.methods.courier.PL).toBeUndefined();
    expect(value.methods.courier.GR).toBeUndefined();
    expect(value.methods.parcel.LT).toBeUndefined();
    expect(value.methods.parcel.DE).toBeUndefined();
    expect(value.methods.courier.EE).toBe(10.84);
  });

  it("compares numbers by value — 29.790 is the 29.79 148 wrote", async () => {
    await rowBefore202();
    await query(
      `update settings set value = jsonb_set(value, '{methods,parcel,DE}', '29.790'::jsonb)
        where key = 'shipping_rules'`,
    );
    await query("delete from _migrations where name = $1", [MIGRATION_202]);
    await setupDb();
    expect((await rulesRow()).value.methods.parcel.DE).toBeUndefined();
  });

  it("leaves the rest of the owner's table alone", async () => {
    const before = await rowBefore202();
    const owners: Rules = {
      ...before,
      freeFrom: 79,
      freeFromByCountry: { EU: 150, GR: null },
      countriesOff: ["GB"],
      // 12.39 is 148's FI parcel literal — under `carriers` it is not 202's
      carriers: { omniva: { EE: 3.29 }, dpd: { FI: 12.39 } },
      markup: { percent: 10, fixed: 0.5 },
      methods: {
        parcel: { ...before.methods.parcel, default: 5.99 },
        courier: { ...before.methods.courier, default: 12.9 },
        pickup: { default: 1.5 },
      },
    };
    await replay(owners, MIGRATION_202);
    const { value } = await rulesRow();
    expect(value).toEqual({
      ...owners,
      methods: {
        parcel: { default: 5.99 },
        courier: { default: 12.9, EE: 10.84, LV: 9.9, LT: 9.9 },
        pickup: { default: 1.5 },
      },
    });
  });

  it("is idempotent — running its SQL twice changes nothing, not even updated_at", async () => {
    const before = await rowBefore202();
    await replay(before, MIGRATION_202);
    const once = await rulesRow();

    const sql = readFileSync(new URL(`../db/migrations/${MIGRATION_202}`, import.meta.url), "utf8");
    await exec(sql);

    const twice = await rulesRow();
    expect(twice.value).toEqual(once.value);
    expect(new Date(twice.updated_at).getTime()).toBe(new Date(once.updated_at).getTime());
  });

  it("does not invent a row where there is none", async () => {
    const applied = await replay(null, MIGRATION_202);
    expect(applied).toEqual([MIGRATION_202]);
    expect(await rulesRows()).toHaveLength(0);
  });
});

describe("replaying 031 over a row 030 already seeded", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);

  it("raises the brief's EE numbers and nothing else", async () => {
    const applied = await replay(SEED_030);
    expect(applied).toEqual([MIGRATION]);

    const { value } = await rulesRow();
    expect(value.methods.parcel.EE).toBe(5.47);
    expect(value.methods.courier.EE).toBe(10.84);
    // LV/LT, the defaults and the threshold are the owner's call, not this file's
    expect(value.methods.parcel).toMatchObject({ default: 4.99, LV: 4.99, LT: 4.99 });
    expect(value.methods.courier.default).toBe(9.9);
    expect(value.methods.pickup).toEqual({ default: 0 });
    expect(value.freeFrom).toBe(59);
  });

  it("leaves EE prices the admin has already changed alone", async () => {
    await replay({
      ...SEED_030,
      methods: {
        ...SEED_030.methods,
        parcel: { ...SEED_030.methods.parcel, EE: 4.2 },
        courier: { ...SEED_030.methods.courier, EE: 8 },
      },
    });
    const { value } = await rulesRow();
    expect(value.methods.parcel.EE).toBe(4.2);
    expect(value.methods.courier.EE).toBe(8);
  });

  it("judges each EE cell on its own — an edited parcel price does not shield the courier", async () => {
    await replay({
      ...SEED_030,
      methods: { ...SEED_030.methods, parcel: { ...SEED_030.methods.parcel, EE: 4.2 } },
    });
    const { value } = await rulesRow();
    expect(value.methods.parcel.EE).toBe(4.2);
    expect(value.methods.courier.EE).toBe(10.84);
  });

  it("keeps the rest of the owner's table — thresholds, carriers, markup — intact", async () => {
    const owners: Rules = {
      ...SEED_030,
      freeFrom: 79,
      freeFromByCountry: { FI: 99, LV: null },
      carriers: { omniva: { EE: 3.29 }, dpd: { default: 6.5 } },
      markup: { percent: 10, fixed: 0.5 },
    };
    await replay(owners);
    const { value } = await rulesRow();
    expect(value).toEqual({
      ...owners,
      methods: {
        ...owners.methods,
        parcel: { ...owners.methods.parcel, EE: 5.47 },
        courier: { ...owners.methods.courier, EE: 10.84 },
      },
    });
  });

  it("is idempotent — running its SQL again changes nothing, not even updated_at", async () => {
    await replay(SEED_030);
    const before = await rulesRow();

    const sql = readFileSync(new URL(`../db/migrations/${MIGRATION}`, import.meta.url), "utf8");
    await exec(sql);

    const after = await rulesRow();
    expect(after.value).toEqual(before.value);
    expect(new Date(after.updated_at).getTime()).toBe(new Date(before.updated_at).getTime());
  });

  it("does not invent a row where there is none — the code defaults price that shop", async () => {
    const applied = await replay(null);
    expect(applied).toEqual([MIGRATION]);
    expect(await rulesRows()).toHaveLength(0);
  });
});
