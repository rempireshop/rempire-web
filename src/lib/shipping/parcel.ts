/**
 * Коробка магазина: одна объявленная посылка и одна ячейка пакомата.
 *
 * ## Why a declared box exists at all
 *
 * `GET /shipping-methods` answers, per carrier + method + country, with
 * `constraints.parcelDimensionsRequired`, and the reference puts a Note beside
 * it: *«Always check the flag in the API response … conditionally require
 * dimension inputs»*. Where it is `true`, `POST /shipments` needs
 * `parcels[].length/width/height` or the carrier refuses the parcel. We never
 * read the flag and never sent the numbers (docs/montonio-shipping-audit.md
 * § 1.6), so every route with the flag set was a booking that could not work.
 *
 * Real measurements do not exist and cannot be made up: the catalogue has no
 * dimensions and no weight for any of its 220 products. 87 of them carry a
 * named volume in `src/data/catalogue.variants.json` — «250 мл» — and nothing
 * else; millilitres are not a box. Ренат, 18.09.2026: «one default parcel
 * size, overridable». So the shop declares **one carton**, he can change it,
 * and it is what goes out wherever Montonio asks for dimensions.
 *
 * ## Why the box is SMALL, and why that is the whole feature
 *
 * Montonio bills **`chargeableWeight = max(actualWeight, volumetricWeight)`** —
 * its own words, in the `calculationDetails.estimatedParcels[]` block of the
 * `POST /shipping-methods/rates` response (reference § Calculate shipping
 * costs). `fetchMontonioRates()` throws that block away today, which is why
 * nobody here had seen it.
 *
 * Volumetric weight is the box's volume over a divisor. The reference prints
 * **no formula at all**, only one worked example: **20 × 15 × 10 cm → 0.75 kg**.
 * 3000 cm³ / 0.75 kg is a divisor of 4000, and that single example is the only
 * evidence there is — so `volumetricKg()` below divides by 4000 and says out
 * loud that it is an estimate. It is **not** /5000 plus the documented
 * `bufferApplied`: the reference describes `bufferApplied` as a buffer
 * percentage applied to **height**, for stacking, and prints 15 % — a
 * different quantity applied to a different thing (audit 18.09.2026, F30).
 * The arithmetic is unchanged either way; only the claim about where it comes
 * from was wrong, and a comment the documentation contradicts is how the next
 * reader is misled. `tools/lib/delivery-pricing.mjs` reads the real
 * `chargeableWeight` off Montonio's own answer and needs no divisor; the open
 * question is in `docs/montonio-questions.md § 6`.
 *
 * The conclusion is that at this shop's parcel sizes **the declared box, not
 * what is in it, is what gets paid for**. A 30 × 30 × 30 carton — which is
 * what `REFERENCE_PARCEL` is, and what this file declared until the afternoon
 * of 18.09.2026 — is 27 000 cm³, i.e. 6.75 kg of chargeable weight whatever is
 * inside, against the 1.4 kg three 250 ml bottles would really weigh. So the
 * shop would have been buying five kilos of cardboard on every single parcel.
 *
 * 25 × 18 × 10 cm is 4500 cm³ — 1.13 kg — and that is under or near the
 * real weight of an ordinary order, which is the point: the box stops being
 * the thing that is billed. It is sized from the catalogue rather than
 * guessed: the variants file tops out at 500 ml (a bottle roughly 7 × 7 × 22
 * cm, which lies down inside 25 cm) and its commonest size by a long way is
 * 250 ml, forty of the hundred and fifty-two.
 *
 * Ренат, 18.09.2026: *«use a smaller default box then and we don't bother with
 * weights — so we just have a good solution & in edge cases maybe take a small
 * loss — it's rather more important to show one stable price and be as precise
 * as possible and don't over-engineer this feature.»*
 *
 * **So there is no weight modelling here and there must not be one.** No
 * basket-to-weight estimator, no per-country cartons, no size ladder. A rare
 * heavy order costing a little more than it charges is a loss taken on
 * purpose, in exchange for one stable price the customer understands.
 * Weighing the 220 products was an open item since 14.09.2026 and is
 * cancelled; nothing here waits on it.
 *
 * Until 19.09.2026 that rule was only half kept: the carton was declared
 * where Montonio asked for dimensions, but `parcels[].weight` on **every**
 * `POST /shipments` carried `estimateWeightKg()` — 0.4 kg per unit plus 0.2 —
 * so from three units on it was the guess, not the box, that Montonio billed
 * (audit 18.09.2026, F24). And on most routes `parcelDimensionsRequired` is
 * false, so there is no volumetric weight on Montonio's side to compare
 * against and the declared weight is the whole bill. Ренат, 18.09.2026 23:10:
 * remove the estimate and declare the box. `declaredWeightKg()` is therefore
 * `volumetricKg()` of this carton — one number, the same on a one-line order
 * and a nine-line one, and the same number the panel already prints under
 * «Коробка магазина». An explicit weight typed into the label form still wins.
 *
 * ## What this box is NOT, and it matters
 *
 * It is **not** the box the price table was quoted for. `REFERENCE_PARCEL`
 * (src/lib/shipping/tariffs.ts) is still 5 kg, 30 × 30 × 30 cm, and that is
 * the shape `tools/fetch-montonio-tariffs.mjs` and `liveTariffsForCountry()`
 * ask Montonio to price. So src/data/montonio-tariffs.json now **overstates**
 * what a parcel of this size costs. That is the safe direction — every shelf
 * price sits above cost rather than under it, and the save-time guard is
 * conservative rather than wrong — but it is a real gap, and closing it is a
 * pricing decision (it moves every shelf price down) rather than this one.
 *
 * ## Units — the two endpoints really do differ
 *
 * These numbers are **centimetres**, because that is what a tape measure says
 * and the owner types them. They reach Montonio two ways and only one of them
 * is centimetres:
 *
 *   · `POST /shipments` — **metres** (reference § Create Shipment → parcels,
 *     «height should be measured in meters»). `parcelMetres()` below is the
 *     only converter, and `createMontonioShipment()` is its only caller.
 *   · `POST /shipping-methods/rates` — **centimetres**, via
 *     `items[].dimensionUnit: "cm"` which `fetchMontonioRates()` sends
 *     explicitly (src/lib/shipping/montonio.ts).
 *
 * Both are correct in this codebase today and neither is a bug to be "fixed"
 * into agreement with the other.
 *
 * ## The locker size is a price tier, so it is chosen over the box
 *
 * `lockerSize` (`XS | S | M | L | XL`) is a field on **Create Shipment** —
 * that is, on the moment Renat presses «Создать этикетку», standing over the
 * box he has just packed. It applies to Unisend, Latvian Post and SmartPosti;
 * omitting it falls back to the contract's own `defaultLockerSize`.
 *
 * Ренат, 18.09.2026: «use recommended, but we have also option that some
 * default is set and used + automate it — maybe each package will be almost
 * always at same size». So both halves: the size lives on the shipment, and a
 * default is genuinely set and pre-selected, so the step is a **confirmation
 * and not a question**. `suggestedLockerSize()` derives it from what he has
 * actually been shipping — the commonest of the last twenty labels, ties
 * broken by the most recent — and `rememberLockerSize()` is what learns it.
 *
 * The seed, before he has ever pressed the button, is `M`, and it is the
 * declared box's own tier read off the carriers' door lists
 * (public/shop/shipping-data.js): 25 × 18 × 10 cm goes through Omniva's M
 * (19 × 38 × 64), DPD's M (17 × 43 × 61) and SmartPosti's **S** (12 × 34 × 42).
 * S would be cheaper and would fit the one carrier of the three that the shop
 * actually offers — but a door too small is a failed drop-off in a car park
 * and a door one size too big is about a euro, so the seed is the size that
 * fits everywhere and the first label he sends teaches it the rest.
 *
 * **The contract default stays underneath as the safety net.** For SmartPosti
 * with neither a request value nor a contract default the parcel registers
 * with *no drop-off code at all* — and a blank code on the A4 slip
 * (src/lib/shipping/label-pdf.ts) is exactly Renat's complaint of 13.09.2026.
 * This module can only ever put a value on the request; setting
 * `defaultLockerSize` on the SmartPosti contract in the Partner System is his,
 * and so is switching DPD's PIN service on. The panel names both, in Russian,
 * right under the carton («Коробка магазина» in public/shop2/app.js), so that
 * neither is forgotten and so that a blank drop-off code has an explanation
 * rather than a mystery.
 */
import { jsonbParam, query } from "@/lib/db";

/** The five doors Montonio names — reference § Create Shipment → shippingMethod. */
export const LOCKER_SIZES = ["XS", "S", "M", "L", "XL"] as const;
export type LockerSize = (typeof LOCKER_SIZES)[number];

/**
 * The carriers that take `lockerSize` at all. Anything else is sent without
 * one — a field a carrier does not know is a 400, not a courtesy.
 *
 * `latvian_post` is on the list because the reference names it, even though
 * `SHOP_CARRIERS` does not carry it today: Montonio quotes no Latvian Post
 * price out of Estonia, so the shop cannot pick it, but the day it can this
 * list must not be the thing that is wrong.
 */
export const LOCKER_SIZE_CARRIERS: readonly string[] = ["unisend", "smartpost", "latvian_post"];

/** Does this carrier take a locker size on Create Shipment? */
export function takesLockerSize(carrier: unknown): boolean {
  return LOCKER_SIZE_CARRIERS.includes(String(carrier || "").trim().toLowerCase());
}

/** How many past labels the suggestion looks at. Twenty is a month of Rempire. */
export const LOCKER_HISTORY = 20;

/** Nothing the owner can type is allowed outside this — a carton, not a pallet. */
export const MIN_CM = 1;
export const MAX_CM = 200;

export interface ParcelSettings {
  /** The declared carton, centimetres. Metres only ever exist on the wire. */
  length: number;
  width: number;
  height: number;
  /** The door to ask for when the owner has no history yet. */
  lockerSize: LockerSize;
  /** What he actually picked, newest first, at most LOCKER_HISTORY long. */
  recent: LockerSize[];
}

/** 25 × 18 × 10 cm — 1.13 kg of volumetric weight. See the head of this file. */
export const PARCEL_DEFAULTS: ParcelSettings = {
  length: 25,
  width: 18,
  height: 10,
  lockerSize: "M",
  recent: [],
};

/**
 * What Montonio will bill this box as, in kilograms — `volumetricWeight` in
 * its own `calculationDetails`.
 *
 * **This is an estimate and it has to be read as one.** The reference prints
 * no formula, only the single worked example 20 × 15 × 10 cm → 0.75 kg, and
 * 3000 cm³ / 0.75 kg is the /4000 below. Nothing else about it is documented:
 * in particular `bufferApplied` is *not* part of it — the reference calls it a
 * buffer percentage applied to **height** for stacking, and prints 15 %. The
 * one number that is not a guess is `chargeableWeight`, which comes back on
 * `POST /shipping-methods/rates` and which `tools/lib/delivery-pricing.mjs`
 * reads. `docs/montonio-questions.md § 6` asks Montonio for the divisor.
 *
 * Two readers, and both want the same number:
 *   · the panel prints it beside the three boxes («около N кг»), so the owner
 *     can see a bigger carton costing more before he saves it;
 *   · `declaredWeightKg()` is this, and it is what goes out as
 *     `parcels[].weight` on every shipment.
 */
export function volumetricKg(p: Pick<ParcelSettings, "length" | "width" | "height">): number {
  return Math.round(((p.length * p.width * p.height) / 4000) * 100) / 100;
}

/**
 * The weight this shop declares on `POST /shipments` — the box, never the
 * basket.
 *
 * Ренат, 18.09.2026: «one small default carton, no weight modelling». That is
 * a decision about money, not about tidiness: dimensions go out only where
 * `constraints.parcelDimensionsRequired` is true, so on most routes Montonio
 * has no volumetric weight of its own to compare against and **the declared
 * weight is the entire bill**. A per-unit estimate therefore made the shop's
 * cost per parcel climb with the line count while the customer paid one flat
 * price — which is what `estimateWeightKg()` did on every booking until
 * 19.09.2026 (audit 18.09.2026, F24).
 *
 * So: one number, derived from the carton he set, identical on a one-line
 * order and a nine-line one. The edge case is accepted out loud — a genuinely
 * heavy parcel is re-weighed by the carrier and surcharged, and that is the
 * small loss traded for a figure that never surprises him.
 */
export function declaredWeightKg(p: Pick<ParcelSettings, "length" | "width" | "height">): number {
  /* Montonio's own floor: `weight` must be a positive number, and a carton
     small enough to round to zero would be refused rather than cheap. */
  return Math.max(0.1, volumetricKg(p));
}

export const PARCEL_SETTINGS_KEY = "shipping_parcel";

function cm(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(Math.min(MAX_CM, Math.max(MIN_CM, n)) * 10) / 10;
}

/** "l" → "L", anything else → null. The wire enum is upper-case. */
export function toLockerSize(v: unknown): LockerSize | null {
  const s = String(v ?? "").trim().toUpperCase();
  return (LOCKER_SIZES as readonly string[]).includes(s) ? (s as LockerSize) : null;
}

/**
 * The first door for `settings.shipping_parcel`, in the same shape as
 * `cleanDelivery()` and `cleanShippingRules()`: a value that reaches the
 * database is already inside its bounds, whoever wrote it.
 */
export function cleanParcel(raw: unknown): ParcelSettings {
  const x = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const recentRaw = Array.isArray(x.recent) ? x.recent : [];
  const recent: LockerSize[] = [];
  for (const entry of recentRaw) {
    const size = toLockerSize(entry);
    if (size) recent.push(size);
    if (recent.length >= LOCKER_HISTORY) break;
  }
  return {
    length: cm(x.length, PARCEL_DEFAULTS.length),
    width: cm(x.width, PARCEL_DEFAULTS.width),
    height: cm(x.height, PARCEL_DEFAULTS.height),
    lockerSize: toLockerSize(x.lockerSize) ?? PARCEL_DEFAULTS.lockerSize,
    recent,
  };
}

/** The declared carton in **metres**, which is the unit `POST /shipments` takes. */
export function parcelMetres(p: ParcelSettings): { length: number; width: number; height: number } {
  const m = (v: number) => Math.round((v / 100) * 100) / 100;
  return { length: m(p.length), width: m(p.width), height: m(p.height) };
}

/**
 * The door to pre-select — a confirmation, not a question.
 *
 * The commonest of the last twenty labels; a tie goes to the one used most
 * recently, because `recent` is newest-first and the scan keeps the first
 * winner it meets. With no history at all it is `lockerSize`, the owner's own
 * default, seeded at `M` — `PARCEL_DEFAULTS.lockerSize`, and the head of this
 * file says why it is the size that fits all three carriers' doors.
 */
export function suggestedLockerSize(p: ParcelSettings): LockerSize {
  const counts = new Map<LockerSize, number>();
  for (const size of p.recent) counts.set(size, (counts.get(size) ?? 0) + 1);
  let best: LockerSize | null = null;
  let bestCount = 0;
  /* Walked in `recent` order, not in map order: the first size met at a given
     count is the most recently used one, so a 2–2 tie resolves to «как в
     прошлый раз» rather than to whichever Map iteration happened to reach
     first. */
  for (const size of p.recent) {
    const n = counts.get(size) ?? 0;
    if (n > bestCount) {
      best = size;
      bestCount = n;
    }
  }
  return best ?? p.lockerSize;
}

/** Why the panel says that size is offered — one short Russian phrase. */
export function lockerSizeReason(p: ParcelSettings): string {
  if (!p.recent.length) return "по умолчанию";
  const suggested = suggestedLockerSize(p);
  if (p.recent[0] === suggested && p.recent.filter((s) => s === suggested).length === 1) {
    return "как в прошлый раз";
  }
  return "чаще всего";
}

/** The settings value after one more label — pure, so the route can audit it. */
export function rememberLockerSize(p: ParcelSettings, size: LockerSize): ParcelSettings {
  return { ...p, recent: [size, ...p.recent].slice(0, LOCKER_HISTORY) };
}

/**
 * What PUT /api/admin/settings should store for `shipping_parcel`.
 *
 * `recent` is not a form field: it is written by the label route, one size per
 * label, and it is what `suggestedLockerSize()` learns from. A save of the
 * carton boxes that did not mention it would therefore *erase the history*
 * every time the owner changed a dimension — the automation quietly resetting
 * itself whenever he touched the screen it is shown on. So a value that
 * carries no `recent` of its own keeps the stored one, and only an explicit
 * array replaces it.
 */
export async function mergeParcel(raw: unknown): Promise<ParcelSettings> {
  const incoming = cleanParcel(raw);
  const x = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  if (Array.isArray(x.recent)) return incoming;
  const stored = await getParcelSettings();
  return { ...incoming, recent: stored.recent };
}

/**
 * Read the row. Never throws: a shop whose database is unreachable still has
 * to be able to print a label, and the defaults are a real carton.
 */
export async function getParcelSettings(): Promise<ParcelSettings> {
  try {
    const rows = await query<{ value: unknown }>(
      "select value from settings where key = 'shipping_parcel'",
    );
    let raw: unknown = rows.length ? rows[0].value : null;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = null;
      }
    }
    return cleanParcel(raw);
  } catch {
    return { ...PARCEL_DEFAULTS, recent: [] };
  }
}

/**
 * Write one chosen door back, newest first. Best effort on purpose: the parcel
 * is already booked by the time this runs, and failing to remember a size is
 * not a reason to tell the owner his label failed.
 */
export async function noteLockerSize(size: LockerSize): Promise<void> {
  try {
    const current = await getParcelSettings();
    const next = rememberLockerSize(current, size);
    await query(
      `insert into settings (key, value, updated_at) values ('shipping_parcel', $1::jsonb, now())
       on conflict (key) do update set value = $1::jsonb, updated_at = now()`,
      [jsonbParam(next)],
    );
  } catch (err) {
    console.error("[shipping parcel] could not remember the locker size —", err);
  }
}
