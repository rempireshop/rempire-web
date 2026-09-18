/**
 * The box the shop declares, the locker door it asks for, and the countries it
 * offers a pickup point in — r24, the three answers Ренат gave on 18.09.2026.
 *
 * Three things are checked here that nothing else can check:
 *
 *   · the **units**. `POST /shipments` takes metres and
 *     `POST /shipping-methods/rates` takes centimetres, both correct, and the
 *     one converter between the owner's tape measure and the wire is
 *     `parcelMetres()`. A test that pins it is the only thing standing between
 *     this codebase and somebody "fixing" one endpoint to match the other.
 *   · the **suggestion**, which is the whole of «confirmation, not question».
 *     If it stops being the size he actually ships, the step silently becomes
 *     a question again and nobody notices, because it still renders.
 *   · the **two lists agreeing** — the server's `PICKUP_POINT_COUNTRIES` and
 *     the storefront's `CARRIERS_BY_COUNTRY`. They are written in two files in
 *     two languages and they decide the same thing: whether a shopper in Italy
 *     is offered a locker.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LOCKER_SIZES,
  PARCEL_DEFAULTS,
  cleanParcel,
  lockerSizeReason,
  parcelMetres,
  rememberLockerSize,
  suggestedLockerSize,
  takesLockerSize,
  toLockerSize,
  volumetricKg,
  type LockerSize,
} from "@/lib/shipping/parcel";
import { PICKUP_POINT_COUNTRIES } from "@/lib/shipping/country-prices";
import { DEFAULT_SHIPPING_RULES, cleanShippingRules, parseShippingRules, pickupOffered } from "@/lib/shipping";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
/* Line endings normalised on the way in. app.js is stored CRLF, and the
   lifter below looks for a semicolon followed by a newline — against CRLF
   that match lands somewhere far down the file and slices nonsense, which
   surfaces as a SyntaxError rather than as a disagreement. Found 18.09.2026,
   when four of these mirrors failed on a checkout whose app.js had CRLF
   while the branch they were written on had LF. */
const app = readFileSync(APP_JS, "utf8").replace(/\r\n/g, "\n");

/* ---------- the declared box -------------------------------------------- */

describe("the box the shop declares", () => {
  it("is small, because Montonio bills the greater of the real and the volumetric weight", () => {
    /* 25 × 18 × 10 is about 1.1 kg of volumetric weight; the 30 × 30 × 30 of
       REFERENCE_PARCEL is five to seven, whatever is inside it. At this shop's
       parcel sizes that difference is paid on every single label, which is why
       the default is a small carton and not a comfortable one. */
    expect(volumetricKg(PARCEL_DEFAULTS)).toBeLessThan(1.5);
    expect(volumetricKg({ length: 30, width: 30, height: 30 })).toBeGreaterThan(5);
  });

  it("reproduces the reference's own worked example, 20 × 15 × 10 → 0.75 kg", () => {
    expect(volumetricKg({ length: 20, width: 15, height: 10 })).toBe(0.75);
  });

  it("holds a 500 ml bottle — the largest size the catalogue sells — lying down", () => {
    // ~7 × 7 × 22 cm; the box's longest side has to take the 22
    expect(Math.max(PARCEL_DEFAULTS.length, PARCEL_DEFAULTS.width, PARCEL_DEFAULTS.height))
      .toBeGreaterThanOrEqual(23);
  });

  it("converts to METRES for POST /shipments and nothing else does", () => {
    expect(parcelMetres({ ...PARCEL_DEFAULTS, length: 25, width: 18, height: 10 }))
      .toEqual({ length: 0.25, width: 0.18, height: 0.1 });
  });

  it("clamps a side to a real carton and keeps the defaults for nonsense", () => {
    expect(cleanParcel({ length: 0, width: -3, height: "нет" })).toMatchObject({
      length: PARCEL_DEFAULTS.length,
      width: PARCEL_DEFAULTS.width,
      height: PARCEL_DEFAULTS.height,
    });
    expect(cleanParcel({ length: 5000 }).length).toBe(200);
    expect(cleanParcel(null)).toEqual({ ...PARCEL_DEFAULTS, recent: [] });
    expect(cleanParcel("30x30")).toEqual({ ...PARCEL_DEFAULTS, recent: [] });
  });
});

/* ---------- the locker door --------------------------------------------- */

describe("the locker door, chosen at label time", () => {
  it("is only sent for the carriers Montonio documents it for", () => {
    expect(takesLockerSize("smartpost")).toBe(true);
    expect(takesLockerSize("unisend")).toBe(true);
    expect(takesLockerSize("latvian_post")).toBe(true);
    // Omniva's Estonian drop-off pin is a copy of the parcel id; DPD's is a
    // service on the carrier account. Neither takes the field.
    expect(takesLockerSize("omniva")).toBe(false);
    expect(takesLockerSize("dpd")).toBe(false);
    expect(takesLockerSize("")).toBe(false);
  });

  it("takes only the five doors Montonio names, in upper case", () => {
    expect([...LOCKER_SIZES]).toEqual(["XS", "S", "M", "L", "XL"]);
    expect(toLockerSize("m")).toBe("M");
    expect(toLockerSize(" xl ")).toBe("XL");
    expect(toLockerSize("XXL")).toBeNull();
    expect(toLockerSize(null)).toBeNull();
  });

  it("suggests the commonest of the recent labels", () => {
    const p = cleanParcel({ recent: ["S", "M", "M", "L", "M"] });
    expect(suggestedLockerSize(p)).toBe("M");
    expect(lockerSizeReason(p)).toBe("чаще всего");
  });

  it("breaks a tie towards the one used most recently", () => {
    // newest first: S was the last label, and S and M are two apiece
    expect(suggestedLockerSize(cleanParcel({ recent: ["S", "M", "S", "M"] }))).toBe("S");
    expect(suggestedLockerSize(cleanParcel({ recent: ["M", "S", "M", "S"] }))).toBe("M");
  });

  it("falls back to the owner's own default before there is any history", () => {
    const p = cleanParcel({ lockerSize: "L" });
    expect(suggestedLockerSize(p)).toBe("L");
    expect(lockerSizeReason(p)).toBe("по умолчанию");
    expect(suggestedLockerSize(cleanParcel(null))).toBe(PARCEL_DEFAULTS.lockerSize);
  });

  it("says «как в прошлый раз» for a single label, not «чаще всего»", () => {
    expect(lockerSizeReason(cleanParcel({ recent: ["XL"] }))).toBe("как в прошлый раз");
  });

  it("remembers newest first and forgets past twenty", () => {
    let p = cleanParcel(null);
    for (const size of ["S", "M", "L"] as LockerSize[]) p = rememberLockerSize(p, size);
    expect(p.recent).toEqual(["L", "M", "S"]);
    for (let i = 0; i < 30; i++) p = rememberLockerSize(p, "XS");
    expect(p.recent).toHaveLength(20);
    expect(p.recent.every((x) => x === "XS")).toBe(true);
  });

  it("drops a size the wire does not know rather than storing it", () => {
    expect(cleanParcel({ recent: ["M", "HUGE", "S", 7] }).recent).toEqual(["M", "S"]);
  });
});

/* ---------- where a pickup point is offered ------------------------------ */

describe("the countries a pickup point is offered in", () => {
  it("is every country the mirror prices a locker for with a billable carrier", () => {
    // «open every country DPD serves» — 18 outside the Baltics and Finland
    expect(PICKUP_POINT_COUNTRIES).toContain("IT");
    expect(PICKUP_POINT_COUNTRIES).toContain("PL");
    expect(PICKUP_POINT_COUNTRIES).toContain("DE");
    expect(PICKUP_POINT_COUNTRIES).toContain("EE");
    expect(PICKUP_POINT_COUNTRIES.length).toBeGreaterThanOrEqual(22);
  });

  it("leaves out the three that have no locker the shop can bill from", () => {
    /* Greece has no pickup point at any carrier; Hungary and Romania have one
       at Nova Post only, and Nova Post outside the Baltics is a separate
       decision — Montonio International Shipping, no returns at all. */
    for (const c of ["GR", "HU", "RO"]) expect(PICKUP_POINT_COUNTRIES).not.toContain(c);
  });

  it("is open by default and narrowed by a setting, not by a deploy", () => {
    expect(DEFAULT_SHIPPING_RULES.pickupOff).toEqual([]);
    expect(pickupOffered(DEFAULT_SHIPPING_RULES, "IT")).toBe(true);
    const narrowed = parseShippingRules({ pickupOff: ["IT", "FR"] });
    expect(pickupOffered(narrowed, "IT")).toBe(false);
    expect(pickupOffered(narrowed, "PL")).toBe(true);
  });

  it("can never be turned on for a country with no locker at all", () => {
    expect(pickupOffered(parseShippingRules({ pickupOff: [] }), "GR")).toBe(false);
    expect(pickupOffered(parseShippingRules({ pickupOff: [] }), "HU")).toBe(false);
  });

  it("stores only real codes, sorted, and an empty list survives a save", () => {
    expect(cleanShippingRules({ pickupOff: ["it", "GR", "zz", "PL", "IT"] }).pickupOff).toEqual(["IT", "PL"]);
    expect(cleanShippingRules({ pickupOff: [] }).pickupOff).toEqual([]);
    // a row that says nothing about it is not a row that says «нигде»
    expect(cleanShippingRules({}).pickupOff).toEqual([]);
  });
});

/* ---------- the storefront's copy of all three --------------------------- */

describe("public/shop2/app.js says the same thing", () => {
  /** A `var NAME = …;` literal out of app.js, evaluated. */
  function literal(name: string): unknown {
    const at = app.indexOf(`var ${name} = `);
    if (at < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
    const start = app.indexOf("=", at) + 1;
    const end = app.indexOf(";\n", start);
    return new Function(`return (${app.slice(start, end)});`)();
  }

  it("declares the same carton and the same seeded door", () => {
    const mirror = literal("PARCEL_DEFAULT") as Record<string, unknown>;
    expect(mirror).toEqual({
      length: PARCEL_DEFAULTS.length,
      width: PARCEL_DEFAULTS.width,
      height: PARCEL_DEFAULTS.height,
      lockerSize: PARCEL_DEFAULTS.lockerSize,
      recent: [],
    });
    expect(literal("LOCKER_SIZES")).toEqual([...LOCKER_SIZES]);
  });

  it("offers a pickup point in exactly the countries the server prices one for", () => {
    const by = literal("CARRIERS_BY_COUNTRY") as Record<string, string[]>;
    const open = Object.keys(by).filter((c) => c !== "EU" && by[c].length > 0).sort();
    expect(open).toEqual([...PICKUP_POINT_COUNTRIES].sort());
  });

  it("asks only DPD outside the Baltics — Nova Post there is its own decision", () => {
    const by = literal("CARRIERS_BY_COUNTRY") as Record<string, string[]>;
    for (const [country, carriers] of Object.entries(by)) {
      if (["EE", "LV", "LT", "FI", "EU"].includes(country)) continue;
      expect(carriers, country).toEqual(["dpd"]);
    }
  });

  it("only ever asks for a locker door where the server would send one", () => {
    const carriers = literal("LOCKER_CARRIERS") as string[];
    for (const c of carriers) expect(takesLockerSize(c), c).toBe(true);
  });
});

/* ---------- what actually reaches Montonio ------------------------------- */

/**
 * The wire, end to end: `createMontonioShipment()` with a stubbed fetch.
 *
 * The three things worth a network-level test — none of them is visible from
 * the pure functions above:
 *   · `lockerSize` goes out only for a carrier that takes it;
 *   · dimensions go out **only** where `constraints.parcelDimensionsRequired`
 *     is true, because sending them where they are not wanted can move a size
 *     tier, and a size tier is money;
 *   · when they do go out they are **metres**.
 */
describe("what createMontonioShipment actually posts", () => {
  const ACCESS = "test-access-key";
  const SECRET = "test-secret-key-test-secret-key-0";
  type Call = { url: string; init: RequestInit | undefined };

  function stub(routes: Array<[RegExp, () => Response]>): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        for (const [re, handler] of routes) if (re.test(url)) return handler();
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    return calls;
  }
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  /** `/shipping-methods` with the flag set — or not — for smartpost in EE. */
  const methods = (required: boolean) => ({
    countries: [
      {
        countryCode: "EE",
        carriers: [
          {
            carrierCode: "smartpost",
            shippingMethods: [{ type: "pickupPoint", constraints: { parcelDimensionsRequired: required } }],
          },
        ],
      },
    ],
  });

  const POINT = "0e0e0e0e-0000-4000-8000-000000000001";
  const shipmentBody = {
    id: "1f83f4c1-cccc-4dd5-8eae-837e6a88362f",
    status: "registered",
    shippingMethod: { type: "pickupPoint", carrierCode: "smartpost", countryCode: "EE" },
    parcels: [{ carrierParcelId: "CC1", dropOffPin: "4821" }],
  };

  const order = {
    id: "ord-1",
    number: "R-100001",
    email: "ostja@example.com",
    name: "Johnny Receiver",
    phone: "58107505",
    currency: "EUR",
    status: "paid",
    items: [{ id: "free-hold", title: "Free.Hold", qty: 1, price: 11 }],
    shipping: { method: "parcel", country: "EE", carrier: "smartpost", pointId: POINT, price: 2.59 },
  };

  async function book(required: boolean, carrier = "smartpost", opts: Record<string, unknown> = {}) {
    const { createMontonioShipment, resetMontonioMethodsCache } = await import("@/lib/shipping/montonio");
    resetMontonioMethodsCache();
    const calls = stub([
      [/\/shipping-methods$/, () => json(methods(required))],
      [/\/shipments$/, () => json(shipmentBody)],
    ]);
    await createMontonioShipment(
      { ...order, shipping: { ...order.shipping, carrier } } as never,
      { lockerSize: "M", ...opts },
    );
    const hit = calls.find((c) => /\/shipments$/.test(c.url));
    return JSON.parse(String(hit?.init?.body)) as Record<string, never>;
  }

  beforeEach(() => {
    process.env.MONTONIO_ACCESS_KEY = ACCESS;
    process.env.MONTONIO_SECRET_KEY = SECRET;
    process.env.MONTONIO_ENV = "sandbox";
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.MONTONIO_ACCESS_KEY;
    delete process.env.MONTONIO_SECRET_KEY;
    delete process.env.MONTONIO_ENV;
    (await import("@/lib/shipping/montonio")).resetMontonioMethodsCache();
  });

  it("sends the locker door for a carrier that takes one", async () => {
    const body = await book(false);
    expect(body.shippingMethod).toEqual({ type: "pickupPoint", id: POINT, lockerSize: "M" });
  });

  it("leaves the door out for a carrier that does not take one", async () => {
    const body = await book(false, "omniva");
    expect(body.shippingMethod).toEqual({ type: "pickupPoint", id: POINT });
  });

  it("sends no dimensions where Montonio does not require them", async () => {
    const body = await book(false);
    expect(body.parcels).toEqual([{ weight: 0.6 }]);
  });

  it("declares the carton, in METRES, where Montonio does require them", async () => {
    const body = await book(true);
    expect(body.parcels).toEqual([
      { weight: 0.6, length: 0.25, width: 0.18, height: 0.1 },
    ]);
  });

  it("honours an explicit box even where the flag is false — «эта посылка другая»", async () => {
    const body = await book(false, "smartpost", { length: 0.4, width: 0.3, height: 0.2 });
    expect(body.parcels).toEqual([{ weight: 0.6, length: 0.4, width: 0.3, height: 0.2 }]);
  });
});
