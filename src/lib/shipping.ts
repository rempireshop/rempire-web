import { query } from "@/lib/db";
import { countryPriceTable, MONTONIO_NOT_SERVED } from "@/lib/shipping/country-prices";

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
  /** Basket subtotal (EUR, pre-discount) at or above which delivery is free. */
  freeFrom: number | null;
  /** Per-country override of freeFrom, e.g. { "FI": 99 }. */
  freeFromByCountry?: Record<string, number | null>;
  /** price[method][ISO country] with a "default" fallback per method. */
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
   * refuses to quote is a checkout that cannot take money, and an order that
   * reached the server past the dropdown is better priced than dropped. Use
   * `countryOff()` to ask.
   */
  countriesOff?: string[];
  /**
   * Markup added to a Montonio carrier tariff to get the customer-facing
   * price: `tariff * (1 + percent/100) + fixed`, then rounded up to the next
   * price ending in 9 cents (src/lib/shipping/tariffs.ts, customerPrice()).
   * Only the admin's «Заполнить по тарифам Montonio» button reads this —
   * quoteFromRules() below still prices strictly off `methods`/`carriers`, so
   * a markup change alone does nothing until that button (or a hand edit) is
   * used to refill the table. Default: no markup at all.
   */
  markup?: { percent: number; fixed: number };
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
 * Shipping): a product the shop has not activated, has no carrier row for,
 * never names in the storefront, and which supports no returns at all. Against
 * the carriers the shop can actually put a parcel on, the cheapest courier to
 * Poland is 20.66 €, not 8.51 €. So 9.90 € covered the courier in **no**
 * European country — not even the one the audit found it covered.
 *
 * What is kept deliberately:
 *   · **EE 5.47 / 10.84 and LV, LT 4.99 / 9.90.** All four sit above cost
 *     already (a parcel machine in Estonia costs 2.47–3.10 €), and dropping a
 *     home price to match cost is a revenue cut nobody asked for.
 *   · **The `EU` and `default` cells, 4.99 / 9.90.** They are the fallback the
 *     brief asks to keep: any destination the tariff table has no row for
 *     still gets a price rather than a blank.
 *   · **`freeFrom: 59` everywhere, and no per-country thresholds.** The
 *     threshold is now settable per zone and per country
 *     (`freeFromByCountry`), but it defaults to exactly what it did before, so
 *     nothing about free delivery changes until Renat decides it should. It is
 *     also where the money still leaks — see the audit's question 5.
 *
 * What changes for a shopper: Finland and the twenty-one other European
 * countries Montonio serves stop being one number. Finland's courier goes
 * 9.90 → 15.69 €, Germany's 9.90 → 22.29 €, Greece's 9.90 → 43.19 €. The
 * before/after table for all twenty-five is in
 * docs/audit/2026-09-07-eu-rates.md.
 */
const COUNTRY_PRICES = countryPriceTable();

export const DEFAULT_SHIPPING_RULES: ShippingRules = {
  freeFrom: 59,
  methods: {
    // spread first, hand-set home prices second: the four the shop already
    // sells above cost keep the number Renat sells at
    parcel: { default: 4.99, ...COUNTRY_PRICES.parcel, EE: 5.47, LV: 4.99, LT: 4.99 },
    courier: { default: 9.9, ...COUNTRY_PRICES.courier, EE: 10.84, LV: 9.9, LT: 9.9 },
    pickup: { default: 0 },
  },
  /* Off by default because an order to one of them cannot be posted at all —
     Montonio answers `contract_prices_no_applicable_tier` for every carrier.
     Renat can switch any of them back on in Настройки → Доставка, which is
     the point of the switch: the shop stops promising what it cannot do, and
     the decision stays his. */
  countriesOff: [...MONTONIO_NOT_SERVED],
  markup: { percent: 0, fixed: 0 },
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
    methods: {
      parcel: { ...DEFAULT_SHIPPING_RULES.methods.parcel },
      courier: { ...DEFAULT_SHIPPING_RULES.methods.courier },
      pickup: { ...DEFAULT_SHIPPING_RULES.methods.pickup },
    },
    countriesOff: [...(DEFAULT_SHIPPING_RULES.countriesOff ?? [])],
    markup: {
      percent: DEFAULT_SHIPPING_RULES.markup?.percent ?? 0,
      fixed: DEFAULT_SHIPPING_RULES.markup?.fixed ?? 0,
    },
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
    if (Object.keys(out).length) rules.freeFromByCountry = out;
  }

  const methods = raw.methods;
  if (typeof methods === "object" && methods !== null && !Array.isArray(methods)) {
    for (const [name, table] of Object.entries(methods as Record<string, unknown>)) {
      if (!isMethod(name)) continue;
      const parsed = toPriceTable(table);
      if (parsed) rules.methods[name] = { ...rules.methods[name], ...parsed };
    }
  }

  const carriers = raw.carriers;
  if (typeof carriers === "object" && carriers !== null && !Array.isArray(carriers)) {
    const out: Record<string, Record<string, number>> = {};
    for (const [name, table] of Object.entries(carriers as Record<string, unknown>)) {
      const parsed = toPriceTable(table);
      if (parsed) out[name.toLowerCase()] = parsed;
    }
    if (Object.keys(out).length) rules.carriers = out;
  }

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

  const markup = raw.markup;
  if (typeof markup === "object" && markup !== null && !Array.isArray(markup)) {
    const m = markup as Record<string, unknown>;
    const percent = toNumber(m.percent);
    const fixed = toNumber(m.fixed);
    // generous but bounded: a markup is a surcharge, not a second price list
    if (percent !== null && percent >= 0 && percent <= 100) rules.markup!.percent = percent;
    if (fixed !== null && fixed >= 0 && fixed <= 20) rules.markup!.fixed = fixed;
  }

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
  const base =
    carrierTable?.[country] ??
    carrierTable?.[zone] ??
    carrierTable?.default ??
    table[country] ??
    table[zone] ??
    table.default ??
    0;

  /*
   * Free delivery, same three steps as the price: the country's own threshold,
   * then its zone's, then the shop-wide one. So `freeFromByCountry: {EU: 150}`
   * raises the bar for all of Europe at once and `{GR: null}` turns free
   * delivery off for Greece alone, where it costs 43.15 € to send.
   *
   * Nothing sets either by default — `freeFrom: 59` everywhere is exactly what
   * it was — because how much free delivery to give away is Renat's decision,
   * not a default this file should make for him. It is also the place the
   * per-country prices above do NOT fix: a 59 € basket still ships free at
   * whatever it costs. docs/audit/2026-09-07-eu-rates.md, question 5.
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
