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
 * ## Montonio prices the REAL weight (answer of 24.09.2026)
 *
 * Everything in the next section was written believing the opposite, and is
 * kept because the box is still the right size for other reasons (the locker
 * door, and DPD's size categories abroad). Montonio support, 24.09.2026: «our
 * pricing for time being takes into account real weight. If that will
 * change, then we'd let them know.» The divisor 4000 is real — it lives in
 * their `VolumetricWeightHelper` — but it does not set the price. See
 * `MONTONIO_PRICES_VOLUMETRIC` below: the one switch that brings the old rule
 * back, and what `declaredWeightKg()` now declares (`ORDINARY_PARCEL_KG`,
 * whatever box is on the card).
 *
 * ## Why the box is SMALL (as reasoned 18.09.2026)
 *
 * Montonio bills **`chargeableWeight = max(actualWeight, volumetricWeight)`** —
 * its own words, in the `calculationDetails.estimatedParcels[]` block of the
 * `POST /shipping-methods/rates` response (reference § Calculate shipping
 * costs). `fetchMontonioRates()` throws that block away today, which is why
 * nobody here had seen it. [24.09.2026: that block describes the helper's
 * arithmetic, not the tariff — see the section above.]
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
 * 25 × 18 × 8 cm is 3600 cm³ — 0.9 kg — and that is under or near the
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
 * remove the estimate and declare the box. `declaredWeightKg()` was therefore
 * `volumetricKg()` of this carton — one number, the same on a one-line order
 * and a nine-line one. Since 24.09.2026 it is `ORDINARY_PARCEL_KG` (the same
 * 0.9 kg for this carton, and no longer 6 kg for a 40 × 30 × 20 one) — still
 * one number, now a real weight. An explicit weight typed into the label form
 * still wins.
 *
 * ## The price table is quoted for this box
 *
 * Since 22.09.2026 `REFERENCE_PARCEL` (src/lib/shipping/tariffs.ts) is this
 * carton at `declaredWeightKg()` — 25 × 18 × 8 cm, 0.9 kg — and it is the
 * shape `tools/fetch-montonio-tariffs.mjs` and `liveTariffsForCountry()` ask
 * Montonio to price (until then it was a 30 cm cube at 5 kg, which priced
 * every DPD locker abroad as the L category). `tests/reference-parcel.test.ts`
 * holds the two together.
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
 * The seed, before he has ever pressed the button, is `S`. Only Unisend,
 * SmartPosti and Latvian Post take the field at all, and the carton
 * (25 × 18 × 8, 22.09.2026) goes through Unisend's S (8 × 35 × 61) and
 * SmartPosti's S (12 × 34 × 42); Unisend's XS (8 × 18.5 × 61) would leave
 * 5 mm. It was `M` until 23.09.2026 — written for a 10 cm box and kept as
 * «one size generous» — and M bought nothing: all three carriers price a
 * locker flat, at every size and to every country they reach (checked against
 * Montonio's contract prices that day), so the door is a question of fit
 * alone. His own last twenty labels overrule the seed anyway.
 *
 * **The contract default stays underneath.** Omitted on the request,
 * Montonio uses the carrier's `defaultLockerSize` from the Partner System —
 * which since 23.09.2026 says S for Unisend too. A blank drop-off code on the
 * A4 slip is normal: Montonio, in writing on 22.09.2026, a door code needs the
 * merchant's own direct contract with the carrier, and the label is scanned
 * at the machine instead.
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

/**
 * 25 × 18 × 8 cm — 0.9 kg of volumetric weight. Renat's own black carton,
 * measured by him on 22.09.2026 («18х25х8, высота 8 см»; smaller boxes now
 * and then, a bigger one very rarely). Until that day this said 10 cm, a guess
 * from the catalogue, and those two centimetres were a whole DPD tier abroad:
 * DPD's XS and S drawers are both 8 cm tall, so 10 cm is an M and 8 cm is an
 * XS. See the head of this file.
 *
 * **This is also the box the price table is quoted for** — `REFERENCE_PARCEL`
 * in ./tariffs is derived from it and `tools/fetch-montonio-tariffs.mjs`
 * restates it; `tests/reference-parcel.test.ts` fails the day they differ.
 */
export const PARCEL_DEFAULTS: ParcelSettings = {
  length: 25,
  width: 18,
  height: 8,
  lockerSize: "S",
  recent: [],
};

/**
 * **Does Montonio price a parcel by its volumetric weight? Not today.**
 *
 * Montonio support, 24.09.2026, in answer to «is the divisor 4000?»:
 *
 *   «Volumetric divisor — confirmed `4000` in `VolumetricWeightHelper`. For a
 *   single parcel item there is 0% height padding, so 20×15×10cm / 4000 =
 *   0.75kg exactly … For multiple items in one shipment, the helper adds 15%
 *   padding to the combined stacked height before dividing … Important to
 *   know is that our pricing for time being takes into account real weight.
 *   If that will change, then we'd let them know.»
 *
 * So the rule this file was built on in September — `chargeableWeight =
 * max(actual, volumetric)`, «the box, not the contents, is what gets paid
 * for» — is how Montonio's helper computes a number, not how Montonio prices.
 * The price is the REAL weight's tier (and, on some DPD routes abroad, the
 * box's size category — XS/S/M/L — which is a different thing again: see
 * docs/montonio-routes.md and docs/montonio-evidence-2026-09-24.txt).
 *
 * This constant is the one place the volumetric rule can come back from. Flip
 * it the day Montonio writes that it has changed, and `chargeableKg()`,
 * `declaredWeightKg()` and the panel's copy of both (PARCEL_PRICES_VOLUMETRIC
 * in public/shop2/app.js, held equal by tests/shipping-real-weight.test.ts)
 * go back to max(actual, volumetric) together.
 */
export const MONTONIO_PRICES_VOLUMETRIC = false;

/**
 * The real weight an ordinary Rempire parcel is declared at when nobody has
 * put it on a scale — 0.9 kg.
 *
 * One or two bottles and the 25 × 18 × 8 carton: `estimateWeightKg()` makes a
 * one-unit order 0.6 kg and a two-unit one 1.0 kg. 0.9 is under the 1 kg line
 * where the first weight tier of Montonio's routes out of Estonia ends
 * (src/data/montonio-tariffs.json: `maxWeightKg: 1` on every `weightBased`
 * row except DPD's couriers to LV and LT, whose first tier runs to 10 kg),
 * and it is the number the tariff mirror is quoted at, so
 * shelf price and bill are looked up in the same tier. It is also the figure
 * the label declared before 24.09.2026 — the default carton's volumetric
 * weight happened to be exactly this — so no price moved when the reason for
 * it changed.
 *
 * Ренат, 18.09.2026: «no weight modelling». This is still one number for every
 * parcel, not an estimate per basket; a genuinely heavy order is re-weighed by
 * the carrier and surcharged, the small loss he accepted in exchange for one
 * stable price.
 */
export const ORDINARY_PARCEL_KG = 0.9;

/**
 * The box's volumetric weight, in kilograms — `volumetricWeight` in Montonio's
 * own `calculationDetails`.
 *
 * The divisor is Montonio's, confirmed 24.09.2026 (`VolumetricWeightHelper`,
 * 4000, no height padding for a single item; 15 % on the stacked height when a
 * shipment has several items — the shop always sends one). Until then it was
 * inferred from the reference's one worked example, 20 × 15 × 10 cm → 0.75 kg.
 *
 * **It does not set the price** while MONTONIO_PRICES_VOLUMETRIC is false —
 * see there. It stays for the day it does, and for `chargeableKg()`.
 */
export function volumetricKg(p: Pick<ParcelSettings, "length" | "width" | "height">): number {
  return Math.round(((p.length * p.width * p.height) / 4000) * 100) / 100;
}

/**
 * The weight Montonio looks a price tier up at, for a parcel of `realKg` in
 * box `p`: the real weight today, max(real, volumetric) if Montonio ever
 * switches (MONTONIO_PRICES_VOLUMETRIC).
 */
export function chargeableKg(realKg: number, p: Pick<ParcelSettings, "length" | "width" | "height">): number {
  const real = Math.round(Math.max(0, Number(realKg) || 0) * 100) / 100;
  return MONTONIO_PRICES_VOLUMETRIC ? Math.max(real, volumetricKg(p)) : real;
}

/**
 * The weight this shop declares on `POST /shipments` when nobody weighed the
 * parcel — one number, never the basket.
 *
 * Ренат, 18.09.2026: «one small default carton, no weight modelling». A
 * per-unit estimate made the shop's cost per parcel climb with the line count
 * while the customer paid one flat price — which is what `estimateWeightKg()`
 * did on every booking until 19.09.2026 (audit 18.09.2026, F24).
 *
 * Until 24.09.2026 that one number was the VOLUMETRIC weight of the box on the
 * card — right by coincidence for the default carton (0.9 kg either way) and
 * wrong for any other: «Другая коробка» 40 × 30 × 20 declared 6 kg, and
 * Montonio prices the real weight, so a 6 kg declaration is the 6 kg tier.
 * Now it is `ORDINARY_PARCEL_KG` whatever box is on the card, and the box
 * only enters through `chargeableKg()` if MONTONIO_PRICES_VOLUMETRIC is ever
 * switched on (then the declared weight agrees with the sides beside it, as it
 * used to). A weight typed into the label form still wins over both.
 */
export function declaredWeightKg(p: Pick<ParcelSettings, "length" | "width" | "height">): number {
  /* Montonio's own floor: `weight` must be a positive number, and a carton
     small enough to round to zero would be refused rather than cheap. */
  return Math.max(0.1, chargeableKg(ORDINARY_PARCEL_KG, p));
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
 * default, seeded at `S` — `PARCEL_DEFAULTS.lockerSize`, and the head of this
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
    const { recent } = rememberLockerSize(current, size);
    /* `recent` alone. Writing the whole cleaned object stored the code's
       defaults as if the owner had typed them: the first label ever printed
       froze the carton of that day, and the panel still said 25 × 18 × 10 a
       day after the code said 8 (migration 203, 23.09.2026). A field the
       owner never set has to stay absent, so it follows the code. */
    await query(
      `insert into settings (key, value, updated_at) values ('shipping_parcel', $1::jsonb, now())
       on conflict (key) do update
         set value = case when jsonb_typeof(settings.value) = 'object'
                          then settings.value || $1::jsonb
                          else $1::jsonb end,
             updated_at = now()`,
      [jsonbParam({ recent })],
    );
  } catch (err) {
    console.error("[shipping parcel] could not remember the locker size —", err);
  }
}
