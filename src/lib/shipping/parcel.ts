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
 * no formula, only a worked example: **20 × 15 × 10 cm → 0.75 kg**. 3000 cm³
 * over the industry-standard 5000 is 0.6 kg, so either the divisor is 4000 or
 * the documented `bufferApplied` is a further 25 % on top of /5000. Both
 * readings give the same number, and both give the same conclusion.
 *
 * The conclusion is that at this shop's parcel sizes **the declared box, not
 * what is in it, is what gets paid for**. A 30 × 30 × 30 carton — which is
 * what `REFERENCE_PARCEL` is, and what this file declared until the afternoon
 * of 18.09.2026 — is 27 000 cm³, i.e. 5.4–6.75 kg of chargeable weight
 * whatever is inside. An order of three 250 ml bottles weighs 1.4 kg
 * (`estimateWeightKg`). So the shop would have been buying five kilos of
 * cardboard on every single parcel.
 *
 * 25 × 18 × 10 cm is 4500 cm³ — about 1.1 kg — and that is under or near the
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
 * basket-to-weight estimator beyond the one that already exists, no per-country
 * cartons, no size ladder. A rare heavy order costing a little more than it
 * charges is a loss taken on purpose, in exchange for one stable price the
 * customer understands. Weighing the 220 products was an open item since
 * 14.09.2026 and is cancelled; nothing here waits on it.
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

/** 25 × 18 × 10 cm — about 1.1 kg of volumetric weight. See the head of this file. */
export const PARCEL_DEFAULTS: ParcelSettings = {
  length: 25,
  width: 18,
  height: 10,
  lockerSize: "M",
  recent: [],
};

/**
 * What Montonio will bill this box as, in kilograms — `volumetricWeight` in
 * its own `calculationDetails`. Not used to price anything: it is what the
 * panel prints beside the three boxes so the owner can see a bigger carton
 * costing more before he saves it, which is the only way «объявите коробку
 * поменьше» is advice rather than a slogan.
 *
 * /5000 is the industry-standard divisor and the one that, with the
 * documented `bufferApplied`, reproduces the reference's worked example
 * (20 × 15 × 10 → 0.75). The number is therefore a good estimate and not a
 * quote, and the panel says «около».
 */
export function volumetricKg(p: Pick<ParcelSettings, "length" | "width" | "height">): number {
  return Math.round(((p.length * p.width * p.height) / 5000) * 1.25 * 100) / 100;
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
 * default, seeded at `L`.
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
