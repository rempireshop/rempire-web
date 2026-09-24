/**
 * The offer and the price table, held to Montonio's own evidence of 24.09.2026.
 *
 * docs/montonio-evidence-2026-09-24.txt is verbatim: (1) the carrier route
 * entries of the LIVE shipping-calculator.montonio.com bundle
 * (main-35YJWUPN.js) with its country aliases, and (2) live answers of the
 * public `GET /v2/contract-prices` for SmartPosti and DPD from Estonia, in
 * this shop's 25 × 18 × 8 carton at 0.5 kg. Nothing here fetches anything;
 * the file is the evidence and this is what it proves.
 *
 * Why it exists: Montonio's written answer of 24.09.2026 says «SmartPosti has
 * courier deliveries only» for international shipments. Read alone, that
 * sentence would strip the SmartPosti lockers in LV, LT and FI. Read against
 * the calculator's route matrix it means the rest of Europe: SmartPosti's
 * pickup-point route from EE is exactly [EE, LV, LT, FI], its courier route
 * those four plus twenty-one EU countries. The same answer says DPD abroad is
 * «a flat rate, weight only, or a box size category (XS/S/M/L) — not a
 * volumetric weight divisor», and the contract-prices lines show which route
 * is which and that this carton is DPD's XS.
 *
 * What is pinned:
 *   · tools/lib/montonio-routes.mjs — the shop's copy of the matrix — against
 *     the bundle, carrier by carrier, with the one deliberate drift named;
 *   · src/data/montonio-tariffs.json against every contract-prices line: the
 *     same ex-VAT price, the same pricing strategy, the same size category —
 *     and «no price» where Montonio answered `[]`;
 *   · the checkout's offer against both.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import tariffs from "@/data/montonio-tariffs.json";
import { offeredCarriers } from "@/lib/shipping/country-prices";
import { ORDINARY_PARCEL_KG, PARCEL_DEFAULTS, chargeableKg } from "@/lib/shipping/parcel";
import { CARRIERS } from "../tools/lib/montonio-routes.mjs";

const EVIDENCE = readFileSync(
  fileURLToPath(new URL("../docs/montonio-evidence-2026-09-24.txt", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

/* ---------- 1. the calculator bundle ------------------------------------- */

/** `var{EE:de,LV:Oe,…}` → { de: "EE", Oe: "LV", … } */
function aliases(): Record<string, string> {
  const m = EVIDENCE.match(/^var\{([^}]*)\}$/m);
  expect(m, "the alias line is missing from the evidence").toBeTruthy();
  const out: Record<string, string> = {};
  for (const pair of m![1].split(",")) {
    const [cc, name] = pair.split(":");
    out[name] = cc;
  }
  return out;
}

/**
 * The bundle's own route-list variables. `q` and `ig` are quoted in the
 * evidence file. `xd`/`rg` (DPD) and `ao`/`da` (Nova Post) are not — the
 * evidence prints the carrier entries that name them, not their definitions —
 * so they are quoted here from the copy of the same bundle read on
 * 22.09.2026, whose alias map and whose SmartPosti, DPD, Omniva, Unisend and
 * Nova Post entries are character-for-character the ones in the evidence.
 * Verbatim, minified names and all.
 */
const BUNDLE_DEFS = [
  "q=[de,Oe,vt]",
  "ig=[at,ua,Dd,wd,ha,fa,Ed,pa,lo,ga,Sd,co,Md,ma,Od,uo,Rd,_a,bd,Pd,va]",
  "xd=[...q,Fe,bd,at,ua,Dd,wd,ha,fa,Ed,pa,lo,ga,Sd,co,Md,ma,Od,uo,Rd,_a,Pd,va].sort()",
  "rg=xd.filter(t=>t!==ga&&t!==co)",
  "ao=[...q,at,fa,ha,ma,pa,co,va,uo,ua,_a,lo].sort()",
  "da=ao.filter(t=>t!==lo&&t!==uo)",
];

/** Evaluate a route expression from the bundle in a scope of its own aliases. */
function routeScope(): (expr: string) => string[] {
  const names = aliases();
  const decl = Object.entries(names)
    .map(([name, cc]) => `var ${name} = ${JSON.stringify(cc)};`)
    .join("\n");
  const defs = BUNDLE_DEFS.map((d) => `var ${d};`).join("\n");
  return (expr: string) => new Function(`${decl}\n${defs}\nreturn (${expr});`)() as string[];
}

/** `[W.SMARTPOSTI]:{… routes:{[X.PICKUP_POINT]:{[de]:<expr>,…},[X.COURIER]:{[de]:<expr>,…}}` → the EE-source expressions. */
function entryRoutes(code: string): { pickupPoint: string | null; courier: string | null } {
  /* The entry's OWN line: the DPD line of the evidence runs on into the start
     of Omniva's entry and is cut off there, so the first occurrence of an
     entry is not necessarily a whole one. */
  const line = EVIDENCE.split("\n").find((l) => l.startsWith(`[W.${code}]:{code:W.${code}`));
  expect(line, `the ${code} entry is missing from the evidence`).toBeTruthy();
  const block = (key: string): string | null => {
    const m = line!.match(new RegExp(`\\[X\\.${key}\\]:\\{\\[de\\]:(\\[[^\\]]*\\]|[A-Za-z_$][\\w$]*)`));
    return m ? m[1] : null;
  };
  return { pickupPoint: block("PICKUP_POINT"), courier: block("COURIER") };
}

const sorted = (a: readonly string[]) => [...a].sort();

describe("the calculator bundle (live, 24.09.2026) against tools/lib/montonio-routes.mjs", () => {
  const evalRoute = routeScope();
  const bundle = (code: string) => {
    const r = entryRoutes(code);
    return {
      pickupPoint: r.pickupPoint ? sorted(evalRoute(r.pickupPoint)) : [],
      courier: r.courier ? sorted(evalRoute(r.courier)) : [],
    };
  };

  it("SmartPosti: lockers in EE, LV, LT and FI only — couriers there and to 21 more", () => {
    const b = bundle("SMARTPOSTI");
    expect(b.pickupPoint).toEqual(sorted(["EE", "LV", "LT", "FI"]));
    expect(b.courier).toHaveLength(25);
    expect(sorted(CARRIERS.smartpost.pickupPoint)).toEqual(b.pickupPoint);
    expect(sorted(CARRIERS.smartpost.courier)).toEqual(b.courier);
  });

  it("Omniva and Unisend: the Baltics, and Unisend lockers only", () => {
    const o = bundle("OMNIVA");
    const u = bundle("UNISEND");
    expect(sorted(CARRIERS.omniva.pickupPoint)).toEqual(o.pickupPoint);
    expect(sorted(CARRIERS.omniva.courier)).toEqual(o.courier);
    expect(sorted(CARRIERS.unisend.pickupPoint)).toEqual(u.pickupPoint);
    expect(u.courier).toEqual([]);
    expect(CARRIERS.unisend.courier).toEqual([]);
  });

  it("Nova Post: fourteen courier countries, lockers in all but France and the Netherlands", () => {
    const n = bundle("NOVA_POST");
    expect(sorted(CARRIERS.novaPost.courier)).toEqual(n.courier);
    expect(sorted(CARRIERS.novaPost.pickupPoint)).toEqual(n.pickupPoint);
  });

  it("DPD: every courier country matches; the one locker drift is Romania, and it is deliberate", () => {
    const d = bundle("DPD");
    expect(sorted(CARRIERS.dpd.courier)).toEqual(d.courier);
    /* The bundle lists Romania among DPD's lockers; the shop's copy leaves it
       out because GET /v2/contract-prices answers `[]` for it — the route
       exists, Montonio has no contract price, direct contract only (measured
       22.09.2026 at all four sizes; tools/lib/montonio-routes.mjs says so). A
       route we cannot be quoted for is a route we cannot sell. Any OTHER drift
       fails here. */
    const onlyInBundle = d.pickupPoint.filter((c) => !CARRIERS.dpd.pickupPoint.includes(c));
    const onlyInLib = CARRIERS.dpd.pickupPoint.filter((c: string) => !d.pickupPoint.includes(c));
    expect(onlyInBundle).toEqual(["RO"]);
    expect(onlyInLib).toEqual([]);
  });
});

/* ---------- 2. contract-prices, live, 24.09.2026 ------------------------- */

type Mirror = {
  carrier: string;
  country: string;
  method: string;
  priceExVat: number;
  pricingStrategy: string;
  size: string | null;
  maxWeightKg: number | null;
};
const MIRROR = (tariffs as unknown as { rates: Mirror[] }).rates;

type Line = {
  carrier: string;
  country: string;
  method: "parcel" | "courier";
  none: boolean;
  price?: number;
  strategy?: string;
  size?: string | null;
};

function contractLines(): Line[] {
  const out: Line[] = [];
  for (const m of EVIDENCE.matchAll(/^(smartpost|dpd) ([A-Z]{2}) (pickupPoint|courier) -> (.*)$/gm)) {
    const [, carrier, country, wire, rest] = m;
    const method = wire === "courier" ? "courier" : "parcel";
    if (/^NONE/.test(rest)) {
      out.push({ carrier, country, method, none: true });
      continue;
    }
    const price = Number(rest.match(/"pricePerParcel":([\d.]+)/)?.[1]);
    const strategy = rest.match(/"pricingStrategy":"(\w+)"/)?.[1];
    const sizeRaw = rest.match(/"size":(null|"\w+")/)?.[1];
    out.push({
      carrier,
      country,
      method,
      none: false,
      price,
      strategy,
      size: sizeRaw && sizeRaw !== "null" ? JSON.parse(sizeRaw) : null,
    });
  }
  return out;
}

describe("contract-prices (live, 24.09.2026) against src/data/montonio-tariffs.json", () => {
  const lines = contractLines();

  it("reads all 28 lines of the evidence", () => {
    expect(lines).toHaveLength(28);
    expect(lines.filter((l) => l.none).map((l) => `${l.carrier} ${l.country}`)).toEqual([
      "smartpost SE",
      "smartpost PL",
      "smartpost DE",
    ]);
  });

  it("has the same price, pricing strategy and size category on every line", () => {
    const drift: string[] = [];
    for (const l of lines.filter((x) => !x.none)) {
      const row = MIRROR.find((r) => r.carrier === l.carrier && r.country === l.country && r.method === l.method);
      if (!row) {
        drift.push(`${l.carrier} ${l.country} ${l.method}: Montonio prices it, the mirror has no row`);
        continue;
      }
      if (row.priceExVat !== l.price) drift.push(`${l.carrier} ${l.country} ${l.method}: ${row.priceExVat} ≠ ${l.price}`);
      if (row.pricingStrategy !== l.strategy) drift.push(`${l.carrier} ${l.country} ${l.method}: ${row.pricingStrategy} ≠ ${l.strategy}`);
      if ((row.size ?? null) !== (l.size ?? null)) drift.push(`${l.carrier} ${l.country} ${l.method}: size ${row.size} ≠ ${l.size}`);
    }
    expect(drift).toEqual([]);
  });

  it("offers no SmartPosti locker where Montonio has none — and every one where it does", () => {
    for (const l of lines.filter((x) => x.carrier === "smartpost")) {
      const offered = offeredCarriers(l.country, l.method).includes("smartpost");
      expect([l.country, l.method, offered]).toEqual([l.country, l.method, !l.none]);
    }
  });

  it("prices this carton as DPD's XS wherever DPD prices a locker by size", () => {
    /* PL and DE in the evidence; every sizeBased row in the mirror. The
       category is Montonio's own answer for 25 × 18 × 8, not our inference. */
    const sized = lines.filter((l) => l.strategy === "sizeBased");
    expect(sized.map((l) => `${l.carrier} ${l.country}`)).toEqual(["dpd PL", "dpd DE"]);
    for (const l of sized) expect(l.size).toBe("XS");
    const mirrorSized = MIRROR.filter((r) => r.pricingStrategy === "sizeBased");
    expect(mirrorSized.length).toBeGreaterThan(10);
    expect(new Set(mirrorSized.map((r) => `${r.carrier}:${r.method}:${r.size}`))).toEqual(new Set(["dpd:parcel:XS"]));
  });

  it("puts the real weight of a light parcel in the same tier the mirror was quoted in", () => {
    /* The evidence was asked at 0.5 kg, the mirror at 0.9 kg — and every
       weight-priced line answers the same price, i.e. the same tier. So a real
       0.5 kg parcel and the declared 0.9 kg are one price, and it is the real
       weight that picks it (chargeableKg, MONTONIO_PRICES_VOLUMETRIC off). */
    const weighted = lines.filter((l) => l.strategy === "weightBased");
    expect(weighted.length).toBeGreaterThan(5);
    for (const l of weighted) {
      const row = MIRROR.find((r) => r.carrier === l.carrier && r.country === l.country && r.method === l.method)!;
      expect(chargeableKg(0.5, PARCEL_DEFAULTS)).toBeLessThanOrEqual(row.maxWeightKg!);
      expect(ORDINARY_PARCEL_KG).toBeLessThanOrEqual(row.maxWeightKg!);
      expect(row.priceExVat, `${l.carrier} ${l.country} ${l.method}`).toBe(l.price);
    }
  });
});
