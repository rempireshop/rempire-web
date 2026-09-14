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
 * Neither source is wired into checkout pricing, and that is the whole
 * reason the rate screen no longer claims to show a live number (14.09.2026).
 * `computeShipping()` in src/lib/shipping.ts prices strictly from
 * `settings.shipping_rules`, synchronously and DB-cached; a quote that has to
 * wait on Montonio is a checkout that cannot take money. So the panel prints
 * the same offline mirror the till bills from and the save guard refuses
 * under — one number in all three places — and this module's live leg serves
 * `/api/admin/shipping/rates/`, which is where «what does Montonio charge
 * *this* store today» is asked on purpose rather than by accident.
 */
import montonioTariffsData from "@/data/montonio-tariffs.json";
import type { ShipMethod } from "@/lib/shipping";
import {
  fetchMontonioRates,
  isMontonioShippingConfigured,
  type MontonioRate,
} from "./montonio";

/* The cost/price arithmetic and the not-served list live down in
   ./country-prices, the leaf src/lib/shipping.ts can import without a cycle.
   Re-exported here because this is where the rest of the codebase looks for
   them, and one implementation is the whole point. */
export {
  ceilingCost,
  cheapestCost,
  costBasis,
  countryPriceTable,
  customerPrice,
  methodPrice,
  MONTONIO_COUNTRIES,
  MONTONIO_NOT_SERVED,
  montonioServes,
  returnCost,
  roundUpToX9,
  SHOP_CARRIERS,
  type CountryCost,
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
   * return on that route (every SmartPosti row and some DPD ones),
   * `undefined` on a live quote, which does not carry the field.
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

/* ---------- what the rate screen used to fill -------------------------------
   `suggestShippingRulesFromTariffs()` lived here until 14.09.2026, with
   `ShippingRulesPatch`, `methodBasis()` and `CARRIER_COUNTRIES`. It was the
   server-side twin of the panel's «Заполнить по тарифам Montonio» button:
   tariff + markup → the numbers to write into settings.shipping_rules.
   Both are gone. Since 13.09.2026 an empty cell already *means* Montonio's
   price for that carrier (quoteFromRules in src/lib/shipping.ts), and since
   14.09.2026 the courier column reads the same way — so the button's whole
   job was writing numbers that are now the default, and the markup it added
   on the way never reached a bill. Ренат: «it seems to me that this delivery
   is a bit over engineered». It is in git at the commit before this one. */

/**
 * Every destination the static table has a price for — the four the checkout
 * names plus the twenty-one other European countries Montonio quotes out of
 * Estonia. `/api/admin/shipping/rates/` answers for these and refuses the
 * rest, so a request cannot ask Montonio about a route nothing sells.
 */
export function tariffCountries(): string[] {
  return [...new Set(STATIC_RATES.map((r) => r.country.toUpperCase()))].sort();
}
