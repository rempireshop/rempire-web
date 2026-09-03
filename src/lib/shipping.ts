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
 * pickup free; free delivery from 59 €. **EE parcel and courier are no longer
 * the brief's numbers** — see docs/shipping.md § «Тарифы Montonio», researched
 * 03.09.2026: the brief's 3.49/5.99 sat below every sourced Omniva/SmartPosti/
 * DPD business-list tariff for Estonia, so this shop was paying more for a
 * delivery than it charged for it on day one, in its home market. EE parcel is
 * now 5.47 (the highest of Omniva 5.46, SmartPosti 5.47, DPD Pickup 4.50 — the
 * ceiling, since a plain "parcel" order with no carrier override can land on
 * any of the three) and EE courier is 10.84 (SmartPosti's flat rate, itself
 * above DPD's priciest zone at 10.78).
 *
 * LV, LT and the EU/default rows are untouched on purpose: those are below
 * cost by the same evidence (LV/LT parcel 4.99 against a sourced 8.06–11.79;
 * courier against 16–26), but closing that gap for every market — and
 * deciding whether Rempire keeps eating it for reach — is Renat's call, not a
 * default this file should make for him. He can close all of it in one click
 * with «Заполнить по тарифам Montonio» in Настройки → Доставка, which prices
 * every country this way (src/lib/shipping/tariffs.ts), or by hand.
 *
 * Note for whoever tunes these next: the storefront demo table
 * (public/shop2/app.js SHIP) and src/data/montonio-tariffs.json carry the
 * sourced 2025–26 carrier list prices these numbers are computed from.
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

/** The pure half: rules in, price out. No I/O, so it is trivially testable. */
export function quoteFromRules(
  rules: ShippingRules,
  input: ShippingInput,
  source: ShippingQuote["source"] = "settings",
): ShippingQuote {
  const country = String(input.country || "").toUpperCase();
  const method = normalizeMethod(input.method);
  const carrier = input.carrier?.toLowerCase() || sniffCarrier(input.method);
  const subtotal = toNumber(input.subtotal) ?? 0;

  const table = rules.methods[method] ?? {};
  const carrierTable = carrier ? rules.carriers?.[carrier] : undefined;
  const base =
    carrierTable?.[country] ??
    carrierTable?.default ??
    table[country] ??
    table.default ??
    0;

  const freeFrom =
    rules.freeFromByCountry && country in rules.freeFromByCountry
      ? rules.freeFromByCountry[country]
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
