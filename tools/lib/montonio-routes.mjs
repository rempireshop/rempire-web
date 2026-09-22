/**
 * Which carrier Montonio will actually take a parcel to, sending **from
 * Estonia** — and the four boxes each of them prices.
 *
 * Lifted on 22.09.2026 from montonio.com's own shipping calculator
 * (shipping-calculator.montonio.com), which carries the matrix in its bundle
 * and answers prices from the same public `GET /v2/contract-prices` the shop's
 * tariff mirror is built from. So this is Montonio's answer to «кто куда
 * возит», not ours, and `tests/montonio-routes.test.ts` holds the shop's own
 * carrier chips to it.
 *
 * Kept in `tools/lib/` and imported by `tools/montonio-route-grid.mjs`, which
 * is what turns it into `docs/montonio-routes.md`. **Nothing in src/ reads
 * this and nothing should** — the shop bills from
 * `src/data/montonio-tariffs.json` and offers from `CARRIERS_BY_COUNTRY` in
 * public/shop2/app.js. This is the map those two are checked against.
 *
 * Re-derive it by opening the calculator and reading `routes` off each carrier
 * in its bundle; do not edit it from a support answer alone, because the
 * answer we got in prose (Montonio, 22.09.2026) was correct but coarser than
 * this — it named the carriers and not the per-method differences below.
 */

/**
 * DPD's drawers are long and shallow; everyone else's are shorter and deeper.
 *
 * DPD's four were confirmed independently on 22.09.2026 against DPD's own
 * published locker sizes — XS 8 × 18 × 61, S 8 × 43 × 61, M 17 × 43 × 61,
 * L 36 × 43 × 61 cm — the same numbers in the same order. Note what that makes
 * the deciding dimension: **XS and S are both 8 cm tall**, so a carton even a
 * centimetre deeper than that is an M whatever its footprint, and on an
 * international route that is a different price.
 */
export const TIERS_DEFAULT = [
  ["XS", 40, 18, 5, 0.5],
  ["S", 40, 25, 8, 1.5],
  ["M", 45, 30, 10, 5],
  ["L", 45, 35, 25, 8],
];
export const TIERS_DPD = [
  ["XS", 61, 18, 8, 0.5],
  ["S", 61, 43, 8, 1.5],
  ["M", 61, 43, 17, 5],
  ["L", 61, 43, 36, 10],
];

const BALTICS = ["EE", "LV", "LT"];

/** SmartPosti's courier reach beyond the Baltics and Finland. */
const SMARTPOST_COURIER_EU = ["PL", "AT", "BE", "BG", "CZ", "DE", "DK", "ES", "FR", "GR",
  "HR", "HU", "IE", "IT", "LU", "NL", "PT", "RO", "SE", "SI", "SK"];

const DPD_COURIER = [...BALTICS, "FI", "SE", ...SMARTPOST_COURIER_EU.filter((c) => c !== "SE")];
/**
 * Greece and Hungary are missing from the calculator's own DPD pickup-point
 * list. Romania is IN that list and yet `contract-prices` quotes nothing for
 * the route — an empty array, which Montonio uses for «the route exists but
 * has no Montonio-contract price», i.e. direct contract only. Measured
 * 22.09.2026 at all four sizes; the measurement wins over the list, because a
 * route we cannot be quoted for is a route we cannot sell.
 */
const DPD_LOCKER = DPD_COURIER.filter((c) => c !== "GR" && c !== "HU" && c !== "RO");

const NOVAPOST_COURIER = [...BALTICS, "PL", "DE", "CZ", "IT", "ES", "HU", "SK", "NL", "AT", "RO", "FR"];
/** France and the Netherlands are courier-only on Nova Post. */
const NOVAPOST_LOCKER = NOVAPOST_COURIER.filter((c) => c !== "FR" && c !== "NL");

/**
 * Inpost, Orlen and Latvian Post are absent on purpose: the calculator only
 * offers them with Poland or Latvia as the SOURCE country, which is Montonio's
 * way of saying they are not on our contract. Venipak is absent too — «veel
 * tulemas», Montonio, 22.09.2026.
 */
export const CARRIERS = {
  omniva: { tiers: TIERS_DEFAULT, pickupPoint: BALTICS, courier: BALTICS },
  unisend: { tiers: TIERS_DEFAULT, pickupPoint: BALTICS, courier: [] },
  smartpost: {
    tiers: TIERS_DEFAULT,
    pickupPoint: [...BALTICS, "FI"],
    courier: [...BALTICS, "FI", ...SMARTPOST_COURIER_EU],
  },
  dpd: { tiers: TIERS_DPD, pickupPoint: DPD_LOCKER, courier: DPD_COURIER },
  novaPost: { tiers: TIERS_DEFAULT, pickupPoint: NOVAPOST_LOCKER, courier: NOVAPOST_COURIER },
};

/** Every destination any of them reaches, in the order the shop lists them. */
export const ALL_COUNTRIES = ["EE", "LV", "LT", "FI", "SE", "PL", "AT", "BE", "BG", "CZ", "DE",
  "DK", "ES", "FR", "GR", "HR", "HU", "IE", "IT", "LU", "NL", "PT", "RO", "SI", "SK"];

/** Carrier codes as the shop spells them, lower-case; the wire wants `novaPost`. */
export const SHOP_CODE = { novaPost: "novapost" };

/** Does Montonio take a parcel there, by that method, with that carrier? */
export function serves(carrier, method, country) {
  const cfg = CARRIERS[carrier];
  if (!cfg) return false;
  const list = method === "courier" ? cfg.courier : cfg.pickupPoint;
  return list.includes(String(country || "").toUpperCase());
}

/** Every carrier that reaches `country` by `method`, wire spelling. */
export function carriersFor(method, country) {
  return Object.keys(CARRIERS).filter((c) => serves(c, method, country));
}
