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
 * ## Nova Post is back, as a chip and nothing else (Ренат, 14.09.2026)
 *
 * «From montonio page there is Nova Post, so keep it actually… Nova Post is
 * marked as international shipping.» So it is a carrier the shop offers again:
 * its rows are in the mirror, it is in SHOP_CARRIERS, the checkout draws its
 * chip and the rate screen has a column for it.
 *
 * It is offered **only where the shopper picks a carrier from a chip** — the
 * parcel machines of EE, LV and LT (it has no Finnish locker). That is the
 * whole of it, and `CHIP_ONLY_CARRIERS` below is what holds the line, because
 * the same rows reach two very different decisions:
 *
 *   · **a chip** is a price the shopper opts into, carrier named on the
 *     button. Nova Post's EE locker costs 2.33 € against Unisend's 2.47 €, and
 *     whoever taps it gets that. Nothing else moves.
 *   · **a country/method basis** is the price everyone pays, chip or no chip,
 *     and the carrier is picked later by Renat at the label. Nova Post is the
 *     cheapest courier on fourteen routes and the cheapest locker on nine, so
 *     letting it into `rowsFor()` would silently reprice most of Europe
 *     downwards — EE courier 6.82 → 4.76, DE courier 22.23 → 12.91 — and
 *     commit the shop to actually putting those parcels on Montonio
 *     International Shipping, which has **no returns at all**
 *     (help.montonio.com/en/articles/431075). Nobody asked for that.
 *
 * docs/audit/2026-09-07-shipping-returns.md's headline numbers («Германия
 * 12,91 €, Италия 18,43 €, Польша 8,51 €») are exactly those Nova Post rows.
 * `cheapestCostAnyCarrier()` is the view that shows them, so the admin and the
 * docs can say what switching Nova Post on as a basis would be worth without
 * any price actually moving.
 *
 * Against the carriers that *are* the basis, the cheapest courier to Germany
 * is 22.23 € (SmartPosti) and to Poland 20.66 € — so 9.90 € covers the courier
 * in **no** European country, not even the one the audit found it covered.
 *
 * ## Venipak is gone (Ренат, 14.09.2026)
 *
 * «Venipak does not seem to be available, so remove.» Montonio quotes no
 * Venipak price out of Estonia at all — the contract-price endpoint answers
 * `[]` for every route, which is what `noMontonioContractPrice` in
 * src/data/montonio-tariffs.json records — so it never had a row here, a
 * column on the rate screen or a cost of its own. What it had was a chip the
 * checkout drew hopefully and a cell in a stored settings row, and both are
 * now gone: it is out of SHOP_CARRIERS, which is the list `parseShippingRules()`
 * filters a stored row through, so a `carriers.venipak` entry written in the
 * past is read as if it were not there.
 *
 * Every price here includes Estonian VAT, like the shelf prices they are
 * compared against; `src/data/montonio-tariffs.json` keeps the ex-VAT original.
 * A live quote has to mean the same thing, which is what `withEstonianVat()`
 * below is for — Montonio answers ex-VAT on both endpoints.
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
 * Estonian VAT, read from the mirror's own `vatRateEE` rather than restated:
 * the rate is written down once, in the file whose prices it was applied to,
 * so the day it moves nothing here can be left on the old one.
 */
export const VAT_RATE_EE: number = (montonioTariffsData as { vatRateEE: number }).vatRateEE;

/**
 * An ex-VAT figure from Montonio, as a price this module can compare against a
 * shelf price.
 *
 * Both endpoints answer net. `pricePerParcel` on the public contract-prices
 * endpoint is ex-VAT — Montonio's own calculator prints «+VAT» under every
 * figure — and `tools/fetch-montonio-tariffs.mjs` therefore grosses it up
 * before writing a row, which is why every `price` in the mirror includes VAT.
 * `rate` on the per-store `POST /shipping-methods/rates` is ex-VAT too:
 * Montonio confirmed that on 22.09.2026, after a reference that named `code`,
 * `rate`, `currency` and no tax field at all.
 *
 * So this is what the live leg owes the static table. `fetchMontonioRates()`
 * in ./montonio.ts is the single place that calls it — a live quote and a
 * static row are then the same kind of number, and `getMontonioTariff()` can
 * go on preferring one over the other and mixing both into one list.
 */
export function withEstonianVat(net: number): number {
  return Math.round(Number(net) * (1 + VAT_RATE_EE) * 100) / 100;
}

/**
 * The carriers the shop can actually put a parcel on: the ones the admin has a
 * row for and the storefront can name. Identical to MONTONIO_CARRIERS in
 * src/lib/shipping/montonio.ts — restated rather than imported to keep this
 * module a leaf, and asserted equal in tests/shipping-country-prices.test.ts.
 *
 * `venipak` left on 14.09.2026 and `novapost` joined the same day; see the
 * two sections at the top of this file for both.
 */
export const SHOP_CARRIERS: readonly string[] = ["omniva", "smartpost", "dpd", "unisend", "novapost"];

/**
 * Of those, the ones offered **only** as a chip the shopper taps — never as
 * the carrier a country/method price is computed from.
 *
 * A carrier reaches a bill two ways. As a chip it prices itself: its own cell,
 * its own Montonio rate, its name on the button, and only under «Пакомат» in
 * CARRIER_CHOICE_COUNTRIES. As a *basis* it prices the country — the courier
 * line, and the locker in every country with no chips — and there the carrier
 * is chosen afterwards, by Renat at the label, so the price has to be one he
 * can actually honour.
 *
 * Nova Post is a chip. It is Montonio International Shipping, it is the
 * cheapest quote on most routes it covers, and it supports no returns at all —
 * so pricing the whole of Europe off it would drop ~20 shelf prices and bind
 * every one of those parcels to a carrier the shop cannot take a return
 * through. Whether to do that is a decision of its own;
 * `cheapestCostAnyCarrier()` is what lets the admin and the docs price it up
 * without moving a cent in the meantime.
 */
export const CHIP_ONLY_CARRIERS: readonly string[] = ["novapost"];

/**
 * The four countries whose checkout lets the shopper choose the carrier, and
 * so the four that must be priced at the dearest of them.
 */
export const CARRIER_CHOICE_COUNTRIES: readonly string[] = ["EE", "LV", "LT", "FI"];

/**
 * Every country the shop can put a parcel into a pickup point in — «открыть
 * все страны, куда возит DPD» (Ренат, 18.09.2026).
 *
 * Derived, not typed: the countries the mirror prices a `parcel` row for from
 * a carrier that may be a **basis** (see `rowsFor()`), which today is DPD
 * everywhere outside the Baltics and Finland. So it is exactly «every country
 * DPD serves», and it stays exactly that when the mirror is rebuilt with live
 * keys rather than needing a second edit here.
 *
 * Two countries are deliberately not in it and it is not an oversight:
 * **Hungary and Romania** have a locker Montonio prices, but only Nova Post's
 * — `CHIP_ONLY_CARRIERS` — and offering Nova Post outside the Baltics is its
 * own decision (Montonio International Shipping, no returns at all; see the
 * head of this file and docs/shipping.md). **Greece** has no pickup point at
 * any carrier.
 *
 * This is the list before the owner narrows it. What the checkout actually
 * offers is this minus `ShippingRules.pickupOff`, which is a setting — see
 * `pickupOffered()` in src/lib/shipping.ts.
 *
 * ## What the *price* of one of these is, and what is uncertain about it
 *
 * Nothing new: `countryPriceTable().parcel` has had a cell for every one of
 * them since 07.09.2026, because `costBasis()` prices a parcel the same way
 * whether or not a checkout offers it. Opening a country changes what the
 * shopper can pick, not what it costs.
 *
 * What IS uncertain is the number itself, and it is worth being plain about
 * it: with no API keys the mirror is built from `contract-prices`, which takes
 * a single `shippingMethod=pickupPoint` and answers **one** price, while the
 * documented `POST /shipping-methods/rates` splits that into per-subtype rates
 * — `parcelMachine`, `parcelShop`, `postOffice` — each with its own. So
 * today's number for a country outside the Baltics may be the parcel-shop
 * tier where the shop is actually selling a locker. It is a cost, so a wrong
 * tier lands on the margin and never on the customer, who pays one fixed
 * price per country either way. See docs/montonio-shipping-audit.md § 3.1.
 */
export const PICKUP_POINT_COUNTRIES: readonly string[] = [
  ...new Set(
    RATES.filter(
      (r) =>
        r.method === "parcel" &&
        SHOP_CARRIERS.includes(r.carrier) &&
        !CHIP_ONLY_CARRIERS.includes(r.carrier),
    ).map((r) => r.country.toUpperCase()),
  ),
].sort();

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

/**
 * The mirror's rows for one route that a *basis* price may be computed from:
 * a carrier the shop can pick, and not one that is only ever a chip.
 *
 * `all` keeps every carrier the shop offers, chips included — the "what would
 * change if Nova Post priced the route" view, and the only caller is
 * `cheapestCostAnyCarrier()`.
 *
 * The SHOP_CARRIERS half of the filter removes nothing from today's mirror.
 * It stays because tools/fetch-montonio-tariffs.mjs still asks Montonio for
 * `venipak`, `latvian_post`, `inpost` and `orlen`: the day one of those starts
 * answering, a price the checkout cannot offer must not become the basis of a
 * shelf price.
 */
function rowsFor(country: string, method: CostMethod, all = false): StaticRateRow[] {
  const cc = String(country || "").toUpperCase();
  return RATES.filter(
    (r) =>
      r.country.toUpperCase() === cc &&
      r.method === method &&
      SHOP_CARRIERS.includes(r.carrier) &&
      (all || !CHIP_ONLY_CARRIERS.includes(r.carrier)),
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
  return pick(rowsFor(country, method), false);
}

/** The dearest carrier the shop can pick — what a shopper-chosen carrier may cost. */
export function ceilingCost(country: string, method: CostMethod): CountryCost | null {
  return pick(rowsFor(country, method), true);
}

/**
 * What ONE carrier costs on one route, **if that carrier may be a basis at
 * all** — the same rows `cheapestCost()` picks from, one carrier at a time.
 * `null` for a route the mirror has no row for, for a carrier the shop cannot
 * put a parcel on, and for a chip-only one (Nova Post).
 *
 * This is a cost, not a shelf price, and nothing bills from it. It exists so
 * the label can book the carrier the country's price was computed from:
 * `resolveCourierService()` in ./montonio walks Montonio's `/shipping-methods`
 * candidates, and until 17.09.2026 it took whichever one Montonio happened to
 * list first — while `costBasis()` had priced the order off the CHEAPEST. Any
 * dearer carrier in that list ate the margin (Germany: 22.23 € priced,
 * 32.74 € booked). Ordering that walk by this number makes the two agree.
 *
 * Nova Post returning `null` here is the point, not an omission: it is the
 * cheapest courier on most routes and it was deliberately kept out of every
 * basis (no returns at all), so a label must not prefer it either.
 */
export function basisCost(carrier: string, country: string, method: CostMethod): number | null {
  const c = String(carrier || "").trim().toLowerCase();
  if (!c) return null;
  let best: number | null = null;
  for (const r of rowsFor(country, method)) {
    if (r.carrier !== c) continue;
    if (best === null || r.price < best) best = r.price;
  }
  return best;
}

/**
 * The cheapest of *every* carrier the shop offers, chips included — which
 * today means "with Nova Post allowed to price the route".
 *
 * Not a price anything charges: `costBasis()` below never reads it. It is the
 * «what would switching Montonio International Shipping on be worth» number,
 * and it exists so the admin, the docs and a report can put a figure on that
 * question without any code having to move a price to find out. Germany's
 * courier is 22.23 € the way the shop prices it and 12.91 € this way; the
 * difference is what the decision is about.
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
  const rows = rowsFor(country, method)
    .filter((r) => typeof r.returnPrice === "number")
    .sort((a, b) => (a.returnPrice as number) - (b.returnPrice as number));
  return rows.length ? (rows[0].returnPrice as number) : null;
}

/* ---------- one tariff, one shelf price ------------------------------------
   The seller's price, not the carrier's: the tariff, rounded UP to the next
   price ending in 9 cents. Always up, never to the nearest: rounding down
   could put the shelf price below the cost that was just computed, which is
   the one thing this whole feature exists to stop happening.

   A `markup` — percent + fixed, from settings.shipping_rules — used to sit
   between the two until 14.09.2026. It reached a bill by exactly one path
   (the empty-carrier-cell fallback in quoteFromRules()), and on a shop whose
   carrier cells are all filled — which every shop's are, because
   parseShippingRules() merges carrierPriceTable() in before the stored row —
   that path is unreachable, so it never moved a price. What it *did* do was
   feed «Заполнить по тарифам Montonio», a button that wrote numbers which are
   now the default anyway. Both are gone: Ренат, 13.09.2026, «we get prices
   from Montonio and we should use those, we do not need to make them up».
   A stored row that still carries the key is read as if it did not.

   These live here, in the leaf, and are re-exported from ./tariffs so every
   existing import keeps working. */

/** Smallest amount ending in "9 cents" (…, 4.39, 4.49, 4.59, …) at or above `n`. */
export function roundUpToX9(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const cents = Math.ceil(n * 100 - 1e-7);
  const rem = ((cents % 10) + 10) % 10;
  const up = rem === 9 ? 0 : (9 - rem + 10) % 10;
  return (cents + up) / 100;
}

/** What the shopper pays for a tariff — the one step between cost and shelf. */
export function customerPrice(tariff: number): number {
  return roundUpToX9(tariff);
}

/* ---------- the shelf table ------------------------------------------------ */

export interface CountryPriceTable {
  parcel: Record<string, number>;
  courier: Record<string, number>;
}

/**
 * One price per country per method, from `costBasis()` — the table
 * DEFAULT_SHIPPING_RULES is built on. A country/method Montonio quotes no
 * reachable carrier for gets no cell at all rather than an invented one:
 * Greece has no parcel machine, Hungary and Romania have none the shop can
 * use, and a made-up number there would be a price for a parcel that cannot
 * be sent.
 */
export function countryPriceTable(): CountryPriceTable {
  const out: CountryPriceTable = { parcel: {}, courier: {} };
  for (const country of MONTONIO_COUNTRIES) {
    for (const method of ["parcel", "courier"] as const) {
      const basis = costBasis(country, method);
      if (!basis) continue;
      out[method][country] = customerPrice(basis.price);
    }
  }
  return out;
}

/**
 * What the shop charges for this country and method when the box is left
 * empty — Montonio's own price for the route, the same number
 * `countryPriceTable()` carries. `null` where Montonio quotes no carrier the
 * shop can use (Greece has no parcel machine; the seven it has no route to
 * have nothing at all).
 *
 * The carrier-unaware twin of `carrierPrice()` below, and read in the same
 * two places: `quoteFromRules()` takes it after the owner's own cell and
 * before the zone, so an empty box means «цена Montonio» in the «Курьер»
 * column exactly as it does in a carrier one; `belowCostCells()` refuses a
 * save under it, so the floor the guard enforces is the number the screen
 * prints under the box rather than a rawer one nobody can reach.
 */
export function methodPrice(country: string, method: CostMethod): number | null {
  const basis = costBasis(country, method);
  return basis ? customerPrice(basis.price) : null;
}

/* ---------- one price per carrier, which is how Montonio actually bills ----
 *
 * Ренат, 13.09.2026: «we get prices from Montonio and we should use those, we
 * do not need to make them up.»
 *
 * The table above is one price per country, and that is the wrong *shape* for
 * a parcel machine: the shopper picks the carrier from the chips under
 * «Пакомат», and Montonio charges a different price for each of them. Finland
 * is 9.30 € with SmartPosti and 12.39 € with DPD; the shop charged 7.89 € for
 * both, because an empty carrier cell fell through to the country's own
 * «Пакомат» number. Nine of the fourteen carrier-country pairs the checkout
 * can actually produce were sold below cost, and the shopper chose which.
 *
 * So an empty carrier cell now means «charge what Montonio charges for THIS
 * carrier» — that is `carrierCost()` below, resolved in quoteFromRules(). A
 * number the owner typed still wins: this is the floor the table falls back
 * to, not a ceiling over him.
 */

/**
 * What Montonio charges for one carrier on one route, or null if it has no
 * price — and null, too, wherever a carrier is not the *shopper's* to choose.
 *
 * A carrier price only means anything under «Пакомат» in EE, LV, LT and FI:
 * those are the only chips the checkout draws (CARRIERS_BY_COUNTRY in
 * public/shop2/app.js). Everywhere else — and for every courier — Renat picks
 * the carrier when he makes the label, so the country's own cell is the price
 * and a per-carrier one would be a number nobody can reach. Narrowing it here
 * is also what keeps the storefront's mirror of this table small enough to
 * state literally, and therefore checkable against this one.
 */
export function carrierCost(carrier: string, country: string, method: CostMethod): number | null {
  const c = String(carrier || "").toLowerCase();
  if (!c || !SHOP_CARRIERS.includes(c)) return null;
  if (method !== "parcel") return null;
  const cc = String(country || "").toUpperCase();
  if (!CARRIER_CHOICE_COUNTRIES.includes(cc)) return null;
  let best: number | null = null;
  for (const r of RATES) {
    if (r.carrier !== c || r.method !== method || r.country.toUpperCase() !== cc) continue;
    if (best === null || r.price < best) best = r.price;
  }
  return best;
}

/** The shelf price for one carrier on one route — what an empty cell charges — or null. */
export function carrierPrice(carrier: string, country: string, method: CostMethod): number | null {
  const cost = carrierCost(carrier, country, method);
  return cost === null ? null : customerPrice(cost);
}

/**
 * `{ dpd: { FI: 12.49, … }, … }` — every carrier-country pair Montonio prices
 * for a parcel machine. What DEFAULT_SHIPPING_RULES carries, so a shop that
 * has never touched the panel already bills what the carrier costs rather
 * than one flat number per country.
 *
 * Parcel machines only, deliberately: the checkout shows carrier chips under
 * «Пакомат» and nowhere else (CARRIERS_BY_COUNTRY in public/shop2/app.js), so
 * a courier never carries a carrier the shopper chose — Renat picks that one
 * when he makes the label, and the country's own courier cell prices it.
 */
export function carrierPriceTable(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const carrier of SHOP_CARRIERS) {
    for (const country of CARRIER_CHOICE_COUNTRIES) {
      const cost = carrierCost(carrier, country, "parcel");
      if (cost === null) continue;
      (out[carrier] ??= {})[country] = customerPrice(cost);
    }
  }
  return out;
}
