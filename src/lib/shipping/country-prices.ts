/**
 * What one country costs, and what the shop should therefore charge for it.
 *
 * A leaf module on purpose: it imports the tariff table and nothing else, so
 * src/lib/shipping.ts can build DEFAULT_SHIPPING_RULES out of it without an
 * import cycle (shipping.ts → tariffs.ts → montonio.ts → shipping.ts would be
 * one). The markup/rounding helpers live here for the same reason and are
 * re-exported from ./tariffs, which is where the rest of the codebase already
 * knows to find them.
 *
 * ## The one number that matters: which carrier the price has to cover
 *
 * Montonio quotes several carriers per route and they are not close together —
 * a courier to France is 24.19 € with SmartPosti and 44.64 € with DPD. So
 * "the cost" is not a number, it is a number *plus which carrier*, and the
 * right one depends on **who does the choosing**:
 *
 *   · **EE, LV, LT, FI** — the checkout shows carrier chips and the *shopper*
 *     picks. The price therefore has to cover the dearest of them, because the
 *     shopper may pick it. That is `ceilingCost()`, and it is the rule
 *     src/lib/shipping/tariffs.ts has always used.
 *   · **everywhere else** — the checkout offers one courier line with no
 *     carrier under it (public/shop2/app.js, CARRIERS_BY_COUNTRY.EU = []), and
 *     it is *Renat* who picks the carrier when he presses «Создать этикетку».
 *     The price covers the cheapest carrier he can pick, and the admin prints
 *     that carrier's name beside it so he knows which one the price assumed.
 *     That is `cheapestCost()`.
 *
 * ## Nova Post is not one of the carriers the shop can pick
 *
 * docs/audit/2026-09-07-shipping-returns.md quotes «Германия 12,91 €,
 * Италия 18,43 €, Польша 8,51 €». Those are **Nova Post** prices — Montonio
 * International Shipping, a separate product that is not in MONTONIO_CARRIERS,
 * has no carrier row in the admin, is never named by the storefront, and
 * supports no returns at all (help.montonio.com/en/articles/431075). The shop
 * cannot put a parcel on it today, so pricing off it would sell every European
 * order below cost.
 *
 * Against the carriers the shop *can* use, the cheapest courier to Germany is
 * 22.23 € (SmartPosti) and to Poland 20.66 € — so 9.90 € covers the courier in
 * **no** European country, not even the one the audit found it covered.
 * `cheapestCostAnyCarrier()` keeps the Nova Post view so the admin and the
 * docs can say what would change if it were switched on.
 *
 * Every price here includes Estonian VAT, like the shelf prices they are
 * compared against; `src/data/montonio-tariffs.json` keeps the ex-VAT original.
 */
import montonioTariffsData from "@/data/montonio-tariffs.json";

/** Only the two methods a carrier is ever quoted for; "pickup" has no carrier. */
export type CostMethod = "parcel" | "courier";

interface StaticRateRow {
  carrier: string;
  country: string;
  method: string;
  price: number;
  currency: string;
  effectiveDate?: string;
  uncertain?: boolean;
  returnPrice?: number | null;
}

const RATES: StaticRateRow[] = (montonioTariffsData as { rates: StaticRateRow[] }).rates;

/**
 * The carriers the shop can actually put a parcel on: the ones the admin has a
 * row for and the storefront can name. Identical to MONTONIO_CARRIERS in
 * src/lib/shipping/montonio.ts — restated rather than imported to keep this
 * module a leaf, and asserted equal in tests/shipping-country-prices.test.ts.
 */
export const SHOP_CARRIERS: readonly string[] = ["omniva", "smartpost", "dpd", "venipak", "unisend"];

/**
 * The four countries whose checkout lets the shopper choose the carrier, and
 * so the four that must be priced at the dearest of them.
 */
export const CARRIER_CHOICE_COUNTRIES: readonly string[] = ["EE", "LV", "LT", "FI"];

/** Destinations Montonio will not quote at all — HTTP 400 no_applicable_tier. */
export const MONTONIO_NOT_SERVED: readonly string[] =
  (montonioTariffsData as { notServed?: string[] }).notServed ?? [];

/** False for a country Montonio has no route to — nothing here can ship there. */
export function montonioServes(country: string): boolean {
  return !MONTONIO_NOT_SERVED.includes(String(country || "").toUpperCase());
}

/** Every country the table prices, sorted — the 25 Montonio serves out of Estonia. */
export const MONTONIO_COUNTRIES: readonly string[] = [
  ...new Set(RATES.map((r) => r.country.toUpperCase())),
].sort();

export interface CountryCost {
  /** EUR incl. Estonian VAT. */
  price: number;
  /** Which carrier that price belongs to — the admin prints it beside the number. */
  carrier: string;
}

function rowsFor(country: string, method: CostMethod, all: boolean): StaticRateRow[] {
  const cc = String(country || "").toUpperCase();
  return RATES.filter(
    (r) => r.country.toUpperCase() === cc && r.method === method && (all || SHOP_CARRIERS.includes(r.carrier)),
  );
}

function pick(rows: StaticRateRow[], dearest: boolean): CountryCost | null {
  let best: StaticRateRow | null = null;
  for (const r of rows) {
    if (!best || (dearest ? r.price > best.price : r.price < best.price)) best = r;
  }
  return best ? { price: best.price, carrier: best.carrier } : null;
}

/** The cheapest carrier the shop can actually pick for this route, or null. */
export function cheapestCost(country: string, method: CostMethod): CountryCost | null {
  return pick(rowsFor(country, method, false), false);
}

/** The dearest carrier the shop can pick — what a shopper-chosen carrier may cost. */
export function ceilingCost(country: string, method: CostMethod): CountryCost | null {
  return pick(rowsFor(country, method, false), true);
}

/**
 * The cheapest of *every* carrier Montonio quotes, Nova Post included. Not a
 * price the shop can charge against today — it is the "what if we switched
 * Montonio International Shipping on" number, and the only reason it exists is
 * so the admin and the audit can show the difference honestly.
 */
export function cheapestCostAnyCarrier(country: string, method: CostMethod): CountryCost | null {
  return pick(rowsFor(country, method, true), false);
}

/**
 * The cost a shelf price for this country has to cover: the dearest carrier
 * where the *shopper* picks one, the cheapest the shop can pick everywhere
 * else. This is the single rule the fill button, the admin hint and the
 * defaults all price from, so the three can never disagree.
 *
 * The shopper only ever picks a carrier for a **parcel machine**, and only in
 * the four countries the checkout names — those are the chips under «Пакомат»
 * (public/shop2/app.js, CARRIERS_BY_COUNTRY). A courier is one line with no
 * carrier under it in every country, home included, so Renat picks it and the
 * cheapest applies. That is why Estonia's courier basis is DPD's 6.82 € and
 * not SmartPosti's 7.38 €: nobody can choose SmartPosti for a courier.
 */
export function costBasis(country: string, method: CostMethod): CountryCost | null {
  const cc = String(country || "").toUpperCase();
  const shopperPicks = method === "parcel" && CARRIER_CHOICE_COUNTRIES.includes(cc);
  return shopperPicks ? ceilingCost(cc, method) : cheapestCost(cc, method);
}

/** What Montonio charges the merchant for the return leg, cheapest carrier first. */
export function returnCost(country: string, method: CostMethod): number | null {
  const rows = rowsFor(country, method, false)
    .filter((r) => typeof r.returnPrice === "number")
    .sort((a, b) => (a.returnPrice as number) - (b.returnPrice as number));
  return rows.length ? (rows[0].returnPrice as number) : null;
}

/* ---------- markup + psychological rounding --------------------------------
   The seller's price, not the carrier's: cost, plus a markup the owner
   controls (settings.shipping_rules.markup, default 0), rounded UP to the next
   price ending in 9 cents. Always up, never to the nearest: rounding down
   could put the shelf price below the floor that was just computed, which is
   the one thing this whole feature exists to stop happening.

   These three live here, in the leaf, and are re-exported from ./tariffs so
   every existing import keeps working. */

export interface ShippingMarkup {
  /** Percent added to the tariff, e.g. 10 for +10%. */
  percent: number;
  /** Flat EUR added on top of the percent markup. */
  fixed: number;
}

export const DEFAULT_MARKUP: ShippingMarkup = { percent: 0, fixed: 0 };

/** Smallest amount ending in "9 cents" (…, 4.39, 4.49, 4.59, …) at or above `n`. */
export function roundUpToX9(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const cents = Math.ceil(n * 100 - 1e-7);
  const rem = ((cents % 10) + 10) % 10;
  const up = rem === 9 ? 0 : (9 - rem + 10) % 10;
  return (cents + up) / 100;
}

/** tariff × (1 + percent/100) + fixed — the markup is on top of cost, not a discount. */
export function applyMarkup(tariff: number, markup: Partial<ShippingMarkup> = {}): number {
  const percent =
    typeof markup.percent === "number" && Number.isFinite(markup.percent) && markup.percent >= 0
      ? markup.percent
      : 0;
  const fixed =
    typeof markup.fixed === "number" && Number.isFinite(markup.fixed) && markup.fixed >= 0 ? markup.fixed : 0;
  return Math.round((tariff * (1 + percent / 100) + fixed + Number.EPSILON) * 100) / 100;
}

/** What the shopper pays for a tariff: markup, then rounded up to .x9. */
export function customerPrice(tariff: number, markup: Partial<ShippingMarkup> = {}): number {
  return roundUpToX9(applyMarkup(tariff, markup));
}

/* ---------- the shelf table ------------------------------------------------ */

export interface CountryPriceTable {
  parcel: Record<string, number>;
  courier: Record<string, number>;
}

/**
 * One price per country per method, from `costBasis()` plus the markup —
 * the table DEFAULT_SHIPPING_RULES is built on and the fill button writes.
 * A country/method Montonio quotes no reachable carrier for gets no cell at
 * all rather than an invented one: Greece has no parcel machine, Hungary and
 * Romania have none the shop can use, and a made-up number there would be a
 * price for a parcel that cannot be sent.
 */
export function countryPriceTable(markup: Partial<ShippingMarkup> = {}): CountryPriceTable {
  const out: CountryPriceTable = { parcel: {}, courier: {} };
  for (const country of MONTONIO_COUNTRIES) {
    for (const method of ["parcel", "courier"] as const) {
      const basis = costBasis(country, method);
      if (!basis) continue;
      out[method][country] = customerPrice(basis.price, markup);
    }
  }
  return out;
}
