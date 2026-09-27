/**
 * tools/import-shopify-stock.mjs — the launch-day stock import, proved on
 * small synthetic exports rather than on the shop's real one (that file is
 * business data and never enters the repository).
 *
 * What has to hold on the morning: Shopify's inventory export is read in both
 * of its layouts; every Shopify variant lands on the one shelf row the shop
 * keys it by, or is named as needing a person — never guessed; the two hand
 * decisions of 26.09.2026 are computed from the day's export; and the write
 * goes through the shop's own door, once per row, with a key that makes a
 * second run a replay instead of a second ledger row.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isValidIdempotencyKey } from "@/lib/idempotency";
import {
  CONFIRM_WORD,
  DEFAULT_OWNER_ROWS,
  ImportError,
  applyPlan,
  applyRefusal,
  buildPlan,
  compareWithShelf,
  formatDryRun,
  idemKey,
  loadCatalogue,
  normSize,
  parseArgs,
  readInventoryCsv,
  readOwnerRows,
  runId,
  sizeMatch,
} from "../tools/import-shopify-stock.mjs";

/* ---------- types the .mjs does not carry --------------------------------- */

type InvRow = { handle: string; title: string; options: string[]; sku: string; available: number; onHand: number | null; line: number };
type Inventory = { format: string; locations: string[]; location: string; rows: InvRow[]; notStocked: unknown[] };
type PlanRow = { productId: string; variant: string; qty: number; from: string; source: string };
type Built = {
  plan: PlanRow[];
  skipped: Array<PlanRow & { why: string }>;
  decide: Array<{ handle: string; productId?: string; from: string; qty: number; why: string }>;
  decidedByHand: unknown[];
  unknown: Array<{ handle: string; from: string; qty: number }>;
  untouched: string[];
  ownerRows: Array<{ productId: string; variant: string; qty: number | null; how: string; seen: string; problem?: string }>;
};
type Catalogue = { ids: Set<string>; ladders: Record<string, string[]>; names: Record<string, string> };

const read = (text: string, opts: Record<string, unknown> = {}) => readInventoryCsv(text, opts) as unknown as Inventory;
const plan = (o: Record<string, unknown>) => buildPlan(o) as unknown as Built;

/* ---------- a shop small enough to read at a glance ------------------------ */

const CATALOGUE: Catalogue = {
  ids: new Set([
    "touchable", // one named volume
    "repair-me-wash", // three volumes
    "captain-fawcett-barberism-beard-oil", // handle carried a ® in Shopify
    "salon-comb", // no sizes at all
    "three-kings", // shirt sizes, Shopify adds a colour
    "body-builder", // Shopify's sizes have no unit
    "queen-of-colours", // one card, three sizes in Shopify
    "oversized-t-shirt-unisex-with-print", // colours here, colour × size there
    "never-in-shopify",
  ]),
  ladders: {
    touchable: ["250 мл"],
    "repair-me-wash": ["40 мл", "250 мл", "1000 мл"],
    "three-kings": ["S-M", "M-L", "L-XL"],
    "body-builder": ["100 мл", "400 мл"],
    "oversized-t-shirt-unisex-with-print": ["yellow-1", "white-1"],
  },
  names: {},
};

const HEAD_2024 =
  "Handle,Title,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Option3 Name,Option3 Value,SKU,HS Code,COO,Location,Bin name," +
  "Incoming (not editable),Unavailable (not editable),Committed (not editable),Available (not editable),On hand (current),On hand (new)";
const LOC = "Tartu mnt 50-4, Tallinn";

/** One row of the current layout: [handle, title, [options], available, onHand]. */
function row2024(handle: string, title: string, options: Array<[string, string]>, available: number | string, onHand: number | string, location = LOC) {
  const o = [...options, ["", ""], ["", ""], ["", ""]].slice(0, 3);
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [
    handle, q(title), o[0][0], q(o[0][1]), o[1][0], q(o[1][1]), o[2][0], q(o[2][1]), "", "", "", q(location), "",
    "0", "0", "0", String(available), String(onHand), "",
  ].join(",");
}

const EXPORT_2024 = [
  "﻿" + HEAD_2024,
  row2024("touchable", "KEVIN.MURPHY TOUCHABLE", [["Size", "250ml"]], 7, 7),
  row2024("repair-me-wash", "REPAIR-ME.WASH", [["Size", "40ml"]], 0, 0),
  row2024("repair-me-wash", "REPAIR-ME.WASH", [["Size", "250 ml"]], 3, 4),
  row2024("repair-me-wash", "REPAIR-ME.WASH", [["Size", "1000ml"]], -2, 0),
  row2024("captain-fawcett-barberism®-beard-oil", "Captain Fawcett Barberism® Beard Oil", [["Title", "Default Title"]], 5, 5),
  row2024("salon-comb", "Salon comb", [["Title", "Default Title"]], 2, 2),
  row2024("three-kings", "Three Kings T-SHIRT", [["Color", "Graphite Grey"], ["Size", "S-M"]], 1, 2),
  row2024("three-kings", "Three Kings T-SHIRT", [["Color", "Graphite Grey"], ["Size", "M-L"]], 0, 0),
  row2024("three-kings", "Three Kings T-SHIRT", [["Color", "Graphite Grey"], ["Size", "L-XL"]], 4, 4),
  row2024("body-builder", "BODY.BUILDER", [["Size", "100"]], 2, 2),
  row2024("body-builder", "BODY.BUILDER", [["Size", "400"]], 6, 6),
  row2024("queen-of-colours", '"King of Colours" deep V-neck SLIM T-shirt', [["Color", "Black"], ["Size", "S-M"]], 0, 0),
  row2024("queen-of-colours", '"King of Colours" deep V-neck SLIM T-shirt', [["Color", "Black"], ["Size", "M-L"]], 2, 2),
  row2024("queen-of-colours", '"King of Colours" deep V-neck SLIM T-shirt', [["Color", "Black"], ["Size", "L-XL"]], 1, 1),
  ...["S", "M", "L", "XL", "XXL"].map((s) =>
    row2024("oversized-t-shirt-unisex-with-print", 'oversized t shirt unisex with print "NOBODY LOVES NO ONE"', [["Color", "yellow"], ["Size", s]], 0, 0),
  ),
  ...([["S", 1], ["M", 1], ["L", 1], ["XL", 0], ["XXL", 2]] as Array<[string, number]>).map(([s, n]) =>
    row2024("oversized-t-shirt-unisex-with-print", 'oversized t shirt unisex with print "NOBODY LOVES NO ONE"', [["Color", "white"], ["Size", s]], n, n),
  ),
  row2024("byredo-gypsy-water-body-wash-225ml", "Byredo Gypsy Water Body Wash 225ml", [["Title", "Default Title"]], 3, 3),
].join("\r\n") + "\r\n";

/** The committed hand decisions, as the CLI reads them by default. */
const OWNER_ROWS = readOwnerRows(readFileSync(DEFAULT_OWNER_ROWS, "utf8"));

/* ---------- reading the export ----------------------------------------------- */

describe("reading Shopify's inventory export", () => {
  it("reads the current layout — row per location, «(not editable)» headers, a BOM, CRLF, quoted titles", () => {
    const inv = read(EXPORT_2024);
    expect(inv.format).toBe("row per location");
    expect(inv.locations).toEqual([LOC]);
    expect(inv.location).toBe(LOC);
    expect(inv.rows).toHaveLength(25);
    const t = inv.rows[0];
    expect(t).toMatchObject({ handle: "touchable", options: ["250ml"], available: 7, onHand: 7 });
    // «Default Title» is Shopify's name for «no variant», not a size
    expect(inv.rows.find((r) => r.handle === "salon-comb")!.options).toEqual([]);
    expect(inv.rows.find((r) => r.handle === "queen-of-colours")!.title).toBe('"King of Colours" deep V-neck SLIM T-shirt');
  });

  it("reads the plain headers of the 2023 layout, and «On hand (new)» is never the figure", () => {
    const text = [
      "Handle,Title,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Option3 Name,Option3 Value,SKU,Location,Incoming,Unavailable,Committed,Available,On hand",
      `touchable,Touchable,Size,250ml,,,,,KM-1,${JSON.stringify(LOC)},0,0,1,4,5`,
    ].join("\n");
    const inv = read(text);
    expect(inv.rows[0]).toMatchObject({ available: 4, onHand: 5 });
  });

  it("reads the old layout — one column per location holding the available count, and no on-hand figure", () => {
    const text = [
      "Handle,Title,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Option3 Name,Option3 Value,SKU,Tartu mnt 50-4,Warehouse",
      "touchable,Touchable,Size,250ml,,,,,,6,40",
      "salon-comb,Comb,Title,Default Title,,,,,,not stocked,1",
    ].join("\n");
    expect(() => read(text)).toThrow(/2 locations — say which with --location/);
    const inv = read(text, { location: "Tartu mnt 50-4" });
    expect(inv.format).toBe("column per location");
    expect(inv.rows).toEqual([expect.objectContaining({ handle: "touchable", available: 6, onHand: null })]);
    // «not stocked» at this location is not a zero — it is left alone
    expect(inv.notStocked).toHaveLength(1);
    expect(() => plan({ inventory: inv, catalogue: CATALOGUE, use: "onHand" })).toThrow(/no «On hand» figure/);
  });

  it("refuses a file that is not an inventory export, and a location that is not in it", () => {
    expect(() => read("Name,Qty\nfoo,1\n")).toThrow(ImportError);
    expect(() => read("Name,Qty\nfoo,1\n")).toThrow(/no «Handle» column/);
    expect(() => read(EXPORT_2024, { location: "Mardi 1" })).toThrow(/no location «Mardi 1»/);
    const two = EXPORT_2024 + row2024("touchable", "T", [["Size", "250ml"]], 1, 1, "Mardi 1") + "\r\n";
    expect(() => read(two)).toThrow(/2 locations/);
    expect(read(two, { location: "Mardi 1" }).rows).toHaveLength(1);
  });
});

/* ---------- which shelf row ------------------------------------------------------ */

describe("matching a Shopify variant to the shelf row", () => {
  it("normalises volumes the way the catalogue wrote them", () => {
    expect(normSize("250ml")).toBe(normSize("250 мл"));
    expect(normSize("250 ml")).toBe(normSize("250 мл"));
    expect(normSize("50g")).toBe(normSize("50 г"));
    expect(normSize("250ml")).not.toBe(normSize("25 мл"));
  });

  it("finds the size, the only size, one option of several, a number without its unit — and names what it cannot", () => {
    expect(sizeMatch(["40 мл", "250 мл"], ["250ml"], 2)).toMatchObject({ size: "250 мл" });
    expect(sizeMatch(["250 мл"], [], 1)).toMatchObject({ size: "250 мл" });
    expect(sizeMatch(undefined, [], 1)).toMatchObject({ size: "" });
    expect(sizeMatch(undefined, ["10ml"], 1)).toMatchObject({ size: "" });
    expect(sizeMatch(["S-M", "M-L"], ["Graphite Grey", "S-M"], 2)).toMatchObject({ size: "S-M", near: true });
    expect(sizeMatch(["100 мл", "400 мл"], ["400"], 2)).toMatchObject({ size: "400 мл", near: true });
    expect(sizeMatch(undefined, ["Black", "S-M"], 3).unsure).toMatch(/Shopify has 3 variants/);
    expect(sizeMatch(["yellow-1", "white-1"], ["yellow", "S"], 10).unsure).toMatch(/no size «yellow \/ S»/);
    expect(sizeMatch(["250 мл"], ["200ml"], 1).unsure).toMatch(/no size «200ml»/);
  });
});

/* ---------- the plan -------------------------------------------------------------- */

describe("the plan", () => {
  const built = plan({ inventory: read(EXPORT_2024), catalogue: CATALOGUE, ownerRows: OWNER_ROWS });
  const at = (id: string, v = "") => built.plan.find((p) => p.productId === id && p.variant === v);

  it("sets every matched shelf row to Shopify's available count, a negative count as 0", () => {
    expect(at("touchable", "250 мл")).toMatchObject({ qty: 7, source: "shopify" });
    expect(at("repair-me-wash", "40 мл")!.qty).toBe(0);
    expect(at("repair-me-wash", "250 мл")!.qty).toBe(3);
    expect(at("repair-me-wash", "1000 мл")!.qty).toBe(0); // oversold in Shopify, never negative here
    expect(at("captain-fawcett-barberism-beard-oil")!.qty).toBe(5); // the ® stripped, as the catalogue did
    expect(at("salon-comb")!.qty).toBe(2);
    expect(at("three-kings", "S-M")!.qty).toBe(1);
    expect(at("three-kings", "L-XL")!.qty).toBe(4);
    expect(at("body-builder", "400 мл")!.qty).toBe(6);
  });

  it("takes the on-hand figure only when asked", () => {
    const onHand = plan({ inventory: read(EXPORT_2024), catalogue: CATALOGUE, ownerRows: OWNER_ROWS, use: "onHand" });
    expect(onHand.plan.find((p) => p.productId === "three-kings" && p.variant === "S-M")!.qty).toBe(2);
    expect(onHand.plan.find((p) => p.productId === "repair-me-wash" && p.variant === "250 мл")!.qty).toBe(4);
  });

  it("computes the two hand decisions of 26.09.2026 from the day's export", () => {
    expect(OWNER_ROWS).toHaveLength(3);
    expect(at("queen-of-colours")).toMatchObject({ qty: 3, source: "owner" });
    expect(at("oversized-t-shirt-unisex-with-print", "yellow-1")).toMatchObject({ qty: 0, source: "owner" });
    expect(at("oversized-t-shirt-unisex-with-print", "white-1")).toMatchObject({ qty: 5, source: "owner" });
    // the numbers the rule gave on 26.09 are kept beside it, for the dry run to be compared with
    expect(OWNER_ROWS.map((o: { seen: string }) => o.seen)).toEqual([
      expect.stringContaining("= 3"),
      expect.stringContaining("= 0"),
      expect.stringContaining("= 5"),
    ]);
    // …and the thirteen Shopify rows they answer are not left as questions
    expect(built.decide).toEqual([]);
    expect(built.decidedByHand).toHaveLength(13);
  });

  it("without the hand decisions, names every row a person has to decide and writes none of them", () => {
    const bare = plan({ inventory: read(EXPORT_2024), catalogue: CATALOGUE });
    expect(bare.plan.some((p) => p.productId === "queen-of-colours")).toBe(false);
    expect(bare.plan.some((p) => p.productId === "oversized-t-shirt-unisex-with-print")).toBe(false);
    expect(bare.decide).toHaveLength(13);
    expect(bare.decide.filter((d) => d.productId === "queen-of-colours")).toHaveLength(3);
  });

  it("names a Shopify product the new catalogue does not have, and a catalogue product Shopify does not", () => {
    expect(built.unknown).toEqual([expect.objectContaining({ handle: "byredo-gypsy-water-body-wash-225ml", qty: 3 })]);
    expect(built.untouched).toEqual(["never-in-shopify"]);
  });

  it("refuses to choose between two Shopify rows that land on one shelf row", () => {
    const twice = EXPORT_2024 + row2024("touchable", "KEVIN.MURPHY TOUCHABLE (old listing)", [["Size", "250 ml"]], 2, 2) + "\r\n";
    const b = plan({ inventory: read(twice), catalogue: CATALOGUE, ownerRows: OWNER_ROWS });
    expect(b.plan.some((p) => p.productId === "touchable")).toBe(false);
    expect(b.decide.filter((d) => d.productId === "touchable")).toHaveLength(2);
    expect(b.decide[0].why).toMatch(/2 Shopify rows land on the one shelf row/);
  });

  it("lets a hand decision win over an automatic match for the same shelf row, and settles a clash with it", () => {
    const fixed = readOwnerRows(JSON.stringify({ rows: [{ productId: "touchable", variant: "250 мл", qty: 11, decided: "counted by hand" }] }));
    const b = plan({ inventory: read(EXPORT_2024), catalogue: CATALOGUE, ownerRows: fixed });
    expect(b.plan.filter((p) => p.productId === "touchable")).toEqual([expect.objectContaining({ qty: 11, source: "owner" })]);
  });

  it("does not write a hand decision whose rule finds nothing in the export — it says so", () => {
    const rows = readOwnerRows(JSON.stringify({ rows: [{ productId: "queen-of-colours", variant: "", sum: { handle: "king-of-colours" } }] }));
    const b = plan({ inventory: read(EXPORT_2024), catalogue: CATALOGUE, ownerRows: rows });
    expect(b.plan.some((p) => p.productId === "queen-of-colours")).toBe(false);
    expect(b.ownerRows[0].problem).toMatch(/no row of handle «king-of-colours»/);
  });

  it("reads a hand-decisions file only when it is exactly right", () => {
    expect(() => readOwnerRows('{"rows":[{"productId":"x","qty":1,"sum":{"handle":"x"}}]}')).toThrow(/exactly one of qty or sum/);
    expect(() => readOwnerRows('{"rows":[{"productId":"x","qty":-1}]}')).toThrow(/whole number/);
    expect(() => readOwnerRows('{"rows":[{"qty":1}]}')).toThrow(/no productId/);
    expect(() => readOwnerRows('{"rows":[{"productId":"x","sum":{}}]}')).toThrow(/sum needs a handle/);
    expect(readOwnerRows('[{"productId":"x","variant":"S","qty":2}]')).toEqual([{ productId: "x", variant: "S", qty: 2, decided: "", seen: "" }]);
  });

  it("--only and --skip-zero narrow the plan and say what they left out", () => {
    const only = plan({ inventory: read(EXPORT_2024), catalogue: CATALOGUE, ownerRows: OWNER_ROWS, only: new Set(["repair-me-wash"]) });
    expect(new Set(only.plan.map((p) => p.productId))).toEqual(new Set(["repair-me-wash"]));
    const noZero = plan({ inventory: read(EXPORT_2024), catalogue: CATALOGUE, ownerRows: OWNER_ROWS, skipZero: true });
    expect(noZero.plan.every((p) => p.qty > 0)).toBe(true);
    expect(noZero.skipped.map((s) => s.why)).toContain("--skip-zero");
  });

  it("works on the real catalogue: the two merch cards are what the hand decisions assume", () => {
    const real = loadCatalogue() as unknown as Catalogue;
    expect(real.ids.has("queen-of-colours")).toBe(true);
    expect(real.ladders["queen-of-colours"]).toBeUndefined(); // one row, no size
    expect(real.ladders["oversized-t-shirt-unisex-with-print"]).toEqual(["yellow-1", "white-1"]);
    for (const o of OWNER_ROWS) expect(real.ids.has(o.productId), o.productId).toBe(true);
  });
});

/* ---------- before → after -------------------------------------------------------- */

describe("the dry run against the live «Склад»", () => {
  const built = plan({ inventory: read(EXPORT_2024), catalogue: CATALOGUE, ownerRows: OWNER_ROWS });
  const level = (productId: string, variant: string, qty: number, tracked: boolean, extra: Record<string, unknown> = {}) => ({
    productId, variant, qty, tracked, lowThreshold: 1, offSale: false, ...extra,
  });
  const levels = [
    level("touchable", "250 мл", 7, true),
    level("repair-me-wash", "40 мл", 0, false),
    level("repair-me-wash", "250 мл", 9, true),
    level("repair-me-wash", "1000 мл", 0, false),
    level("captain-fawcett-barberism-beard-oil", "", 0, false),
    level("salon-comb", "", 0, false, { lowThreshold: 2 }),
    level("three-kings", "S-M", 0, false),
    level("three-kings", "M-L", 0, false),
    // L-XL renamed in the panel: no row under Shopify's label
    level("three-kings", "L/XL", 0, false),
    level("body-builder", "100 мл", 0, false),
    level("body-builder", "400 мл", 0, false, { offSale: true }),
    level("queen-of-colours", "", 0, false),
    level("oversized-t-shirt-unisex-with-print", "yellow-1", 0, false),
    level("oversized-t-shirt-unisex-with-print", "white-1", 0, false),
  ];

  it("shows before → after, «мало» on the last unit only, and every warning a person must read", () => {
    const c = compareWithShelf(built.plan, levels);
    const row = (id: string, v = "") => c.rows.find((r: { productId: string; variant: string }) => r.productId === id && r.variant === v);
    expect(row("repair-me-wash", "250 мл")).toMatchObject({ before: "9", qty: 3, after: "in" });
    expect(row("three-kings", "S-M")).toMatchObject({ before: "не считали", qty: 1, after: "low" }); // threshold 1
    expect(row("repair-me-wash", "40 мл")!.after).toBe("out");
    expect(c.warnings.notOnShelf.map((r: { variant: string }) => r.variant)).toEqual(["L-XL"]);
    expect(c.warnings.overwrite.map((r: { productId: string }) => r.productId)).toEqual(["repair-me-wash"]); // 9 → 3; touchable 7 → 7 is no overwrite
    expect(c.warnings.threshold.map((r: { productId: string }) => r.productId)).toEqual(["salon-comb"]);
    expect(c.warnings.offSale.map((r: { productId: string }) => r.productId)).toEqual(["body-builder"]);
    expect(row("salon-comb")!.after).toBe("low"); // 2 at its own threshold of 2

    const text = formatDryRun({
      csvName: "inventory_export_1.csv", inventory: read(EXPORT_2024), use: "available", ref: "Импорт из Shopify",
      run: "abc", built, compared: c, ownerFile: "tools/shopify-stock-owner-rows.json",
    });
    expect(text).toContain("row per location · location «Tartu mnt 50-4, Tallinn»");
    expect(text).toContain("repair-me-wash · 250 мл: 9 → 3 (в наличии)");
    expect(text).toContain("queen-of-colours: 3 (sum of Black / S-M 0 + Black / M-L 2 + Black / L-XL 1)");
    expect(text).toContain("have no «Склад» row under that label");
    expect(text).toContain("will be OVERWRITTEN");
    expect(text).toContain("byredo-gypsy-water-body-wash-225ml");
    expect(text).toContain("never-in-shopify");
  });

  it("without a live «Склад» it still plans, with «?» for before and the default threshold of 1", () => {
    const c = compareWithShelf(built.plan, null);
    expect(c.live).toBe(false);
    expect(c.rows.every((r: { before: string; onShelf: boolean | null }) => r.before === "?" && r.onShelf === null)).toBe(true);
    expect(c.rows.find((r: { productId: string }) => r.productId === "salon-comb")!.after).toBe("in"); // 2 > 1
  });
});

/* ---------- writing ---------------------------------------------------------------- */

describe("--apply", () => {
  const built = plan({ inventory: read(EXPORT_2024), catalogue: CATALOGUE, ownerRows: OWNER_ROWS, only: new Set(["repair-me-wash", "three-kings"]) });
  const levels = [
    { productId: "repair-me-wash", variant: "40 мл", qty: 0, tracked: false, lowThreshold: 1, offSale: false },
    { productId: "repair-me-wash", variant: "250 мл", qty: 9, tracked: true, lowThreshold: 1, offSale: false },
    { productId: "repair-me-wash", variant: "1000 мл", qty: 0, tracked: false, lowThreshold: 1, offSale: false },
    { productId: "three-kings", variant: "S-M", qty: 0, tracked: false, lowThreshold: 1, offSale: false },
    { productId: "three-kings", variant: "M-L", qty: 0, tracked: false, lowThreshold: 1, offSale: false },
  ];

  function fakeShop(answer: (n: number) => { status: number; body: unknown } = () => ({ status: 200, body: { ok: true, result: { qtyBefore: 0, qtyAfter: 1 } } })) {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
    const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
      calls.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
      const a = answer(calls.length);
      return new Response(JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
    };
    return { calls, fetchImpl };
  }

  it("posts each row through the shop's own door, absolute and «ручная правка», with a stable key per row", async () => {
    const c = compareWithShelf(built.plan, levels);
    const shop = fakeShop();
    const out = await applyPlan({ rows: c.rows, base: "https://shop.example", cookie: "v1.token", ref: "Импорт из Shopify", run: "0123456789abcdef", fetchImpl: shop.fetchImpl, pause: 0 });

    // three-kings L-XL has no shelf row: skipped, never created
    expect(out.log.find((l: { variant: string }) => l.variant === "L-XL")!.result).toBe("skipped: no shelf row");
    expect(shop.calls).toHaveLength(5);
    expect(out.done).toBe(5);
    const first = shop.calls[0];
    expect(first.url).toBe("https://shop.example/api/admin/inventory/moves/");
    expect(first.method).toBe("POST");
    expect(first.headers.cookie).toBe("rmp_admin=v1.token");
    expect(first.body).toEqual({ productId: "repair-me-wash", variant: "1000 мл", qty: 0, reason: "adjust", ref: "Импорт из Shopify" });
    const keys = shop.calls.map((x) => x.headers["idempotency-key"]);
    for (const k of keys) expect(isValidIdempotencyKey(k), k).toBe(true);
    expect(new Set(keys).size).toBe(5);
    // the same run twice sends the same keys — the route replays instead of writing a second ledger row
    expect(idemKey("0123456789abcdef", { productId: "repair-me-wash", variant: "1000 мл" })).toBe(keys[0]);
  });

  it("stops at the first 401 and counts what failed", async () => {
    const c = compareWithShelf(built.plan, levels);
    const shop = fakeShop((n) => (n === 2 ? { status: 401, body: { ok: false } } : n === 1 ? { status: 400, body: { ok: false, error: "bad_qty" } } : { status: 200, body: { ok: true } }));
    const said: string[] = [];
    const out = await applyPlan({ rows: c.rows, base: "https://shop.example", cookie: "x", ref: "r", run: "0123456789abcdef", fetchImpl: shop.fetchImpl, pause: 0, say: (s: string) => said.push(s) });
    expect(shop.calls).toHaveLength(2);
    expect(out).toMatchObject({ done: 0, failed: 1, stopped: true });
    expect(said.join("\n")).toContain("bad_qty");
    expect(said.join("\n")).toContain("401");
  });

  it("a different export is a different run — its keys never replay an older import", () => {
    const a = runId({ csvText: "a", ownerText: "", use: "available", ref: "r", location: LOC });
    expect(runId({ csvText: "a", ownerText: "", use: "available", ref: "r", location: LOC })).toBe(a);
    expect(runId({ csvText: "b", ownerText: "", use: "available", ref: "r", location: LOC })).not.toBe(a);
    expect(runId({ csvText: "a", ownerText: "", use: "onHand", ref: "r", location: LOC })).not.toBe(a);
  });

  it("will not write without the shop, the session and the confirmation word", () => {
    const args = (s: string[]) => parseArgs(["--csv", "x.csv", ...s]);
    expect(applyRefusal(args([]), "")).toBeNull(); // a dry run needs nothing
    expect(applyRefusal(args(["--apply"]), "c")).toMatch(/--base/);
    expect(applyRefusal(args(["--apply", "--base", "http://evil.example"]), "c")).toMatch(/https/);
    expect(applyRefusal(args(["--apply", "--base", "https://shop.example"]), "")).toMatch(/RMP_ADMIN_COOKIE/);
    expect(applyRefusal(args(["--apply", "--base", "https://shop.example", "--confirm", "yes"]), "c")).toMatch(new RegExp(CONFIRM_WORD));
    expect(applyRefusal(args(["--apply", "--base", "https://shop.example/", "--confirm", CONFIRM_WORD]), "c")).toBeNull();
    expect(parseArgs(["--base", "https://shop.example///"]).base).toBe("https://shop.example");
    expect(() => parseArgs(["--csv"])).toThrow(/needs a value/);
  });
});
