/**
 * Montonio carrier tariffs — what a delivery actually costs, as opposed to
 * DEFAULT_SHIPPING_RULES' invented brief numbers.
 *
 * Two sources, preferred in this order:
 *   1. live — `POST /shipping-methods/rates` (src/lib/shipping/montonio.ts,
 *      fetchMontonioRates), cached 24 hours per country. Needs
 *      MONTONIO_ACCESS_KEY/SECRET_KEY and carriers activated in the Montonio
 *      partner portal; without either it answers null rather than throwing.
 *      This is the only source that knows what *this* store pays.
 *   2. static — src/data/montonio-tariffs.json: Montonio's own published
 *      standard contract prices, every route it will quote out of Estonia,
 *      rebuilt by tools/fetch-montonio-tariffs.mjs from the public endpoint
 *      behind Montonio's shipping calculator. Until 07.09.2026 this table
 *      held the carriers' own business list prices instead, on the belief
 *      that Montonio published none — see docs/shipping.md § «Тарифы
 *      Montonio» and docs/audit/2026-09-07-shipping-returns.md.
 *
 * Neither source is wired into checkout pricing: `computeShipping()` in
 * src/lib/shipping.ts still prices strictly from `settings.shipping_rules`,
 * fast and DB-cached, exactly as before. This module only *informs* what
 * those rules should say — the admin's «Заполнить по тарифам Montonio»
 * button (public/shop2/app.js, shipRulesCard) turns a tariff plus a markup
 * into the number that actually gets saved, through the same
 * demoApply({type:"set_shipping_rules"}) path a hand-typed price uses.
 */
import montonioTariffsData from "@/data/montonio-tariffs.json";
import type { ShipMethod } from "@/lib/shipping";
import {
  CARRIER_CHOICE_COUNTRIES,
  customerPrice,
  type ShippingMarkup,
} from "./country-prices";
import {
  fetchMontonioRates,
  isMontonioShippingConfigured,
  MONTONIO_CARRIERS,
  type MontonioRate,
} from "./montonio";

/* The markup arithmetic and the not-served list moved down into
   ./country-prices, the leaf src/lib/shipping.ts can import without a cycle.
   Re-exported here because this is where the rest of the codebase looks for
   them, and one implementation is the whole point. */
export {
  applyMarkup,
  ceilingCost,
  cheapestCost,
  cheapestCostAnyCarrier,
  costBasis,
  countryPriceTable,
  customerPrice,
  DEFAULT_MARKUP,
  MONTONIO_COUNTRIES,
  MONTONIO_NOT_SERVED,
  montonioServes,
  returnCost,
  roundUpToX9,
  SHOP_CARRIERS,
  type CountryCost,
  type ShippingMarkup,
} from "./country-prices";

/**
 * The parcel every quote — live or static — is priced for: ~5 kg, 30×30×30 cm,
 * the same "L" locker size public/shop/shipping-data.js already standardised
 * on, so the two sources are always comparing the same nominal box.
 */
export const REFERENCE_PARCEL = { weightKg: 5, lengthCm: 30, widthCm: 30, heightCm: 30 };

export interface TariffQuote {
  carrier: string;
  country: string;
  method: ShipMethod;
  /** The raw carrier cost — not yet marked up, not yet rounded. */
  price: number;
  currency: string;
  source: "live" | "static";
  effectiveDate?: string;
  /** Set when the source data itself flagged the number as unverified (see the JSON). */
  uncertain?: boolean;
  /**
   * What Montonio charges the merchant when the customer sends this parcel
   * back — «Same pricing applies to return parcels», Omniva by Montonio,
   * help.montonio.com/en/articles/143643. `null` where Montonio prices no
   * return on that route (every Nova Post row, every SmartPosti row, and some
   * DPD ones), `undefined` on a live quote, which does not carry the field.
   * Nothing prices a basket from this — it is what the admin and the docs
   * quote when someone asks what a return costs.
   */
  returnPrice?: number | null;
}

/* ---------- static table --------------------------------------------------- */

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

const STATIC_RATES: StaticRateRow[] = (montonioTariffsData as { rates: StaticRateRow[] }).rates;

function methodOf(m: string): ShipMethod | null {
  return m === "parcel" || m === "courier" || m === "pickup" ? m : null;
}

function quoteOf(row: StaticRateRow, method: ShipMethod): TariffQuote {
  return {
    carrier: row.carrier,
    country: row.country.toUpperCase(),
    method,
    price: row.price,
    currency: row.currency,
    source: "static",
    effectiveDate: row.effectiveDate,
    uncertain: row.uncertain,
    returnPrice: row.returnPrice ?? null,
  };
}

/** One row of the static fallback table, or null when nothing was sourced for that combination. */
export function staticTariff(carrier: string, country: string, method: ShipMethod): TariffQuote | null {
  const c = String(carrier || "").toLowerCase();
  const cc = String(country || "").toUpperCase();
  const row = STATIC_RATES.find((r) => r.carrier === c && r.country === cc && r.method === method);
  return row ? quoteOf(row, method) : null;
}

/** Every static row for a country, e.g. to fill the admin table in one pass. */
export function staticTariffsForCountry(country: string): TariffQuote[] {
  const cc = String(country || "").toUpperCase();
  const out: TariffQuote[] = [];
  for (const row of STATIC_RATES) {
    if (row.country !== cc) continue;
    const method = methodOf(row.method);
    if (!method) continue;
    out.push(quoteOf(row, method));
  }
  return out;
}

/* ---------- live quote, cached 24h per country ----------------------------- */

const LIVE_TTL_MS = 24 * 60 * 60 * 1000;

type LiveEntry = { at: number; rates: MontonioRate[] | null };
/* globalThis, same reasoning as montonio.ts's own pickup-point cache: survive
   Next dev reloads and warm serverless instances rather than refetch on every
   render of the admin's delivery tab. */
const g = globalThis as unknown as { __rempireMontonioRates?: Map<string, LiveEntry> };
const liveCache: Map<string, LiveEntry> = (g.__rempireMontonioRates ??= new Map());

export function resetMontonioTariffCache(): void {
  liveCache.clear();
}

/**
 * Live rates for a country, from cache when fresh. `null` when Montonio is not
 * configured or did not answer — callers fall back to the static table, they
 * never see a throw.
 */
export async function liveTariffsForCountry(country: string): Promise<MontonioRate[] | null> {
  if (!isMontonioShippingConfigured()) return null;
  const cc = String(country || "").toUpperCase();
  const hit = liveCache.get(cc);
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return hit.rates;

  const rates = await fetchMontonioRates(cc, [
    {
      length: REFERENCE_PARCEL.lengthCm,
      width: REFERENCE_PARCEL.widthCm,
      height: REFERENCE_PARCEL.heightCm,
      weight: REFERENCE_PARCEL.weightKg,
    },
  ]);
  liveCache.set(cc, { at: Date.now(), rates });
  return rates;
}

function subtypeFor(method: ShipMethod, rates: MontonioRate[], carrier: string): MontonioRate | null {
  const methodType = method === "courier" ? "courier" : "pickupPoint";
  const forCarrier = rates.filter((r) => r.carrier === carrier && r.methodType === methodType);
  if (!forCarrier.length) return null;
  const preferred = methodType === "pickupPoint" ? "parcelMachine" : "standard";
  return forCarrier.find((r) => r.subtype === preferred) ?? forCarrier[0];
}

/**
 * The best tariff we have for one carrier/country/method: live when Montonio
 * is configured and answered for that country, the static table otherwise —
 * "(a) ... falls back to the static table" from the brief, literally.
 */
export async function getMontonioTariff(
  carrier: string,
  country: string,
  method: ShipMethod,
): Promise<TariffQuote | null> {
  if (method === "pickup") return null; // self-collection at Mardi 1 — no carrier, no tariff
  const c = String(carrier || "").toLowerCase();
  const cc = String(country || "").toUpperCase();

  const live = await liveTariffsForCountry(cc);
  if (live) {
    const hit = subtypeFor(method, live, c);
    if (hit) {
      return { carrier: c, country: cc, method, price: hit.price, currency: hit.currency, source: "live" };
    }
  }
  return staticTariff(c, cc, method);
}

/**
 * Every tariff we have for a country — live rows first, the static table
 * filling in anything live did not cover (a carrier the live call answered
 * for, but only on one of the two methods; or live being unavailable at all).
 */
export async function getMontonioTariffsForCountry(country: string): Promise<TariffQuote[]> {
  const cc = String(country || "").toUpperCase();
  const live = await liveTariffsForCountry(cc);
  const out: TariffQuote[] = [];
  const seen = new Set<string>();

  if (live) {
    for (const r of live) {
      const method: ShipMethod = r.methodType === "courier" ? "courier" : "parcel";
      const preferred = method === "parcel" ? "parcelMachine" : "standard";
      // one row per carrier+method: prefer the "parcelMachine"/"standard" subtype,
      // otherwise take whichever subtype is first for that carrier
      if (r.subtype !== preferred) {
        const better = live.some(
          (o) => o.carrier === r.carrier && o.methodType === r.methodType && o.subtype === preferred,
        );
        if (better) continue;
      }
      const key = `${r.carrier}:${method}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ carrier: r.carrier, country: cc, method, price: r.price, currency: r.currency, source: "live" });
    }
  }
  for (const row of staticTariffsForCountry(cc)) {
    const key = `${row.carrier}:${row.method}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/* ---------- suggestion builder ---------------------------------------------
   Used by the admin's «Заполнить по тарифам Montonio» button (mirrored in
   public/shop2/app.js — see computeMontonioFillPatch there and
   docs/shipping.md for why the browser cannot call this module directly: the
   live leg needs MONTONIO_SECRET_KEY, which must never reach a browser). Kept
   here, real and tested, as the server-side implementation the mirror copies
   and as the base for a future admin route. */

export interface ShippingRulesPatch {
  methods: Partial<Record<ShipMethod, Record<string, number>>>;
  carriers: Record<string, Record<string, number>>;
}

/**
 * The four countries the checkout names, and the only ones where it lets the
 * shopper pick a carrier — so the only ones that get carrier-specific rows.
 */
const CARRIER_COUNTRIES = CARRIER_CHOICE_COUNTRIES;

/**
 * Every destination the static table has a price for — the four above plus
 * the twenty-one other European countries Montonio quotes out of Estonia.
 * `methods.parcel`/`methods.courier` get a row for each, which
 * quoteFromRules() (src/lib/shipping.ts) prefers over the «EU» zone cell:
 * one price for «Другая страна Европы» cannot be right when Poland costs
 * 17.86 and Croatia 52.08 for the same box.
 */
export function tariffCountries(): string[] {
  return [...new Set(STATIC_RATES.map((r) => r.country.toUpperCase()))].sort();
}

/**
 * The generic (carrier-unaware) price for a method+country, by the one rule
 * ./country-prices sets out: whoever does the choosing has to be covered.
 *
 *   · **a parcel machine in EE, LV, LT or FI** — the *shopper* picks the
 *     carrier from the chips under «Пакомат», so the price must cover the
 *     dearest of them.
 *   · **everything else, couriers at home included** — one line and no carrier
 *     under it; *Renat* picks when he makes the label. The price covers the
 *     cheapest carrier he can actually pick, and the admin prints that
 *     carrier's name beside the number so the assumption is visible.
 *
 * "Can actually pick" excludes Nova Post (Montonio International Shipping): no
 * carrier row in the admin, never named by the storefront, no returns at all.
 * Its prices are the low ones in docs/audit/2026-09-07-shipping-returns.md,
 * and pricing off a carrier the shop cannot use would sell every European
 * order below cost — Poland's cheapest reachable courier is 20.66 €, not the
 * 8.51 € the audit quoted.
 */
function methodBasis(rows: TariffQuote[], method: ShipMethod, country: string): TariffQuote | null {
  const dearest = method === "parcel" && (CARRIER_COUNTRIES as readonly string[]).includes(country);
  const usable = rows.filter(
    (r) => r.method === method && (MONTONIO_CARRIERS as readonly string[]).includes(r.carrier),
  );
  let best: TariffQuote | null = null;
  for (const r of usable) {
    if (!best || (dearest ? r.price > best.price : r.price < best.price)) best = r;
  }
  return best;
}

/**
 * Suggested settings.shipping_rules.methods/carriers from the best tariffs
 * available (live where configured, static otherwise), plus `markup`, rounded
 * to .x9.
 *
 * Only touches countries/carriers/methods this module actually has a sourced
 * tariff for. That is now every European destination Montonio quotes out of
 * Estonia, not just the four the checkout names — so «Другая страна Европы»
 * stops being one number for twenty-four countries whose real cost runs from
 * 17.86 € (Poland, parcel machine) to 52.08 € (Croatia, same box).
 *
 * Still left alone, and deliberately: the "EU" and "default" cells themselves,
 * and Venipak (Montonio quotes no contract price for it from Estonia — direct
 * contract only). "EU" now only prices the seven European countries the
 * checkout offers and Montonio serves not at all — CH, CY, GB, IS, LI, MT, NO
 * (MONTONIO_NOT_SERVED) — and no tariff can be invented for a parcel that
 * cannot be sent; those seven are switched off in the shop by default since
 * 07.09.2026 (ShippingRules.countriesOff).
 *
 * The basis rule is `methodBasis()` above. With MONTONIO_ACCESS_KEY/SECRET_KEY
 * set, the live quote only returns the carriers this store has actually
 * activated, and the whole calculation narrows to them automatically — which
 * is the real fix for a table that today has to guess which carriers are on.
 */
export async function suggestShippingRulesFromTariffs(
  markup: Partial<ShippingMarkup> = {},
): Promise<ShippingRulesPatch> {
  const patch: ShippingRulesPatch = { methods: {}, carriers: {} };
  const carrierCountries = new Set<string>(CARRIER_COUNTRIES);
  for (const country of tariffCountries()) {
    const rows = await getMontonioTariffsForCountry(country);
    for (const method of ["parcel", "courier"] as const) {
      const basis = methodBasis(rows, method, country);
      if (!basis) continue;
      patch.methods[method] = patch.methods[method] ?? {};
      (patch.methods[method] as Record<string, number>)[country] = customerPrice(basis.price, markup);
    }
    if (!carrierCountries.has(country)) continue;
    for (const row of rows) {
      if (row.method !== "parcel") continue; // checkout only ever tags a carrier for the parcel method
      // …and only for a carrier the checkout can actually name. Nova Post is
      // Montonio International Shipping, a product with no carrier row in the
      // admin's table and no `carrier` the storefront ever sends, so a price
      // under it would be a cell nobody can see and nobody can reach.
      if (!(MONTONIO_CARRIERS as readonly string[]).includes(row.carrier)) continue;
      patch.carriers[row.carrier] = patch.carriers[row.carrier] ?? {};
      patch.carriers[row.carrier][country] = customerPrice(row.price, markup);
    }
  }
  return patch;
}
