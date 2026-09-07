import { query } from "@/lib/db";

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
 * Defaults, per the checkout brief: parcel LV, LT 4.99; courier EU 9.90;
 * pickup free; free delivery from 59 €. EE parcel 5.47 and courier 10.84 came
 * from the carriers' own 2025–26 business list prices, researched 03.09.2026.
 *
 * **What those numbers were measured against changed on 07.09.2026.** The
 * table they were computed from held what Omniva, SmartPosti and DPD charge a
 * merchant with no Montonio contract. Montonio's own contract prices turned
 * out to be public after all (src/data/montonio-tariffs.json,
 * docs/audit/2026-09-07-shipping-returns.md), and they are far lower at home:
 * a parcel machine in Estonia costs 2.54–3.10 € incl. VAT, not 4.50–5.47. So
 * EE is no longer sold below cost — it is sold at roughly double it, which is
 * a margin, not a bug, and not this file's to change.
 *
 * Where the shop still sells below cost is everywhere else, and by more than
 * was thought:
 *   · LV/LT parcel 4.99 against 3.72–5.58 — now roughly break-even.
 *   · LV/LT courier 9.90 against 8.00–11.16 — roughly break-even.
 *   · FI has no row at all, so it falls to `default`: parcel 4.99 against
 *     SmartPosti 9.30 / DPD 12.39, courier 9.90 against 15.62–20.09.
 *   · «Другая страна Европы» also falls to `default`. Taking the cheapest
 *     carrier Montonio offers for each country, a parcel machine costs
 *     7.85 € (Poland) to 59.52 € (Croatia) and a courier 8.51 € (Poland) to
 *     43.15 € (Greece). 4.99 € covers the parcel machine in **no** European
 *     country; 9.90 € covers the courier in exactly one, Poland.
 *
 * And `freeFrom: 59` applies to all of them, so a 59 € basket to Croatia
 * ships free at a cost of up to 59.52 € — the one place where a bigger order
 * is worth less than a smaller one.
 *
 * These stay as they are on purpose. Closing the gap — and deciding whether
 * Rempire keeps eating it for reach — is Renat's call, not a default this
 * file should make for him. He can close all of it in one click with
 * «Заполнить по тарифам Montonio» in Настройки → Доставка, which now prices
 * every European country separately (src/lib/shipping/tariffs.ts), or by hand.
 */
export const DEFAULT_SHIPPING_RULES: ShippingRules = {
  freeFrom: 59,
  methods: {
    parcel: { default: 4.99, EE: 5.47, LV: 4.99, LT: 4.99 },
    courier: { default: 9.9, EE: 10.84 },
    pickup: { default: 0 },
  },
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
  const carrierTable = carrier ? rules.carriers?.[carrier] : undefined;
  const base =
    carrierTable?.[country] ??
    carrierTable?.[zone] ??
    carrierTable?.default ??
    table[country] ??
    table[zone] ??
    table.default ??
    0;

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
