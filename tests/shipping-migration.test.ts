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
 * through on its next deploy.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exec, query } from "@/lib/db";
import { DEFAULT_SHIPPING_RULES } from "@/lib/shipping";
import { setupDb, teardownDb } from "./helpers";

const MIGRATION = "031_shipping_rules_ee_tariffs.sql";

type Rules = {
  freeFrom?: number | null;
  freeFromByCountry?: Record<string, number | null>;
  methods: Record<string, Record<string, number>>;
  carriers?: Record<string, Record<string, number>>;
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

async function rulesRows(): Promise<Row[]> {
  return query<Row>("select value, updated_at from settings where key = 'shipping_rules'");
}

async function rulesRow(): Promise<Row> {
  const rows = await rulesRows();
  expect(rows).toHaveLength(1);
  return rows[0];
}

/** Put `value` in the row (or drop it), forget 031 ran, run the migrations again. */
async function replay(value: Rules | null): Promise<string[]> {
  if (value === null) {
    await query("delete from settings where key = 'shipping_rules'");
  } else {
    await query(
      `insert into settings (key, value) values ('shipping_rules', $1::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [JSON.stringify(value)],
    );
  }
  await query("delete from _migrations where name = $1", [MIGRATION]);
  return setupDb();
}

describe("a fresh database", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);

  it("carries the sourced EE tariffs, not the brief's", async () => {
    const { value } = await rulesRow();
    expect(value.methods.parcel.EE).toBe(5.47);
    expect(value.methods.courier.EE).toBe(10.84);
  });

  it("says the same numbers the code falls back to", async () => {
    // What docs/shipping.md promises: a missing row and a freshly migrated one
    // price a basket identically, so a new Railway database and CI's PGlite
    // both bill what DEFAULT_SHIPPING_RULES says.
    const { value } = await rulesRow();
    expect(value.freeFrom).toBe(DEFAULT_SHIPPING_RULES.freeFrom);
    expect(value.methods).toEqual(DEFAULT_SHIPPING_RULES.methods);
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
