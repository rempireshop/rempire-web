/**
 * The arithmetic behind «какую фиксированную цену доставки назначить».
 *
 * Pure: no network, no filesystem, no clock. Everything here takes a parsed
 * `POST /shipping-methods/rates` response — or a grid already built from
 * several of them — and returns numbers. `tools/delivery-pricing.mjs` is the
 * half that talks to Montonio and prints; `tests/delivery-pricing.test.ts`
 * drives this file against responses written from Montonio's own documented
 * example, which is the only way to prove any of it without live keys.
 *
 * ## Why this is not `tools/fetch-montonio-tariffs.mjs`
 *
 * That script answers «what does one reference parcel cost», writes one row
 * per carrier/country/method into `src/data/montonio-tariffs.json`, and the
 * shop bills from it. It is a mirror, and one box wide on purpose.
 *
 * This answers a different question — «what does a FLAT price earn or lose
 * across the parcels that actually turn up» — so it needs the same route at
 * several weights and it must keep the subtypes apart instead of collapsing
 * them. It shares that script's auth and its endpoint and changes neither.
 *
 * ## The three things this file refuses to paper over
 *
 * 1. **Nobody has weighed the products.** `src/data/catalogue.min.json` holds
 *    220 items with `b c id n p s` — brand, category, id, name, price, slug —
 *    and no weight and no dimensions. The shop's one guess at what a basket
 *    weighs is `estimateWeightKg()` (`src/lib/shipping/montonio.ts`):
 *    `0.4 kg × units + 0.2`. `unitsToKg()` below is that same formula,
 *    restated, so the tool's weights are the shop's own rather than a fresh
 *    invention — and the input is **units, not kilograms**, because how many
 *    jars go in a typical order is a thing Renat knows and 1.4 kg is not.
 *
 *    It is a weight to *study tariffs with*, not the weight the shop declares.
 *    Since 19.09.2026 `POST /shipments` carries `declaredWeightKg()` — the
 *    volumetric weight of the carton in `settings.shipping_parcel`, the same
 *    number on every parcel (Ренат, 18.09.2026: «no weight modelling»; audit
 *    18.09.2026, F24). So a band here answers «what would a real parcel of N
 *    jars cost», which is exactly the question this tool exists for, and it is
 *    no longer also a description of what goes out on the wire.
 * 2. **A hole is a hole.** `/shipping-methods/rates` — reference, Note —
 *    *"only returns rates for carriers with Montonio contracts. Carriers that
 *    only support Direct contracts will not be included in the response."* An
 *    absent carrier is therefore *not priced*, which is a different fact from
 *    *free*, and every renderer here prints `—` for it. `rate: "0"` is folded
 *    into the same hole with its own reason: `src/lib/shipping/montonio.ts:503`
 *    records that Montonio answers `"0"` for a pair the store has no priced
 *    tier for, and a zero that reached this arithmetic would read as infinite
 *    margin.
 * 3. **Every `rate` is net and gets 24 % added.** Montonio confirmed that on
 *    22.09.2026, after the reference had said nothing either way. See
 *    `VAT_NOTE`.
 */

/* ---------- restated from the app, asserted equal in the test --------------
   Same reasoning as SHOP_CARRIERS in src/lib/shipping/country-prices.ts,
   which restates MONTONIO_CARRIERS rather than importing it: a tools/*.mjs
   file is a standalone node process with no bundler and no alias resolution,
   so it carries its own copy and a test holds the two together. Every
   constant below is checked against its TypeScript original in
   tests/delivery-pricing.test.ts — if one drifts, that test fails. */

/** src/lib/shipping/country-prices.ts SHOP_CARRIERS. */
export const SHOP_CARRIERS = ["omniva", "smartpost", "dpd", "unisend", "novapost"];

/** src/lib/shipping/country-prices.ts CHIP_ONLY_CARRIERS — never a basis price. */
export const CHIP_ONLY_CARRIERS = ["novapost"];

/** src/lib/shipping/country-prices.ts CARRIER_CHOICE_COUNTRIES — the shopper picks. */
export const CARRIER_CHOICE_COUNTRIES = ["EE", "LV", "LT", "FI"];

/** src/lib/shipping/montonio.ts MONTONIO_WIRE_CODE — our key → Montonio's spelling. */
export const WIRE_CODE = { novapost: "novaPost" };

/** src/lib/shipping.ts EUROPE — the countries the «Другие страны Европы» row prices. */
export const EUROPE = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "FR", "DE", "GR", "HU", "IE", "IT", "LU", "MT", "NL", "PL",
  "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "CH", "GB",
];

/** src/lib/shipping.ts shippingZone() — which row of the rate screen pays for this country. */
export function shippingZone(country) {
  const c = String(country || "").toUpperCase();
  if (c === "EE" || c === "LV" || c === "LT" || c === "FI" || c === "EU") return c;
  return EUROPE.includes(c) ? "EU" : "default";
}

/** src/lib/shipping/country-prices.ts roundUpToX9() — the shop's own rounding. */
export function roundUpToX9(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const cents = Math.ceil(n * 100 - 1e-7);
  const rem = ((cents % 10) + 10) % 10;
  const up = rem === 9 ? 0 : (9 - rem + 10) % 10;
  return (cents + up) / 100;
}

/**
 * src/lib/shipping/montonio.ts estimateWeightKg(), by unit count.
 *
 * The production function takes an order and counts its non-gift units; this
 * takes the count directly, because the whole point of the tool is to ask
 * «предположим, в заказе N банок» and watch the answer move. Same clamp
 * (0.3–30 kg), same 0.4/0.2, so a band here is the shop's own estimate of what
 * a parcel of that size weighs — not the weight it declares, which since
 * 19.09.2026 is the carton and nothing else (`declaredWeightKg()`).
 */
export function unitsToKg(units) {
  const n = Math.max(0, Number(units) || 0);
  return Math.min(30, Math.max(0.3, round2(0.4 * n + 0.2)));
}

/* ---------- VAT ------------------------------------------------------------ */

/** Estonian VAT, as in src/data/montonio-tariffs.json's own `vatRateEE`. */
export const VAT_EE = 0.24;

/**
 * **`rate` comes back ex-VAT, and since 22.09.2026 that is an answer rather
 * than an assumption.** Montonio was asked and confirmed it: the per-store
 * `POST /shipping-methods/rates` quotes net, exactly like `pricePerParcel` on
 * the public contract-prices endpoint, whose calculator prints «+VAT» under
 * every figure. The reference itself still says neither way — it names `code`,
 * `rate`, `currency` and no tax field — so the confirmation is written down
 * here, where the arithmetic depends on it.
 *
 * Everything that stores or compares one of those numbers now adds the 24 %.
 * `tools/fetch-montonio-tariffs.mjs` does it on **both** write paths, the
 * contract price and this store's live quote (pinned by
 * tests/tariff-vat.test.ts), so `src/data/montonio-tariffs.json` is gross
 * throughout; `fetchMontonioRates()` in `src/lib/shipping/montonio.ts` does it
 * to a live quote before `src/lib/shipping/tariffs.ts` can prefer one over a
 * static row. That is what lets `src/lib/shipping/country-prices.ts` say
 * «Every price here includes Estonian VAT, like the shelf prices they are
 * compared against».
 *
 * This tool does the same, for the same reason: a cost and a shelf price have
 * to be the same kind of number. It says so on every screen and in every file
 * it writes. `--rates-include-vat` stays behind as a manual override for the
 * day Montonio changes what it quotes; it is no longer an open question
 * waiting on the first invoice.
 */
export const VAT_NOTE =
  "НДС: Montonio подтвердила 22.09.2026, что `rate` приходит БЕЗ НДС — так же, как pricePerParcel " +
  "в контрактных ценах. Поэтому здесь к цифрам Montonio добавлен эстонский НДС 24 %: на витрине он " +
  "уже внутри, и сравнивать надо одно с одним.";

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Cost as it must be compared against a shelf price: gross, in euro. */
export function grossCost(rate, { ratesIncludeVat = false, vatRate = VAT_EE } = {}) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return null;
  return ratesIncludeVat ? round2(n) : round2(n * (1 + vatRate));
}

/* ---------- the delivery kinds the grid is cut by -------------------------- */

/**
 * Montonio's two `shippingMethods[].type` values and the `subtypes[].code`
 * under them, folded into the four things a customer actually chooses.
 *
 * This is the distinction the whole branch exists for. `contract-prices` takes
 * one `shippingMethod=pickupPoint` and answers one number; the documented
 * endpoint splits it into `parcelMachine`, `parcelShop` and `postOffice`, each
 * with its own `rate`. A mirror built without keys can therefore be charging
 * the parcel-shop tier for a locker, and nothing downstream can tell.
 *
 * Subtype codes are the reference's own list: parcelMachine, parcelShop,
 * postOffice, standard, standardB2B. An unknown one is kept, not dropped —
 * `other:<code>` — because a code we have never seen is news, not noise.
 */
export const KIND_LABELS = {
  locker: "Пакомат",
  parcelShop: "Пункт выдачи",
  postOffice: "Почта",
  courier: "Курьер",
};

/** The kinds the grid shows, in the order a table prints them. */
export const KINDS = ["locker", "parcelShop", "postOffice", "courier"];

export function kindOf(methodType, subtypeCode) {
  const type = String(methodType || "");
  const code = String(subtypeCode || "");
  if (type === "courier") return "courier";
  if (type !== "pickupPoint") return `other:${type || "?"}`;
  if (code === "parcelMachine") return "locker";
  if (code === "parcelShop") return "parcelShop";
  if (code === "postOffice") return "postOffice";
  return `other:${code || "?"}`;
}

/* ---------- reading one documented response -------------------------------- */

/**
 * `POST /shipping-methods/rates` → flat rows, plus what Montonio says it will
 * actually charge the parcel as.
 *
 * Built from the reference's own example body, fields in its own spelling:
 *
 *   { calculationDetails: { estimatedParcels: [ { length, width, height,
 *       dimensionUnit, actualWeight, volumetricWeight, chargeableWeight,
 *       weightUnit, bufferApplied } ] },
 *     destination: "EE",
 *     carriers: [ { carrierCode, shippingMethods: [ { type,
 *       subtypes: [ { code, rate, currency } ] } ] } ] }
 *
 * `rate` is a **string** in the documented example ("2.50"), so it is read as
 * one; `calculationDetails` is read at all, which no other code here does, and
 * it is the honest answer to the weight question — see `chargeable` below.
 *
 * Nothing throws. A malformed body yields zero rows and a `problems` entry,
 * because the caller's job on Sunday is to print a hole and carry on, not to
 * stop the run on one bad country.
 */
export function parseRatesResponse(body, { country = "" } = {}) {
  const problems = [];
  const rows = [];
  const b = body && typeof body === "object" ? body : {};

  const destination = String(b.destination || country || "").toUpperCase();
  if (country && destination && destination !== String(country).toUpperCase()) {
    problems.push(`ответ про ${destination}, а спрашивали про ${String(country).toUpperCase()}`);
  }

  /**
   * What Montonio will bill the box as, which is not what we declared.
   * `chargeableWeight` is the greater of `actualWeight` and `volumetricWeight`
   * — so a light parcel in a big carton is charged by its size, and on a
   * 30×30×30 box (the mirror's REFERENCE_PARCEL) that is 5.4 kg no matter what
   * goes in it. Printing this is how Renat sees that the box, not the contents,
   * set the price.
   */
  let chargeable = null;
  const est = b.calculationDetails?.estimatedParcels;
  if (Array.isArray(est) && est.length) {
    const p = est[0] ?? {};
    chargeable = {
      actualKg: num(p.actualWeight),
      volumetricKg: num(p.volumetricWeight),
      chargeableKg: num(p.chargeableWeight),
      bufferApplied: num(p.bufferApplied),
      weightUnit: String(p.weightUnit || "kg"),
      dimensionUnit: String(p.dimensionUnit || "cm"),
      parcels: est.length,
    };
  }

  if (!Array.isArray(b.carriers)) {
    problems.push("в ответе нет массива carriers");
    return { destination, chargeable, rows, problems };
  }

  for (const carrierRow of b.carriers) {
    const wire = String(carrierRow?.carrierCode || "");
    const carrier = wire.toLowerCase();
    if (!carrier) {
      problems.push("перевозчик без carrierCode — строка пропущена");
      continue;
    }
    for (const method of carrierRow?.shippingMethods ?? []) {
      for (const sub of method?.subtypes ?? []) {
        const kind = kindOf(method?.type, sub?.code);
        const raw = sub?.rate;
        const rate = Number(raw);
        if (!Number.isFinite(rate)) {
          problems.push(`${carrier} ${kind}: rate «${String(raw)}» не число — дыра, не ноль`);
          continue;
        }
        /* A rate of exactly 0 is not a free delivery, it is NO rate — the same
           call src/lib/shipping/montonio.ts:503 makes, on the same observed
           grounds. The difference is that this one is written down: a dropped
           row lands in `problems` and the grid keeps a hole, so «Montonio
           ответил 0» never reads as «доставка бесплатная». */
        if (rate <= 0) {
          problems.push(`${carrier} ${kind}: rate = ${rate} — у магазина нет тарифа на это, дыра`);
          continue;
        }
        rows.push({
          carrier,
          wireCode: wire,
          kind,
          subtype: String(sub?.code || ""),
          methodType: String(method?.type || ""),
          rate: round2(rate),
          currency: String(sub?.currency || "EUR"),
        });
      }
    }
  }
  return { destination, chargeable, rows, problems };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ---------- which of those rows may set a price ---------------------------- */

/**
 * The rows a flat price may be computed from, and the reason each excluded row
 * was excluded. Nothing is silently dropped: `excluded` is printed.
 *
 * Two filters, both straight out of src/lib/shipping/country-prices.ts:
 *   · not in SHOP_CARRIERS → the checkout cannot offer it, so a price based on
 *     it would be a price nobody can buy;
 *   · in CHIP_ONLY_CARRIERS (Nova Post) → offered only as a chip the shopper
 *     taps in EE/LV/LT, never as the basis of a country price, because it is
 *     Montonio International Shipping and has no returns at all.
 */
export function sellableRows(rows) {
  const kept = [];
  const excluded = [];
  for (const r of rows) {
    if (!SHOP_CARRIERS.includes(r.carrier)) {
      excluded.push({ ...r, why: "не в SHOP_CARRIERS — чекаут его не предлагает" });
      continue;
    }
    if (CHIP_ONLY_CARRIERS.includes(r.carrier)) {
      excluded.push({ ...r, why: "только фишка (Nova Post) — не основа цены страны, возвратов нет" });
      continue;
    }
    kept.push(r);
  }
  return { kept, excluded };
}

/**
 * The one cost a flat price for this country+kind has to cover.
 *
 * costBasis() in src/lib/shipping/country-prices.ts, unchanged: where the
 * **shopper** picks the carrier — a parcel machine in EE, LV, LT, FI — the
 * price must cover the DEAREST of them, because he may pick it; everywhere
 * else Renat picks at the label, so the CHEAPEST he can pick applies.
 *
 * `null` — a hole — when nothing sellable was quoted. Never 0.
 */
export function basisFor(country, kind, rows) {
  const cc = String(country || "").toUpperCase();
  const { kept } = sellableRows(rows.filter((r) => r.kind === kind));
  if (!kept.length) return null;
  const shopperPicks = kind === "locker" && CARRIER_CHOICE_COUNTRIES.includes(cc);
  let best = null;
  for (const r of kept) {
    if (!best || (shopperPicks ? r.rate > best.rate : r.rate < best.rate)) best = r;
  }
  return {
    carrier: best.carrier,
    rate: best.rate,
    currency: best.currency,
    rule: shopperPicks ? "дороже всех (выбирает покупатель)" : "дешевле всех (выбирает Ренат у этикетки)",
    candidates: kept.length,
  };
}

/* ---------- the grid ------------------------------------------------------- */

/**
 * A band is a weight the tool asks Montonio about, described the way the shop
 * thinks about it: «сколько единиц в заказе». The kilograms come from the
 * production estimator; the carton is the one thing here that is invented, and
 * it is invented out loud.
 *
 * **The box matters as much as the weight and nobody has measured it either.**
 * Montonio charges `chargeableWeight` = max(actual, volumetric), so a 0.6 kg
 * order posted in the mirror's 30×30×30 reference carton is billed at 5.4 kg
 * of volumetric weight and the band is meaningless. The ladder below grows the
 * carton with the order so that each band is a plausible parcel rather than
 * one box with different numbers written on it — and the run prints Montonio's
 * own `chargeableWeight` next to every band, so the moment the carton is the
 * thing being paid for, it says so.
 */
export const DEFAULT_BANDS = [
  { units: 1, box: [20, 15, 10] },
  { units: 3, box: [25, 20, 15] },
  { units: 6, box: [30, 25, 20] },
  { units: 12, box: [35, 30, 25] },
  { units: 24, box: [40, 35, 30] },
];

export function bandsFrom(spec) {
  return (spec ?? DEFAULT_BANDS).map((b) => ({
    units: b.units,
    kg: unitsToKg(b.units),
    box: b.box,
    label: `${b.units} шт · ${unitsToKg(b.units)} кг · ${b.box.join("×")} см`,
    short: `${b.units} шт`,
  }));
}

/** The request body for one band, in the documented shape. cm and kg, per the reference defaults. */
export function rateRequestBody(country, band) {
  return {
    destination: String(country || "").toUpperCase(),
    parcels: [
      {
        items: [
          {
            length: band.box[0],
            width: band.box[1],
            height: band.box[2],
            dimensionUnit: "cm",
            weight: band.kg,
            weightUnit: "kg",
            quantity: 1,
          },
        ],
      },
    ],
  };
}

/**
 * country × band × kind → { gross, carrier, … } or null.
 *
 * `answers` is `{ [country]: { [bandIndex]: parsedResponse } }`. A country or
 * band with no answer at all becomes holes, not zeros, and lands in `missing`.
 */
export function buildGrid({ countries, bands, answers, ratesIncludeVat = false, vatRate = VAT_EE }) {
  /** @type {Record<string, Record<number, Record<string, {carrier: string, rate: number, currency: string, rule: string, candidates: number, gross: number|null}|null>>>} */
  const cells = {};
  /** @type {Array<{country: string, band: number, why: string}>} */
  const missing = [];
  /** @type {Array<{country: string, band: number, note: string}>} */
  const notes = [];
  /** @type {Record<string, Record<number, {actualKg: number|null, volumetricKg: number|null, chargeableKg: number|null, bufferApplied: number|null, weightUnit: string, dimensionUnit: string, parcels: number}|null>>} */
  const chargeable = {};

  for (const country of countries) {
    cells[country] = {};
    chargeable[country] = {};
    for (let i = 0; i < bands.length; i++) {
      const parsed = answers?.[country]?.[i];
      cells[country][i] = {};
      if (!parsed) {
        missing.push({ country, band: i, why: "Montonio не ответил про этот вес" });
        for (const kind of KINDS) cells[country][i][kind] = null;
        continue;
      }
      chargeable[country][i] = parsed.chargeable ?? null;
      for (const p of parsed.problems ?? []) notes.push({ country, band: i, note: p });
      for (const kind of KINDS) {
        const basis = basisFor(country, kind, parsed.rows ?? []);
        cells[country][i][kind] = basis
          ? {
              ...basis,
              gross: grossCost(basis.rate, { ratesIncludeVat, vatRate }),
            }
          : null;
      }
    }
  }
  return { countries, bands, cells, chargeable, missing, notes, ratesIncludeVat, vatRate };
}

/* ---------- the arithmetic that turns the grid into a decision ------------- */

/**
 * What one flat price earns or loses on one country+kind, band by band.
 *
 * `perBand[i].margin` is gross shelf price minus gross cost: the euro that
 * stays with the shop after the carrier, before anything else. Negative means
 * this parcel is posted at a loss, and `losesFrom` is the first band where
 * that starts — the answer to «до какого заказа эта цена держится».
 *
 * `breakEven` is the cost itself, per band: the flat price at which the band
 * breaks even exactly. `breakEvenAll` is the dearest of them — charge that and
 * no parcel in the grid loses money. `suggestedX9` rounds it the way the shop
 * rounds every shelf price (roundUpToX9), so the figure can be typed straight
 * into the panel.
 */
/** @param {{flat: number|null, country: string, kind: string, grid: any, heaviestBand?: number|null}} _ */
export function flatPriceEconomics({ flat, country, kind, grid, heaviestBand = null }) {
  const bands = grid.bands;
  const perBand = [];
  let losesFrom = null;
  let worstMargin = null;
  let breakEvenAll = null;
  let priced = 0;

  /* `--heaviest N` is a statement about reality — «заказов больше N единиц у
     нас не бывает» — so it has to change the verdict, not just add a column.
     Bands above it are still probed and still printed (they are facts, and the
     guess may be wrong), but they do not set the break-even and they do not
     count as a loss: a price called «без убытка» that covers a parcel he has
     just said never turns up is a price that is too high on purpose. */
  const within = (i) => heaviestBand === null || i <= heaviestBand;

  for (let i = 0; i < bands.length; i++) {
    const cell = grid.cells[country]?.[i]?.[kind] ?? null;
    if (!cell) {
      perBand.push({ band: bands[i], cost: null, margin: null, breakEven: null, hole: true, counted: within(i) });
      continue;
    }
    priced++;
    const cost = cell.gross;
    const margin = flat === null ? null : round2(flat - cost);
    if (within(i)) {
      if (breakEvenAll === null || cost > breakEvenAll) breakEvenAll = cost;
      if (margin !== null && margin < 0 && losesFrom === null) losesFrom = i;
      if (margin !== null && (worstMargin === null || margin < worstMargin)) worstMargin = margin;
    }
    perBand.push({
      band: bands[i],
      cost,
      carrier: cell.carrier,
      rule: cell.rule,
      margin,
      marginPct: flat > 0 && margin !== null ? Math.round((margin / flat) * 100) : null,
      breakEven: cost,
      hole: false,
      /** false for a band above the stated heaviest: shown, but not part of the verdict. */
      counted: within(i),
    });
  }

  /* «Сколько остаётся на самом тяжёлом заказе, который реально может прийти» —
     the brief's own question, and the one an average hides. Defaults to the
     last band with a price; --heaviest names a different one. */
  const hi = heaviestBand === null ? lastPricedIndex(perBand) : heaviestBand;
  const atHeaviest = hi === null ? null : perBand[hi];

  return {
    country,
    kind,
    flat,
    perBand,
    priced,
    holes: perBand.filter((p) => p.hole).length,
    losesFrom,
    losesFromLabel: losesFrom === null ? null : bands[losesFrom].short,
    worstMargin,
    breakEvenAll,
    suggestedX9: breakEvenAll === null ? null : roundUpToX9(breakEvenAll),
    atHeaviest,
    heaviestBand: hi,
  };
}

function lastPricedIndex(perBand) {
  for (let i = perBand.length - 1; i >= 0; i--) if (!perBand[i].hole) return i;
  return null;
}

/**
 * Three candidate prices for one country+kind, because «bearable middle» is a
 * choice between named positions and not a number a script can pick.
 *
 *   · `typical`  — breaks even on the order size Renat said is typical. Every
 *                  heavier parcel loses; this is the cheapest defensible price.
 *   · `safe`     — breaks even on the heaviest band. Nothing ever loses, and
 *                  the small orders — which are most of them — pay for it.
 *   · `middle`   — halfway between the two. This is the bet, stated as one.
 *
 * All three are rounded with the shop's own roundUpToX9, so whichever he picks
 * is a number that already looks like every other price in the panel.
 */
/** @param {{country: string, kind: string, grid: any, typicalBand?: number, heaviestBand?: number|null}} _ */
export function candidates({ country, kind, grid, typicalBand = 0, heaviestBand = null }) {
  const econ = flatPriceEconomics({ flat: null, country, kind, grid, heaviestBand });
  const at = (i) => (i === null ? null : (econ.perBand[i]?.cost ?? null));
  const typicalCost = at(typicalBand) ?? null;
  const safeCost = econ.breakEvenAll;
  if (typicalCost === null && safeCost === null) return null;
  /* A hole at the typical band is not «then use the safe price»: «по
     типичному» would print a number that is not the break-even of anything,
     next to a «себест. типичн.» column showing «—». Two of the three
     candidates simply do not exist here, and they say so. */
  return {
    country,
    kind,
    typical: typicalCost === null ? null : roundUpToX9(typicalCost),
    safe: safeCost === null ? null : roundUpToX9(safeCost),
    middle:
      typicalCost === null || safeCost === null ? null : roundUpToX9((typicalCost + safeCost) / 2),
    typicalCost,
    safeCost,
    heaviestBand: econ.heaviestBand,
  };
}

/**
 * A zone is one price for many countries, so the zone's cost is the DEAREST
 * country in it — «Другие страны Европы» is one box on the rate screen and a
 * parcel to Greece is posted under it exactly as one to Poland.
 *
 * Returns, per band, the dearest country and the cheapest, so the spread the
 * single number has to straddle is on the page. A country with a hole is
 * counted in `holes`, never as 0 — a zone price computed over a hole would be
 * a price for a parcel the shop cannot send.
 */
/** @param {{zone: string, kind: string, grid: any, heaviestBand?: number|null}} _ */
export function zoneRollup({ zone, kind, grid, heaviestBand = null }) {
  const members = grid.countries.filter((c) => shippingZone(c) === zone);
  const perBand = [];
  /* Same rule as flatPriceEconomics: a band above the stated heaviest is
     printed but does not set the zone's break-even. */
  const within = (i) => heaviestBand === null || i <= heaviestBand;
  for (let i = 0; i < grid.bands.length; i++) {
    let dearest = null;
    let cheapest = null;
    const holes = [];
    for (const c of members) {
      const cell = grid.cells[c]?.[i]?.[kind] ?? null;
      if (!cell) {
        holes.push(c);
        continue;
      }
      if (!dearest || cell.gross > dearest.gross) dearest = { country: c, ...cell };
      if (!cheapest || cell.gross < cheapest.gross) cheapest = { country: c, ...cell };
    }
    perBand.push({
      band: grid.bands[i],
      dearest,
      cheapest,
      holes,
      priced: members.length - holes.length,
      counted: within(i),
    });
  }
  const worst = perBand.reduce(
    (a, p) => (p.counted && p.dearest && (!a || p.dearest.gross > a.gross) ? p.dearest : a),
    null,
  );
  return {
    zone,
    kind,
    members,
    perBand,
    /** The flat price at which no country in the zone loses, at any band. */
    breakEvenAll: worst ? worst.gross : null,
    suggestedX9: worst ? roundUpToX9(worst.gross) : null,
    worst,
  };
}

/**
 * How much the answer moves when the guess about order size moves — the
 * sensitivity the brief asks for, and the reason `--units` is an input rather
 * than a constant.
 *
 * One row per band: «if a typical order is really THIS big, the break-even is
 * THAT». If the rows are close together the assumption barely matters and he
 * can stop worrying about it; if they run 4.59 → 11.19 it is the single
 * biggest unknown in the decision and the number he picks is mostly a guess
 * about weight. Saying which is the point.
 */
export function sensitivity({ country, kind, grid }) {
  const econ = flatPriceEconomics({ flat: null, country, kind, grid });
  const rows = econ.perBand
    .filter((p) => !p.hole)
    .map((p) => ({ band: p.band, cost: p.cost, breakEvenX9: roundUpToX9(p.cost), carrier: p.carrier }));
  if (!rows.length) return { country, kind, rows, spread: null, verdict: "нет цен — только дыры" };
  const lo = Math.min(...rows.map((r) => r.cost));
  const hi = Math.max(...rows.map((r) => r.cost));
  const spread = round2(hi - lo);
  const ratio = lo > 0 ? hi / lo : null;
  let verdict;
  if (spread < 0.5) verdict = "вес почти не влияет — можно не гадать";
  else if (ratio !== null && ratio >= 2) verdict = "вес решает всё — цена это ставка на размер заказа";
  else verdict = "вес влияет заметно — держите запас";
  return { country, kind, rows, lo, hi, spread, ratio, verdict };
}

/**
 * Every sellable carrier's own price for one country+kind, band by band —
 * the view the basis grid deliberately collapses.
 *
 * It matters in exactly the place the panel has a box for it. Under «Пакомат»
 * in EE, LV, LT and FI the checkout draws carrier chips and the **shopper**
 * picks, so `settings.shipping_rules.carriers` holds one cell per carrier per
 * country and each one is a price somebody can actually choose
 * (`carrierPriceTable()` in src/lib/shipping/country-prices.ts). A single
 * country number there is how nine of the fourteen pairs came to be sold below
 * cost on 13.09.2026 — Finland charged 7.89 € for a DPD machine costing
 * 12.39 €, and the shopper chose which.
 *
 * Chip-only carriers (Nova Post) ARE included here and marked, because a chip
 * is exactly what they are: the price prices itself, it just never becomes the
 * basis of a country.
 *
 * Returns `{ carriers: [{carrier, chipOnly, perBand:[{band, gross}|null]}] }`
 * with a row per carrier that was quoted at least once. Never a zero.
 */
export function perCarrierRows({ country, kind, grid, answersByBand }) {
  const seen = new Map();
  for (let i = 0; i < grid.bands.length; i++) {
    const parsed = answersByBand?.[i];
    if (!parsed) continue;
    for (const r of parsed.rows ?? []) {
      if (r.kind !== kind) continue;
      if (!SHOP_CARRIERS.includes(r.carrier)) continue;
      if (!seen.has(r.carrier)) {
        seen.set(r.carrier, {
          carrier: r.carrier,
          chipOnly: CHIP_ONLY_CARRIERS.includes(r.carrier),
          perBand: grid.bands.map(() => null),
        });
      }
      seen.get(r.carrier).perBand[i] = grossCost(r.rate, {
        ratesIncludeVat: grid.ratesIncludeVat,
        vatRate: grid.vatRate,
      });
    }
  }
  return {
    country,
    kind,
    carriers: [...seen.values()].sort((a, b) => a.carrier.localeCompare(b.carrier)),
  };
}

/* ---------- why the grid came back empty ----------------------------------- */

/**
 * Three very different failures all end with «no prices», and they send a
 * person to three different screens. On the one morning there is no hour to
 * spare, guessing the likelier one is worse than saying which actually
 * happened — so the message is built from the responses, not from a hunch.
 *
 *   · `keys`     — 401/403 came back. The keys are wrong, or they are Orders
 *                  keys rather than Shipping ones, or they are sandbox keys
 *                  against the live host. Nothing to do with carriers.
 *   · `network`  — every request fell over, but not with a refusal. Not a
 *                  settings problem at all.
 *   · `carriers` — Montonio answered, politely, with nothing. THIS is the one
 *                  that means «no carrier has a Montonio contract yet», and
 *                  it is the only one that sends him to the Shipping tab.
 *
 * Returns `{ cause, text }`; `null` when nothing was wrong.
 */
/** @param {{failures?: Array<{country?: string, band?: string, why?: string}>, asked?: number, env?: string, base?: string}} _ */
export function emptyGridDiagnosis({ failures = [], asked = 0, env = "", base = "" } = {}) {
  const unauthorised = failures.filter((f) => /HTTP 40[13]/.test(String(f.why ?? ""))).length;
  if (unauthorised) {
    return {
      cause: "keys",
      text: `
ОСТАНОВ: Montonio не принял ключи — ${unauthorised} из ${asked} запросов вернули 401/403.

Это НЕ «перевозчики не включены». Это ключи. Проверить по порядку:
  · MONTONIO_ACCESS_KEY и MONTONIO_SECRET_KEY скопированы целиком, без пробелов;
  · ключи выпущены для Shipping, а не только для Orders (это разные разделы);
  · MONTONIO_ENV=${env} — ключи песочницы не работают на живом хосте и наоборот.
    Сейчас запрос шёл на ${base}.
`,
    };
  }
  /* A rate limit looks like a network failure and is not one: the keys are
     fine, the carriers are fine, and the fix is to ask for fewer countries at
     a time rather than to go and change a setting. */
  const throttled = failures.filter((f) => /HTTP 429/.test(String(f.why ?? ""))).length;
  if (throttled) {
    return {
      cause: "throttled",
      text: `
ОСТАНОВ: Montonio ограничил частоту запросов — ${throttled} из ${asked} вернули 429.

Ключи и перевозчики ни при чём. Спросить меньше за раз:
  node tools/delivery-pricing.mjs --countries EE,LV,LT,FI
потом остальные страны отдельным запуском.
`,
    };
  }
  if (failures.length) {
    return {
      cause: "network",
      text: `
ОСТАНОВ: Montonio не ответил ни на один запрос (${failures.length} из ${asked} упали).

Ни одной цены не получено, но и отказа по существу тоже не было — похоже на
сеть, а не на настройки. Первая строка причины: ${failures[0]?.why ?? HOLE}
Проверить доступ к ${base} и прогнать ещё раз.
`,
    };
  }
  return {
    cause: "carriers",
    text: `
ОСТАНОВ: ключи приняты, Montonio ответил — и не назвал НИ ОДНОЙ цены.

Так отвечает магазин, у которого ещё не включён ни один перевозчик с контрактом
Montonio. Эндпоинт отдаёт только таких; у кого прямой договор — тех в ответе нет
вовсе. Идти в partner.montonio.com → Shipping и включить перевозчиков, потом
прогнать ещё раз. Пустая сетка — это не «всё бесплатно» и не повод ставить цены.
`,
  };
}

/* ---------- rendering ------------------------------------------------------ */

export const HOLE = "—";

export function eur(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return HOLE;
  return `${Number(n).toFixed(2)} €`;
}

export function signedEur(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return HOLE;
  const v = Number(n);
  return `${v > 0 ? "+" : ""}${v.toFixed(2)} €`;
}

/** `5.25 кг`, `0.60 кг` — two decimals always, so a column of them lines up. */
export function kgFmt(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return HOLE;
  return `${Number(n).toFixed(2)} кг`;
}

/**
 * «1 страна» / «2 страны» / «7 стран» — Russian counts three ways and Renat
 * reads this, so it is worth the six lines. `forms` is [1, 2–4, 5+].
 */
export function plural(n, forms) {
  const abs = Math.abs(Math.trunc(Number(n) || 0));
  const ten = abs % 10;
  const hundred = abs % 100;
  if (hundred >= 11 && hundred <= 14) return forms[2];
  if (ten === 1) return forms[0];
  if (ten >= 2 && ten <= 4) return forms[1];
  return forms[2];
}

/** Pads to a visual width; Cyrillic counts as one column, which is true in every terminal here. */
export function pad(s, w, right = false) {
  const str = String(s ?? "");
  const gap = Math.max(0, w - [...str].length);
  return right ? " ".repeat(gap) + str : str + " ".repeat(gap);
}

/** A plain fixed-width table. `align` is per column: "l" or "r". */
export function table(headers, rows, align = []) {
  const widths = headers.map((h, i) =>
    Math.max([...String(h)].length, ...rows.map((r) => [...String(r[i] ?? "")].length), 1),
  );
  const line = (cells) =>
    cells.map((c, i) => pad(c, widths[i], align[i] === "r")).join("  ").replace(/\s+$/, "");
  return [line(headers), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

/** The same rows as a Markdown table, for the written file. */
export function mdTable(headers, rows, align = []) {
  const sep = headers.map((_, i) => (align[i] === "r" ? "---:" : "---"));
  const row = (cells) => `| ${cells.map((c) => String(c ?? "")).join(" | ")} |`;
  return [row(headers), row(sep), ...rows.map(row)].join("\n");
}

/** country × band, one delivery kind — the grid, with holes as holes. */
export function gridRows(grid, kind) {
  return grid.countries.map((c) => {
    const cells = grid.bands.map((_, i) => {
      const cell = grid.cells[c]?.[i]?.[kind] ?? null;
      return cell ? eur(cell.gross) : HOLE;
    });
    const carriers = new Set(
      grid.bands
        .map((_, i) => grid.cells[c]?.[i]?.[kind]?.carrier)
        .filter(Boolean),
    );
    return [c, ...cells, carriers.size ? [...carriers].join("/") : HOLE];
  });
}

export function gridHeaders(grid) {
  return ["Страна", ...grid.bands.map((b) => b.short), "перевозчик"];
}

export function gridAlign(grid) {
  return ["l", ...grid.bands.map(() => "r"), "l"];
}
