import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPoints,
  isCarrier,
  mapDpdRows,
  mapOmnivaRows,
  resetPointsCache,
  seedPoints,
} from "@/lib/parcel-points";

/** A verbatim record from https://www.omniva.ee/locations.json. */
const OMNIVA_ROW = {
  ZIP: "96243",
  NAME: "Abja Coop Konsumi pakiautomaat",
  TYPE: "0",
  A0_NAME: "EE",
  A1_NAME: "Viljandi maakond",
  A2_NAME: "Mulgi vald",
  A3_NAME: "Abja-Paluoja linn",
  A4_NAME: "",
  A5_NAME: "Pärnu mnt",
  A6_NAME: "",
  A7_NAME: "13",
  A8_NAME: "",
  X_COORDINATE: "25.355809",
  Y_COORDINATE: "58.125803",
};

/** A fetch stub whose call signature survives typecheck, so mock.calls types. */
type FetchArgs = [input: string | URL | Request, init?: RequestInit];
function fetchMockOf(fn: (...args: FetchArgs) => Promise<Response>) {
  const mock = vi.fn(fn);
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  resetPointsCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetPointsCache();
});

describe("mapping Omniva's feed", () => {
  it("reads a machine, with X as longitude and Y as latitude", () => {
    const [p] = mapOmnivaRows([OMNIVA_ROW]);
    expect(p).toEqual({
      id: "omniva-96243",
      carrier: "omniva",
      name: "Abja Coop Konsumi pakiautomaat",
      address: "Pärnu mnt 13",
      city: "Mulgi vald",
      // ZIP is Omniva's internal terminal code, never a mailable postcode
      zip: "",
      country: "EE",
      lat: 58.125803,
      lng: 25.355809,
      type: "machine",
    });
    // the names read backwards, so guard the axes explicitly
    expect(p.lat).toBeGreaterThan(p.lng);
  });

  it("keeps the real postcode on a post office", () => {
    const [p] = mapOmnivaRows([{ ...OMNIVA_ROW, TYPE: "1", ZIP: "11701" }]);
    expect(p.type).toBe("office");
    expect(p.zip).toBe("11701");
  });

  it("takes the city from the right column per country", () => {
    const [lv] = mapOmnivaRows([
      { ...OMNIVA_ROW, A0_NAME: "LV", A2_NAME: "", A3_NAME: "Ādaži", A1_NAME: "Ādažu novads" },
    ]);
    expect(lv.city).toBe("Ādaži");
    const [lv2] = mapOmnivaRows([
      { ...OMNIVA_ROW, A0_NAME: "LV", A2_NAME: "", A3_NAME: "", A1_NAME: "Ādažu novads" },
    ]);
    expect(lv2.city).toBe("Ādažu novads");
  });

  it("drops rows nobody can send a parcel to", () => {
    expect(
      mapOmnivaRows([
        { ...OMNIVA_ROW, NAME: "Omniva ettevõttesisene pakiautomaat" },
        { ...OMNIVA_ROW, NAME: "1. eelistus/Picapac pakiautomaat" },
        { ...OMNIVA_ROW, X_COORDINATE: "0", Y_COORDINATE: "0" },
        { ...OMNIVA_ROW, A0_NAME: "" },
        { ...OMNIVA_ROW, NAME: "" },
      ]),
    ).toHaveLength(0);
    expect(mapOmnivaRows("not an array")).toEqual([]);
    expect(mapOmnivaRows([null, 42])).toEqual([]);
  });
});

describe("mapping DPD's contract feed", () => {
  it("reads a parcelshop record", () => {
    expect(
      mapDpdRows([
        {
          parcelshop_id: "LT90020",
          company: "DPD Pakiautomaat Kristiine",
          country: "EE",
          city: "Tallinn",
          pcode: "10616",
          street: "Endla 45",
          latitude: "59.4281",
          longitude: "24.7166",
        },
      ]),
    ).toEqual([
      {
        id: "dpd-LT90020",
        carrier: "dpd",
        name: "DPD Pakiautomaat Kristiine",
        address: "Endla 45",
        city: "Tallinn",
        zip: "10616",
        country: "EE",
        lat: 59.4281,
        lng: 24.7166,
        type: "machine",
      },
    ]);
  });
});

describe("the committed seed", () => {
  it("carries points for every country the shop delivers to", () => {
    expect(seedPoints("omniva", "EE").length).toBeGreaterThan(100);
    expect(seedPoints("omniva", "LV").length).toBeGreaterThan(100);
    expect(seedPoints("omniva", "LT").length).toBeGreaterThan(100);
    expect(seedPoints("smartpost", "EE").length).toBeGreaterThan(100);
  });

  it("filters by carrier and country", () => {
    for (const p of seedPoints("smartpost", "EE")) {
      expect(p.carrier).toBe("smartpost");
      expect(p.country).toBe("EE");
      expect(Number.isFinite(p.lat)).toBe(true);
      expect(Number.isFinite(p.lng)).toBe(true);
      expect(p.name).toBeTruthy();
    }
  });

  it("knows which carriers exist", () => {
    expect(isCarrier("omniva")).toBe(true);
    expect(isCarrier("smartpost")).toBe(true);
    expect(isCarrier("dpd")).toBe(true);
    expect(isCarrier("hermes")).toBe(false);
    expect(isCarrier(7)).toBe(false);
  });
});

describe("getPoints", () => {
  it("uses the live feed when the carrier answers", async () => {
    const fetchMock = fetchMockOf(async () =>
      new Response(JSON.stringify([OMNIVA_ROW, { ...OMNIVA_ROW, A0_NAME: "LV", ZIP: "9595" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const out = await getPoints("omniva", "EE");
    expect(out.source).toBe("live");
    expect(out.points).toHaveLength(1);
    expect(out.points[0].id).toBe("omniva-96243");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://www.omniva.ee/locations.json");
  });

  it("serves the second call from the cache", async () => {
    const fetchMock = fetchMockOf(async () =>
      new Response(JSON.stringify([OMNIVA_ROW]), { status: 200 }),
    );
    await getPoints("omniva", "EE");
    const second = await getPoints("omniva", "EE");
    expect(second.source).toBe("cache");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls back to the seed when the feed is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const out = await getPoints("omniva", "EE");
    expect(out.source).toBe("seed");
    expect(out.points.length).toBeGreaterThan(100);
    expect(out.points.every((p) => p.country === "EE" && p.carrier === "omniva")).toBe(true);
  });

  it("falls back to the seed on an HTTP error and on junk", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("gateway timeout", { status: 504 })),
    );
    expect((await getPoints("omniva", "EE")).source).toBe("seed");

    resetPointsCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ nope: true }), { status: 200 })),
    );
    expect((await getPoints("omniva", "EE")).source).toBe("seed");
  });

  it("never calls out for smartpost — it has no request-time feed", async () => {
    const fetchMock = fetchMockOf(async () => new Response("[]", { status: 200 }));
    const out = await getPoints("smartpost", "EE");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.source).toBe("seed");
    expect(out.points.length).toBeGreaterThan(100);
  });

  it("returns an empty list for a country the seed does not cover", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no");
      }),
    );
    const out = await getPoints("omniva", "PL");
    expect(out.source).toBe("seed");
    expect(out.points).toEqual([]);
  });

  it("needs credentials before it will ask DPD anything", async () => {
    const fetchMock = fetchMockOf(async () => new Response("[]", { status: 200 }));
    delete process.env.DPD_API_USER;
    delete process.env.DPD_API_PASS;
    const out = await getPoints("dpd", "EE");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.source).toBe("seed");
  });
});
