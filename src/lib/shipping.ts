import { query } from "@/lib/db";
import {
  carrierPrice,
  carrierPriceTable,
  CARRIER_CHOICE_COUNTRIES,
  countryPriceTable,
  methodPrice,
  MONTONIO_NOT_SERVED,
  PICKUP_POINT_COUNTRIES,
  SHOP_CARRIERS,
} from "@/lib/shipping/country-prices";

/**
 * What a delivery costs.
 *
 * The numbers live in the database (`settings.shipping_rules`) so Renat can
 * change them from the admin without a deploy; the defaults below are what the
 * shop charges until he does. Every read is fail-soft: no database, no row,
 * malformed JSON — all of them fall back to the defaults rather than refusing
 * to price a basket. A checkout that cannot quote shipping is a checkout that
 * cannot take money.
 *
 * The same rules are mirrored into the storefront through /api/overrides, so
 * the summary the shopper watches and the total the server bills agree.
 */

export type ShipMethod = "parcel" | "courier" | "pickup";

export interface ShippingRules {
  /**
   * Basket subtotal (EUR, pre-discount) at or above which delivery is free.
   *
   * Three readings, and the admin's «Бесплатно от» box says all three:
   *   · a number — free from that subtotal up;
   *   · `0` — free always, from the first cent;
   *   · `null` — never free (the box left empty).
   */
  freeFrom: number | null;
  /**
   * Override of freeFrom by country **or by zone**, e.g. { "EU": 200 } for all
   * of Europe and { "GR": null } for «never free to Greece»; a country's own
   * key beats its zone's, and a country with no key of its own inherits — the
   * panel shows what it inherits rather than an empty box. Same three readings
   * as freeFrom above. Defaults to { "EU": 200 } — see below.
   */
  freeFromByCountry?: Record<string, number | null>;
  /**
   * price[method][ISO country] with a "default" fallback per method.
   *
   * `courier` is the rate screen's own «Курьер» column. `parcel` is **not** a
   * column any more (14.09.2026): the shopper picks a carrier chip in EE, LV,
   * LT and FI and `carriers` below bills that, and no other country offers a
   * parcel machine at all — so the column the owner read as «цена пакомата»
   * was the one number in the table almost nobody paid. It stays in the data
   * and stays honoured, because it is still the price of the deliveries that
   * reach it: a parcel tagged with a carrier the tariff table has no cell for
   * — an old order's Venipak, since 14.09.2026, or a Finnish Nova Post locker
   * Montonio prices no route to — and a method string `normalizeMethod()`
   * could only read as «parcel». Removing the key would change those bills;
   * removing the column changed none.
   * `pickup` is free before any table is read — see quoteFromRules().
   */
  methods: Record<ShipMethod, Record<string, number>>;
  /** Optional per-carrier override of the method price, same shape. */
  carriers?: Record<string, Record<string, number>>;
  /**
   * ISO codes the shop does not deliver to at all — the checkout's country
   * list drops them. Defaults to the seven European countries Montonio has no
   * route to (MONTONIO_NOT_SERVED): an order to Cyprus, Malta, Iceland,
   * Liechtenstein, Norway, Switzerland or the UK could be placed and paid for
   * but never posted, so offering it is a promise the shop cannot keep.
   *
   * Off is a *storefront* switch, not a pricing one: quoteFromRules() still
   * prices a basket for a switched-off country, because a checkout that
   * refuses to quote is a checkout that cannot take money. The *order* is a
   * different question, and since 17.09.2026 createOrder() refuses one
   * (`country_off`) for any method that actually posts a parcel: the dropdown
   * keeps a country the shopper has already picked, so a saved address or a
   * tab left open over the switch could otherwise buy a delivery Montonio will
   * not carry. Use `countryOff()` to ask.
   */
  countriesOff?: string[];
  /**
   * Countries where the checkout must **not** offer a pickup point, even
   * though Montonio has one and the mirror prices it.
   *
   * Ренат, 18.09.2026: «open every country DPD serves». Until that day the
   * checkout drew a locker only in EE, LV, LT and FI and every other country
   * got one courier line — not because Montonio blocks it (it does not:
   * `parcelMachine` is a *subtype*, and a DPD locker in Italy books as
   * `{type:"pickupPoint", id:<point uuid>}`, which is what this shop already
   * sends) but because nobody had opened them. `PICKUP_POINT_COUNTRIES` is now
   * the whole list, derived from the tariff mirror.
   *
   * Written down as the **exceptions**, exactly like `countriesOff` beside it,
   * and for one reason: it is the shape that lets him narrow the list without
   * a deploy while still letting a country the mirror gains later open by
   * itself. An inclusion list frozen into a stored row would do neither.
   * Empty — the default — means every country on that list is open.
   *
   * A *storefront* switch, like `countriesOff`: `quoteFromRules()` still
   * prices a parcel machine for a country that is off, because the price of a
   * delivery is not the question of whether it is offered, and an order that
   * somehow carries one is priced rather than refused.
   */
  pickupOff?: string[];
  /* `markup` — percent + fixed, added to a Montonio tariff on the way to a
     shelf price — was a key here until 14.09.2026. Ренат: «it seems to me that
     this delivery is a bit over engineered». It was: its boxes changed no
     bill. The only price path it had was the empty-carrier-cell fallback in
     quoteFromRules(), and no shop has an empty carrier cell — parse() merges
     carrierPriceTable() in before the stored row — so its whole visible job
     was feeding «Заполнить по тарифам Montonio», a button whose numbers are
     now the default. Gone with it. A stored row that still carries the key
     parses exactly as one that never had it. */
}

export interface ShippingInput {
  country: string;
  /**
   * "parcel" | "courier" | "pickup", or the storefront's own label — orders.ts
   * passes through whatever the checkout sent ("Пакомат Omniva", "kuller"),
   * so this is normalised rather than trusted.
   */
  method: ShipMethod | string;
  /** Basket subtotal in EUR, before discount. */
  subtotal: number;
  carrier?: string;
}

export interface ShippingQuote {
  price: number;
  free: boolean;
  /** The threshold that applied, so the UI can say "another 12 € to go". */
  freeFrom: number | null;
  method: ShipMethod;
  country: string;
  carrier?: string;
  currency: "EUR";
  /** Where the numbers came from — surfaced in the API for debugging. */
  source: "settings" | "defaults";
}

/**
 * One price per country, from Montonio's own contract prices — Dim's decision
 * of 07.09.2026, «real per-country prices».
 *
 * Until then the shop charged one 9.90 € courier rate for the whole of Europe
 * against a real cost of 8.00 € to 43.15 €, and 59 € of free delivery on top
 * of it, so a 59 € basket to Croatia could cost nearly 59 € to send. The gap
 * was found in docs/audit/2026-09-07-shipping-returns.md; what closes it is
 * `countryPriceTable()` in src/lib/shipping/country-prices.ts, which turns the
 * tariff table into one cell per country per method, and `quoteFromRules()`
 * below, which reads a country's own cell before its zone's.
 *
 * **The audit's cost column was optimistic and this table is not.** It quoted
 * the cheapest carrier Montonio prices for each route — which for Germany,
 * Italy, Poland and half the others is **Nova Post** (Montonio International
 * Shipping). The shop offers Nova Post again since 14.09.2026 («From montonio
 * page there is Nova Post, so keep it actually»), but only as a chip a shopper
 * taps under «Пакомат» in EE, LV and LT: it prices itself and nothing else.
 * Those low numbers are still not the basis of any country's price, because
 * the basis is the carrier *Renat* picks at the label and Nova Post takes no
 * returns at all — see CHIP_ONLY_CARRIERS in
 * src/lib/shipping/country-prices.ts. Against the carriers a country price is
 * computed from, the cheapest courier to Poland is 20.66 €, not 8.51 €. So
 * 9.90 € covered the courier in **no** European country — not even the one the
 * audit found it covered.
 *
 * What is kept deliberately:
 *   · **EE 5.47 / 10.84 and the LV, LT courier at 9.90.** All three sit above
 *     cost already (a parcel machine in Estonia costs 2.47–3.10 €, a courier
 *     to Latvia 8.00 €), and dropping a home price to match cost is a revenue
 *     cut nobody asked for.
 *   · **The `EU` and `default` cells, 4.99 / 9.90.** They are the fallback the
 *     brief asks to keep: any destination the tariff table has no row for
 *     still gets a price rather than a blank.
 *
 * What changes for a shopper: Finland and the twenty-one other European
 * countries Montonio serves stop being one number. Finland's courier goes
 * 9.90 → 15.69 €, Germany's 9.90 → 22.29 €, Greece's 9.90 → 43.19 €. The
 * before/after table for all twenty-five is in
 * docs/audit/2026-09-07-eu-rates.md.
 *
 * ## The two numbers that were the owner's to give — Dim, 08.09.2026
 *
 * That audit left the free-delivery threshold and the two Baltic parcel cells
 * unanswered on purpose (its questions 2 and 5), because how much delivery to
 * give away is not a decision this file should make. Both came back:
 *
 *   · **«Rest of EU — from €200»** — `freeFromByCountry: { EU: 200 }` below.
 *     Estonia, Latvia, Lithuania and Finland keep the 59 € they have always
 *     had; every European country without a row of its own now has to reach
 *     200 € before the shop pays for the parcel. What it fixes: a 59 € basket
 *     to Greece shipped free against a 43.15 € courier, so a bigger order
 *     earned the shop less than a smaller one — 73 % of the basket, and worse
 *     in Ireland, Portugal and Romania.
 *   · **LV and LT parcel machines, 4.99 → 5.59.** The last two cells sold
 *     below cost. The dearest carrier a Latvian or Lithuanian shopper can pick
 *     under «Пакомат» is DPD at 5.58 (he picks, so the price has to cover him
 *     — costBasis() in ./shipping/country-prices), and 5.59 is the first price
 *     ending in nine cents that covers it. Renat was not asked to lose 59
 *     cents an order.
 */
const COUNTRY_PRICES = countryPriceTable();

export const DEFAULT_SHIPPING_RULES: ShippingRules = {
  freeFrom: 59,
  /* The Baltics and Finland at 59 €, the rest of Europe at 200 € — Dim's
     answer of 08.09.2026, above. Only the `EU` zone gets a key: EE, LV, LT and
     FI are meant to fall through to `freeFrom`, and there is deliberately no
     `default` one, because the admin's «Остальные страны» row edits `freeFrom`
     itself (shipFreeCell() in public/shop2/app.js) — a threshold parked under
     `default` would be one the panel could neither show nor change, which is
     the one thing the whole rules table exists to avoid. */
  freeFromByCountry: { EU: 200 },
  methods: {
    /* Spread first, home prices second. EE and the LV/LT courier are held at a
       number of the shop's own; LV and LT parcel now agree with the table to
       the cent (5.58 → 5.59) and are still written out, because the storefront
       mirror and db/migrations/149 carry the same literal and three files that
       must say one number should say it the same way. */
    parcel: { default: 4.99, ...COUNTRY_PRICES.parcel, EE: 5.47, LV: 5.59, LT: 5.59 },
    courier: { default: 9.9, ...COUNTRY_PRICES.courier, EE: 10.84, LV: 9.9, LT: 9.9 },
    pickup: { default: 0 },
  },
  /* One cell per carrier per country, straight off the tariff mirror — a
     fresh shop bills what the carrier costs from its first order, instead of
     repeating the country's «Пакомат» number for every chip. Computed, never
     typed: it follows src/data/montonio-tariffs.json the way the method table
     above already does, and `quoteFromRules()` resolves the same numbers for
     a shop whose settings row has these cells empty. */
  carriers: carrierPriceTable(),
  /* Off by default because an order to one of them cannot be posted at all —
     Montonio answers `contract_prices_no_applicable_tier` for every carrier.
     Renat can switch any of them back on in Настройки → Доставка, which is
     the point of the switch: the shop stops promising what it cannot do, and
     the decision stays his. */
  countriesOff: [...MONTONIO_NOT_SERVED],
  /* Nothing switched off: every country the mirror prices a pickup point for
     is offered. «Open every country DPD serves» is the default rather than a
     new hard-coded list, so narrowing it is a setting and not a deploy. */
  pickupOff: [],
};

const SETTINGS_KEY = "shipping_rules";
/** Settings change by hand, not by the second; one read a minute is plenty. */
const CACHE_TTL_MS = 60_000;

let cache: { at: number; rules: ShippingRules | null } | null = null;

function isMethod(v: unknown): v is ShipMethod {
  return v === "parcel" || v === "courier" || v === "pickup";
}

/**
 * Three delivery shapes, however the checkout happened to name them. The
 * storefront sends its own labels in three languages and orders.ts passes them
 * straight through, so "Курьер до двери (DPD)" has to price as a courier and
 * not silently as a parcel machine.
 */
export function normalizeMethod(v: unknown): ShipMethod {
  if (isMethod(v)) return v;
  const s = String(v ?? "").toLowerCase();
  if (/pickup|самовыв|заберу|ise|tule|kohapeal|store|shop/.test(s)) return "pickup";
  if (/courier|kuller|курьер|door|uks|дверь/.test(s)) return "courier";
  return "parcel";
}

/** The carrier named inside a method label, when the checkout did not send one. */
export function sniffCarrier(v: unknown): string | undefined {
  const s = String(v ?? "").toLowerCase();
  if (/omniva/.test(s)) return "omniva";
  if (/dpd/.test(s)) return "dpd";
  if (/smartpost|itella/.test(s)) return "smartpost";
  return undefined;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toPriceTable(v: unknown): Record<string, number> | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = toNumber(raw);
    if (n !== null && n >= 0) out[key === "default" ? "default" : key.toUpperCase()] = n;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * What settings.shipping_rules is allowed to HOLD — the owner's own cells,
 * cleaned, and not one seeded number beside them.
 *
 * Dim, 17.09.2026. parseShippingRules() below seeds every missing cell from
 * the defaults, which is exactly right on the way OUT — a basket has to be
 * priced — and quietly wrong on the way IN. PUT /api/admin/settings ran the
 * incoming value through it and stored the result, so the row came back out of
 * the database with all twenty-five courier cells and all fourteen carrier
 * cells written down as explicit numbers, whether the owner had typed them or
 * not. A number in the row is an override; an override does not move when
 * Montonio's tariff moves. So «пустое поле — цена Montonio» — the one sentence
 * the whole rate screen is built on — stopped being true the moment anything
 * was saved, and «Везде взять цены Montonio» froze that day's price list
 * instead of clearing the table.
 *
 * This is the same cleaning without the seeding: numbers are validated and
 * upper-cased, `markup` and anything unknown is dropped, and a cell that is
 * not there stays not there. The three keys that ARE authoritative — how much
 * delivery to give away and where the shop delivers at all — keep their
 * defaults when the row does not mention them, because a row that says nothing
 * about them is not a row that says «нигде не бесплатно».
 *
 * Reading is unchanged: loadShippingRules() still parses with the seeds, so
 * every absent cell is priced from Montonio's own table at the moment of the
 * quote, which is the whole point.
 */
export function cleanShippingRules(value: unknown): ShippingRules {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return cleanShippingRules({});
  }
  const raw = value as Record<string, unknown>;
  const rules: ShippingRules = {
    freeFrom: DEFAULT_SHIPPING_RULES.freeFrom,
    freeFromByCountry: { ...(DEFAULT_SHIPPING_RULES.freeFromByCountry ?? {}) },
    methods: { parcel: {}, courier: {}, pickup: {} },
    carriers: {},
    countriesOff: [...(DEFAULT_SHIPPING_RULES.countriesOff ?? [])],
    pickupOff: [...(DEFAULT_SHIPPING_RULES.pickupOff ?? [])],
  };

  if (raw.freeFrom === null) rules.freeFrom = null;
  else {
    const n = toNumber(raw.freeFrom);
    if (n !== null && n >= 0) rules.freeFrom = n;
  }

  const byCountry = raw.freeFromByCountry;
  if (typeof byCountry === "object" && byCountry !== null && !Array.isArray(byCountry)) {
    const out: Record<string, number | null> = {};
    for (const [c, v] of Object.entries(byCountry as Record<string, unknown>)) {
      if (v === null) out[c.toUpperCase()] = null;
      else {
        const n = toNumber(v);
        if (n !== null && n >= 0) out[c.toUpperCase()] = n;
      }
    }
    rules.freeFromByCountry = out;
  }

  const methods = raw.methods;
  if (typeof methods === "object" && methods !== null && !Array.isArray(methods)) {
    for (const [name, table] of Object.entries(methods as Record<string, unknown>)) {
      if (!isMethod(name)) continue;
      const parsed = toPriceTable(table) ?? {};
      if (name === "parcel") {
        /* The parcel column's country cells are STORED BY NOBODY, deliberately.
           admShipRowHTML() emits `c:<carrier>:`, `m:courier:` and `free:` keys
           and no `m:parcel:` one, so eighteen of its twenty-two countries have
           no box on any screen — and the row the shop ran on until 22.09.2026
           carried all twenty-two as literals from 148_shipping_country_prices.sql
           (202_shipping_prices_follow_montonio.sql removes the untouched ones). Left
           alone they round-trip through every ordinary save, frozen on the day
           they were written, while the tariff they were copied from moves.

           Dropping them here is what makes «пустая клетка следует за тарифом»
           true rather than aspirational (Dim, 17.09.2026), and it is a no-op on
           price: parseShippingRules() re-seeds this column on READ from the full
           DEFAULT_SHIPPING_RULES.methods.parcel, so every cell dropped comes
           back as the identical number. Note the courier column is NOT like
           this — it is seeded without its three home prices, so dropping a
           courier cell would move real money. Do not generalise this. */
        rules.methods[name] = "default" in parsed ? { default: parsed.default } : {};
      } else {
        rules.methods[name] = parsed;
      }
    }
  }

  const carriers = raw.carriers;
  if (typeof carriers === "object" && carriers !== null && !Array.isArray(carriers)) {
    const out: Record<string, Record<string, number>> = {};
    for (const [carrier, table] of Object.entries(carriers as Record<string, unknown>)) {
      /* …and only a carrier the shop can actually put a parcel on, for the
         reason parseShippingRules() drops the others on the way out: a stale
         `carriers.venipak` is not inert, quoteFromRules() reads the carrier
         map before the method's own table. Refusing to STORE one keeps the
         row and the read agreeing. */
      const key = String(carrier).toLowerCase();
      if (!SHOP_CARRIERS.includes(key)) continue;
      const parsed = toPriceTable(table);
      if (parsed) out[key] = parsed;
    }
    rules.carriers = out;
  }

  if (Array.isArray(raw.countriesOff)) {
    /* De-duplicated and sorted like parseShippingRules() does it: countryOff()
       does not care, but the stored row and the audit line it produces are read
       by people, and «LV, EE, LV» is a row that looks edited when it is not. */
    rules.countriesOff = [...new Set(raw.countriesOff
      .map((c) => String(c ?? "").trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c)))].sort();
  }

  /* Same shape and the same rule as countriesOff above: an array is
     authoritative, empty included — «предлагать пакомат везде» is a real
     answer and has to survive a save. Only the countries the mirror actually
     prices a pickup point for are kept, because switching off a country that
     never had one is a row that looks like a decision and is not. */
  if (Array.isArray(raw.pickupOff)) {
    rules.pickupOff = [...new Set(raw.pickupOff
      .map((c) => String(c ?? "").trim().toUpperCase())
      .filter((c) => PICKUP_POINT_COUNTRIES.includes(c)))].sort();
  }

  return rules;
}

/**
 * Parse whatever sits in settings.shipping_rules, keeping the defaults for
 * anything missing or nonsense. A half-written rules row degrades one line at a
 * time instead of taking the checkout down.
 */
export function parseShippingRules(value: unknown): ShippingRules {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_SHIPPING_RULES;
  }
  const raw = value as Record<string, unknown>;
  const rules: ShippingRules = {
    freeFrom: DEFAULT_SHIPPING_RULES.freeFrom,
    /* Seeded like countriesOff and markup, and for the same reason: since
       08.09.2026 the defaults carry a real threshold (`EU: 200`), so a rules
       row written before that key existed — every production row until
       db/migrations/149 runs — must still price Europe at 200 €. The
       storefront's own copy of the defaults does exactly this on its side
       (applyShipRules() in public/shop2/app.js only overwrites a key the row
       actually sends), and the screen and the bill have to agree in the window
       between a deploy and its migration. */
    freeFromByCountry: { ...(DEFAULT_SHIPPING_RULES.freeFromByCountry ?? {}) },
    methods: {
      parcel: { ...DEFAULT_SHIPPING_RULES.methods.parcel },
      /* The courier column's floor is **Montonio's own price**, not the three
         home numbers the shop ships with (EE 10.84, LV/LT 9.90). Those three
         are overrides like any other cell, and «пустое поле — цена Montonio»
         has to hold after a save as well as before it: the panel's «Везде
         взять цены Montonio» clears the boxes, and a seed of 10.84 underneath
         would put Estonia's own number back the moment the row was read again
         — the button lying about what it did.
         No price moves. 148 wrote an explicit cell for all twenty-five
         countries; since 22.09.2026, 202 removes every one still holding 148's
         seed EXCEPT the three home couriers above, which is exactly why they are
         restated here rather than left to the tariff. A shop with
         no row at all is priced by DEFAULT_SHIPPING_RULES above, which still
         holds 10.84 / 9.90 / 9.90. tests/shipping-rate-table.test.ts checks
         both, cell by cell. */
      courier: { default: DEFAULT_SHIPPING_RULES.methods.courier.default, ...COUNTRY_PRICES.courier },
      pickup: { ...DEFAULT_SHIPPING_RULES.methods.pickup },
    },
    countriesOff: [...(DEFAULT_SHIPPING_RULES.countriesOff ?? [])],
    pickupOff: [...(DEFAULT_SHIPPING_RULES.pickupOff ?? [])],
  };

  if (raw.freeFrom === null) rules.freeFrom = null;
  else {
    const n = toNumber(raw.freeFrom);
    if (n !== null && n >= 0) rules.freeFrom = n;
  }

  /* An object, and an *authoritative* one, empty included — the same rule
     countriesOff follows below and for the same reason: `{}` means «one
     threshold everywhere», and a merge that quietly put the 200 € default
     back would be a table that refuses to be emptied. Only a missing or
     malformed key keeps the default.
     Since 13.09.2026 the panel writes a null rather than dropping a key when
     the owner clears a «Бесплатно от» box — an empty box means «сюда
     бесплатной доставки нет», not «возьмите строку ниже» (shipFreeCell() and
     setShipDraftField() in public/shop2/app.js) — so `{EU: null}` is what
     clearing the «Другие страны Европы» row now sends, and `{}` arrives only
     from a hand-written row or an older save. Both are read here unchanged. */
  const byCountry = raw.freeFromByCountry;
  if (typeof byCountry === "object" && byCountry !== null && !Array.isArray(byCountry)) {
    const out: Record<string, number | null> = {};
    for (const [c, v] of Object.entries(byCountry as Record<string, unknown>)) {
      if (v === null) out[c.toUpperCase()] = null;
      else {
        const n = toNumber(v);
        if (n !== null && n >= 0) out[c.toUpperCase()] = n;
      }
    }
    rules.freeFromByCountry = out;
  }

  const methods = raw.methods;
  if (typeof methods === "object" && methods !== null && !Array.isArray(methods)) {
    for (const [name, table] of Object.entries(methods as Record<string, unknown>)) {
      if (!isMethod(name)) continue;
      const parsed = toPriceTable(table);
      if (parsed) rules.methods[name] = { ...rules.methods[name], ...parsed };
    }
  }

  /* Merged **cell by cell** over the Montonio defaults, not carrier by carrier.
     An absent cell is the whole point (Ренат, 13.09.2026): a box the owner has
     not filled — or has cleared — charges what Montonio charges for that
     carrier, and only a number he typed replaces it. Replacing a whole carrier
     would mean one typed Estonian DPD price silently blanked DPD everywhere
     else, and the shop would be back to one number per country.

     Only carriers the shop can actually put a parcel on survive the read —
     SHOP_CARRIERS, and this is the one door every reader of the stored row
     comes through. Venipak went on 14.09.2026 («Venipak does not seem to be
     available, so remove») and the live shop's settings row can still carry a
     `carriers.venipak` table; a row written once outlives the code that wrote
     it. A carrier the checkout can never send would only ever be a price nobody
     can reach — and quoteFromRules() reads `rules.carriers?.[carrier]` before
     the method's own table, so a stale entry is not inert, it is a trapdoor.
     Dropped here rather than trusted to stay unused. */
  const carriers = raw.carriers;
  const out: Record<string, Record<string, number>> = {};
  for (const [name, table] of Object.entries(DEFAULT_SHIPPING_RULES.carriers ?? {})) {
    out[name] = { ...table };
  }
  if (typeof carriers === "object" && carriers !== null && !Array.isArray(carriers)) {
    for (const [name, table] of Object.entries(carriers as Record<string, unknown>)) {
      const key = name.toLowerCase();
      if (!SHOP_CARRIERS.includes(key)) continue;
      const parsed = toPriceTable(table);
      if (parsed) out[key] = { ...(out[key] ?? {}), ...parsed };
    }
  }
  if (Object.keys(out).length) rules.carriers = out;

  /* An array, and an *authoritative* one: [] means «deliver everywhere», which
     is a real answer Renat can give and must survive the merge. Only a missing
     or malformed key keeps the default seven. */
  const off = raw.countriesOff;
  if (Array.isArray(off)) {
    rules.countriesOff = [
      ...new Set(
        off
          .map((c) => String(c ?? "").trim().toUpperCase())
          .filter((c) => /^[A-Z]{2}$/.test(c)),
      ),
    ].sort();
  }

  /* …and the pickup-point exceptions, the same way: an array is authoritative,
     `[]` means «пакомат везде, где он есть», and a missing key keeps the
     default (which is also `[]`). Filtered to the countries that have a
     pickup point at all, so a stale code cannot make `pickupOffered()` answer
     about a country the mirror does not price. */
  const pickupOff = raw.pickupOff;
  if (Array.isArray(pickupOff)) {
    rules.pickupOff = [
      ...new Set(
        pickupOff
          .map((c) => String(c ?? "").trim().toUpperCase())
          .filter((c) => PICKUP_POINT_COUNTRIES.includes(c)),
      ),
    ].sort();
  }

  /* `raw.markup` is read by nothing and dropped on purpose — see
     ShippingRules above. Every row written before 14.09.2026 carries the key
     (the panel saved the whole table, markup included); parsing it away is
     what makes «the boxes are gone» and «the bill did not move» the same
     sentence. tests/shipping-rate-table.test.ts runs a row with a real markup
     in it through all 216 prices the checkout can produce. */

  return rules;
}

/** Read the rules row, cached. Returns null when the database has nothing. */
export async function loadShippingRules(): Promise<ShippingRules | null> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.rules;
  let rules: ShippingRules | null = null;
  try {
    const rows = await query<{ value: unknown }>(
      "select value from settings where key = $1",
      [SETTINGS_KEY],
    );
    if (rows.length) rules = parseShippingRules(rows[0].value);
  } catch {
    // no DATABASE_URL, no table, no network — the defaults still price a basket
    rules = null;
  }
  cache = { at: now, rules };
  return rules;
}

/** Drop the cached rules — used by tests and by the admin after a save. */
export function resetShippingRulesCache(): void {
  cache = null;
}

/**
 * The countries the «Другие страны Европы» row prices: the EU without the
 * four that have rows of their own, plus the EEA, Switzerland and the UK.
 * Anything else is «Остальные страны» (the `default` cell).
 */
const EUROPE = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "FR", "DE", "GR", "HU", "IE", "IT", "LU", "MT", "NL", "PL",
  "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "CH", "GB",
]);

/**
 * The rules are keyed by zone — EE, LV, LT, FI, EU, default — but an order
 * carries the customer's real country (DE, IT…), because a parcel cannot be
 * registered to «Europe». This maps one onto the other; a bare "EU" (orders
 * placed before the checkout asked for the country) prices as Europe.
 */
export function shippingZone(country: string): string {
  const c = String(country || "").toUpperCase();
  if (c === "EE" || c === "LV" || c === "LT" || c === "FI" || c === "EU") return c;
  return EUROPE.has(c) ? "EU" : "default";
}

/* ---------- selling below what Montonio charges --------------------------- */

/** One cell of the rules table that would be sold at a loss. */
export interface BelowCostCell {
  /** The carrier the cell belongs to, "" for a cell in the method column. */
  carrier: string;
  country: string;
  method: ShipMethod;
  /** What the owner typed. */
  charged: number;
  /** What the shop would charge for that delivery with the box left empty — Montonio's own price. */
  cost: number;
}

/** «Пакомат Omniva, Эстония» / «Курьер, Финляндия» — one cell, in the owner's own words. */
function cellName(cell: BelowCostCell): string {
  const where = COUNTRY_RU[cell.country] ?? cell.country;
  const what = cell.method === "courier" ? "Курьер" : "Пакомат";
  const who = cell.carrier ? ` ${CARRIER_RU[cell.carrier] ?? cell.carrier}` : "";
  return `${what}${who}, ${where}`;
}

const COUNTRY_RU: Record<string, string> = {
  EE: "Эстония", LV: "Латвия", LT: "Литва", FI: "Финляндия", PL: "Польша", DE: "Германия",
  AT: "Австрия", BE: "Бельгия", BG: "Болгария", HR: "Хорватия", CZ: "Чехия", DK: "Дания",
  ES: "Испания", FR: "Франция", GR: "Греция", HU: "Венгрия", IE: "Ирландия", IT: "Италия",
  LU: "Люксембург", NL: "Нидерланды", PT: "Португалия", RO: "Румыния", SE: "Швеция",
  SI: "Словения", SK: "Словакия",
};

const CARRIER_RU: Record<string, string> = {
  omniva: "Omniva", smartpost: "SmartPosti", dpd: "DPD", unisend: "Unisend", novapost: "Nova Post",
};

/** `7,89 €` — the panel's own spelling, so the sentence reads like the screen. */
function eur(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}

/**
 * Every cell in these rules that sells below what Montonio charges for it.
 *
 * Ренат, 13.09.2026, «Update prices» → «we get prices from Montonio and we
 * should use those, we do not need to make them up». The panel already prints
 * the cost under each box and reddens it when the price is under; that was not
 * enough to stop nine of fourteen carrier-country pairs going out below cost,
 * so the save now refuses.
 *
 * The floor is **the number the screen prints under the box** — the price an
 * empty box charges (`carrierPrice()` / `methodPrice()`), not the rawer tariff
 * underneath it. Until 14.09.2026 the guard used the raw cost, so it accepted
 * an Estonian Omniva locker at 3.15 € while clearing that very box would have
 * charged 3.19 €: the message's own advice — «очистите поле» — led to a higher
 * price than the one it had just allowed. One number now, in the box's hint,
 * in the refusal and in the till.
 *
 * What is checked, and what deliberately is not:
 *
 *   · **every carrier cell**, against that carrier's own Montonio price. This
 *     is the one that actually bills a parcel machine, because the shopper
 *     picks the chip.
 *   · **the courier column**, against `methodPrice()` — which for a courier is
 *     the cheapest carrier the shop can use, because nobody *chooses* that
 *     one: Renat does, when he makes the label. So Finland's 16.29 € courier
 *     is not a loss (SmartPosti costs 15.62 €) even though DPD would cost
 *     20.09 €; it is a thin margin, not a hole, and refusing the save over it
 *     would be refusing a price that makes money.
 *   · not the parcel column, at all, since 17.09.2026 — see below.
 *   · not `default`, not a zone row (`EU`), not `freeFrom`. Those are not one
 *     route and have no one cost to compare against; giving delivery away over
 *     a threshold is the owner's own decision and always was.
 *
 * **Why the «Пакомат» column left the guard.** It was checked outside
 * EE/LV/LT/FI on the reasoning that those four bill from the carrier chip and
 * the rest bill from the column. What that missed is that no box on the rate
 * screen writes the column: admShipRowHTML() in public/shop2/app.js emits
 * `c:<carrier>:<country>`, `m:courier:<country>` and `free:<country>` and
 * nothing else — the «Пакомат» boxes went when the screen lost two tables on
 * 14.09.2026, and the checkout offers no parcel machine in any of those
 * eighteen countries either. So every cell this half of the loop could see was
 * a default nobody typed, and the day a Montonio tariff rose past one of them
 * the shop would have refused the owner's next save — any save, of any cell —
 * over a number with no box to change. A refusal you cannot act on is not a
 * guard, it is a locked panel. The cells themselves are unchanged and are
 * still honoured by quoteFromRules(); a saved row does not carry them at all
 * (cleanShippingRules), so they are the defaults, and the defaults are
 * Montonio's own prices.
 *
 * **That last sentence is load-bearing, and it was false for a few hours.**
 * This paragraph was written first and cleanShippingRules only preserved the
 * column rather than dropping it, so an ordinary save round-tripped all
 * twenty-two frozen literals back into the row — with the guard now removed
 * and no box to edit them. A review on 17.09.2026 caught it. If anyone ever
 * puts those cells back into the stored row, this loop has to come back with
 * them, or a tariff rise turns eighteen uneditable cells into eighteen silent
 * losses instead of one loud refusal.
 */
export function belowCostCells(rules: ShippingRules): BelowCostCell[] {
  const out: BelowCostCell[] = [];

  for (const [carrier, table] of Object.entries(rules.carriers ?? {})) {
    for (const [country, charged] of Object.entries(table)) {
      if (country === "default" || shippingZone(country) === "default" || country === "EU") continue;
      const cost = carrierPrice(carrier, country, "parcel");
      if (cost !== null && charged < cost) out.push({ carrier, country, method: "parcel", charged, cost });
    }
  }

  for (const [country, charged] of Object.entries(rules.methods.courier ?? {})) {
    if (country === "default" || shippingZone(country) === "default" || country === "EU") continue;
    const cost = methodPrice(country, "courier");
    if (cost !== null && charged < cost) out.push({ carrier: "", country, method: "courier", charged, cost });
  }

  return out;
}

/** The sentence the panel shows when a save is refused — plain Russian, with both numbers. */
export function belowCostMessage(cells: BelowCostCell[]): string {
  const listed = cells
    .slice(0, 6)
    .map((c) => `${cellName(c)} — ${eur(c.charged)} при тарифе ${eur(c.cost)}`)
    .join("; ");
  const more = cells.length > 6 ? ` и ещё ${cells.length - 6}` : "";
  return `Цена ниже тарифа Montonio: ${listed}${more}. Поднимите цену или очистите поле — пустое поле берёт тариф Montonio само.`;
}

/**
 * Is this country switched off in the shop? The checkout's country list asks
 * this before it draws an option; nothing else does, on purpose — see
 * ShippingRules.countriesOff.
 */
export function countryOff(rules: ShippingRules, country: string): boolean {
  const c = String(country || "").toUpperCase();
  const off = rules.countriesOff ?? DEFAULT_SHIPPING_RULES.countriesOff ?? [];
  return off.includes(c);
}

/**
 * Does the checkout offer a pickup point in this country?
 *
 * Two conditions, and both have to hold: the tariff mirror prices a locker
 * there with a carrier the shop can bill from (`PICKUP_POINT_COUNTRIES`), and
 * the owner has not switched it off (`ShippingRules.pickupOff`). The
 * storefront asks the same question of its own copy — `pickupOpen()` in
 * public/shop2/app.js — and `tests/shipping-admin-mirror.test.ts` keeps the
 * two answering alike for every country the shop sells to.
 *
 * A country with no Montonio pickup point at all can never be turned on here:
 * a chip with nothing behind it is worse than no chip. HU and RO have one, at
 * Nova Post only, and Nova Post outside the Baltics is a separate decision —
 * see PICKUP_POINT_COUNTRIES.
 */
export function pickupOffered(rules: ShippingRules, country: string): boolean {
  const c = String(country || "").toUpperCase();
  if (!PICKUP_POINT_COUNTRIES.includes(c)) return false;
  const off = rules.pickupOff ?? DEFAULT_SHIPPING_RULES.pickupOff ?? [];
  return !off.includes(c);
}

/** The pure half: rules in, price out. No I/O, so it is trivially testable. */
export function quoteFromRules(
  rules: ShippingRules,
  input: ShippingInput,
  source: ShippingQuote["source"] = "settings",
): ShippingQuote {
  const country = String(input.country || "").toUpperCase();
  const zone = shippingZone(country);
  const method = normalizeMethod(input.method);
  const carrier = input.carrier?.toLowerCase() || sniffCarrier(input.method);
  const subtotal = toNumber(input.subtotal) ?? 0;

  /*
   * Exact country first, then the zone, then the method's `default`. Until
   * 07.09.2026 only the zone was looked up, which made «Другая страна Европы»
   * a single price for twenty-four countries — and Montonio's own contract
   * rates run from 17.86 € (Poland, parcel machine) to 52.08 € (Croatia) for
   * the same box, so one number is wrong for almost all of them by a lot.
   * Nothing writes country cells by default; the admin's «Заполнить по
   * тарифам Montonio» does (src/lib/shipping/tariffs.ts), and a rules row
   * with none behaves exactly as it did before.
   */
  const table = rules.methods[method] ?? {};
  /*
   * A carrier cell is a **parcel-machine** price. Nothing writes a courier one
   * — «Заполнить по тарифам Montonio» skips them on purpose, because the
   * checkout only shows carrier chips under «Пакомат» — so reading the table
   * for a courier order charged the Omniva *parcel* price (3.19 €) for an
   * Estonian courier the moment the fill button was pressed, against a real
   * courier cost of 6.82 €. The storefront's own shipCost() passes the
   * carrier for every method, so both halves had the same hole; both now
   * ignore the carrier unless the method is one a carrier was picked for.
   */
  const carrierTable = carrier && method === "parcel" ? rules.carriers?.[carrier] : undefined;
  /*
   * …and an EMPTY carrier cell means «charge what Montonio charges for this
   * carrier», not «take the country's own «Пакомат» number».
   *
   * Renat, 13.09.2026: «we get prices from Montonio and we should use those,
   * we do not need to make them up.» The defect was the shape, not a digit:
   * the settings row holds one price per country and the checkout repeats it
   * for every chip, while Montonio bills per carrier. Finland was 7.89 € for
   * a DPD machine that costs 12.39 €, Estonia 2.59 € for an Omniva one that
   * costs 3.10 €; nine of the fourteen pairs the checkout can produce were
   * below cost, and the *shopper* picked which. Falling back to
   * carrierPrice() instead makes the empty cell the truth rather than a
   * guess, and it follows the mirror when Montonio re-cuts its price list.
   *
   * A typed number still wins — the three lookups above come first — so the
   * owner keeps control; this is the floor under him, not a ceiling over him.
   */
  const fromMontonio = carrier && method === "parcel" ? carrierPrice(carrier, country, "parcel") : null;
  /*
   * …and the same rule in the courier column, which until 14.09.2026 was the
   * one box on the rate screen where empty meant something else.
   *
   * Ренат: «If I do not like the Montonio price, I will just override it.»
   * That is one rule for the whole table or it is not a rule: a cleared box
   * means «берите цену Montonio» wherever it is, and the number the screen
   * prints under the box is this. Nobody chooses a courier's carrier — Renat
   * does, at the label — so the price is the cheapest he can pick
   * (courierPrice → costBasis), and it is read after the owner's own cell and
   * before the zone: a typed number still wins, and a country Montonio has no
   * courier for still falls through to «Другие страны Европы» as before.
   *
   * No price moves by adding it. Every country Montonio quotes has a courier
   * cell in the defaults and in the settings row (db/migrations/148), so this
   * step is unreachable until the owner clears one himself — which is the
   * whole point of putting it there.
   */
  const courierFromMontonio = method === "courier" ? methodPrice(country, "courier") : null;
  const base =
    carrierTable?.[country] ??
    carrierTable?.[zone] ??
    carrierTable?.default ??
    fromMontonio ??
    table[country] ??
    courierFromMontonio ??
    table[zone] ??
    table.default ??
    0;

  /*
   * Free delivery, same three steps as the price: the country's own threshold,
   * then its zone's, then the shop-wide one. So `freeFromByCountry: {EU: 200}`
   * — the default since 08.09.2026 — raises the bar for all of Europe at once,
   * and `{GR: null}` would turn free delivery off for Greece alone.
   *
   * A country's own key still beats its zone's, which is what makes «Европа от
   * 200 €, но в Польшу от 90 €» expressible at all; the four home rows have no
   * key and so read `freeFrom`, the 59 € they have always had.
   */
  const byCountry = rules.freeFromByCountry;
  const freeFrom = !byCountry
    ? rules.freeFrom
    : country in byCountry
      ? byCountry[country]
      : zone in byCountry
        ? byCountry[zone]
        : rules.freeFrom;

  // Pickup is free because it is pickup, not because the basket was big enough
  const earnedFree = freeFrom !== null && freeFrom >= 0 && subtotal >= freeFrom;
  const free = method === "pickup" || base === 0 || earnedFree;
  const price = free ? 0 : Math.round(base * 100) / 100;

  return {
    price,
    free,
    freeFrom: freeFrom ?? null,
    method,
    country,
    carrier,
    currency: "EUR",
    source,
  };
}

/**
 * What this delivery costs, rules from the database when they are there.
 */
export async function computeShipping(input: ShippingInput): Promise<ShippingQuote> {
  const rules = await loadShippingRules();
  return quoteFromRules(
    rules ?? DEFAULT_SHIPPING_RULES,
    input,
    rules ? "settings" : "defaults",
  );
}
