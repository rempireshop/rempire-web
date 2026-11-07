/**
 * The sets the BUILD writes pages for — tools/lib/bundles-export.mjs.
 *
 * Until 07.11.2026 the prerender wrote /sets/ and /set/<id>/ out of the
 * generated public/shop/bundles.js and took only the price from the table:
 * on the live shop 30 of Renat's 37 sets had no static page or sitemap row,
 * and the 7 the file knew were described with their September parts at their
 * November price. setsFromRows() reads the whole set from the table instead
 * and expands it against the build's catalogue.
 *
 * Two halves: what setsFromRows() does with a row, on a small catalogue of
 * its own; and that, on a real Postgres (PGlite), it lands on the same
 * numbers GET /api/bundles/ hands the shop — listBundles() in
 * src/lib/bundles.ts — set for set, part for part, with the owner's price
 * overrides, ladders and «Показывать в магазине» in play.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variants from "@/data/catalogue.variants.json";
import { query } from "@/lib/db";
import { listBundles, upsertBundle, validateBundle, type Bundle } from "@/lib/bundles";
import { upsertOverride } from "@/lib/orders";
import { loadCatalogue } from "../tools/build-bundles.mjs";
import { setPartPrice, setsFromRows } from "../tools/lib/bundles-export.mjs";
import { overrideRow } from "../tools/lib/overrides-export.mjs";
import { setupDb, teardownDb } from "./helpers";

/* ---------- setsFromRows(), on a catalogue of its own ---------------------- */

const CAT = [
  { id: "oil", brand: "Proraso", name: "Beard Oil", price: 15, img: "/shop/img/oil.webp", stock: "in" },
  {
    id: "wash", brand: "System 4", name: "Shampoo", price: 9, prices: [9, 16, 25],
    sizes: ["75 мл", "250 мл", "500 мл"], img: "/shop/img/wash.webp", stock: "in",
  },
  { id: "balm", brand: "Captain Fawcett", name: "Beard Balm", price: 24, img: "/shop/img/balm.webp", stock: "low" },
  { id: "wax", brand: "Captain Fawcett", name: "Wax", price: 17, img: "/shop/img/wax.webp", stock: "in" },
];

/** A `bundles` row the way `pg` returns one: numerics as strings, jsonb parsed. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: "beard",
    cat: "beard",
    name_ru: "Борода", name_et: "Habe", name_en: "Beard",
    desc_ru: "Масло и бальзам.", desc_et: "Õli ja palsam.", desc_en: "Oil and balm.",
    items: [{ productId: "oil", variant: 0, qty: 1 }, { productId: "balm", variant: 0, qty: 1 }],
    price: "36.66", discount_pct: null, image: null, active: true, sort: 10,
    created_at: new Date("2026-11-06T19:50:00Z"), updated_at: new Date("2026-11-06T19:55:00Z"),
    ...over,
  };
}

describe("setsFromRows — the sets the build writes pages for", () => {
  it("answers nothing for no rows; the prerender falls back to the file only when the database was never asked", () => {
    expect(setsFromRows(null, CAT)).toEqual([]);
    expect(setsFromRows([], CAT)).toEqual([]);
    const tool = readFileSync(new URL("../tools/prerender-shop2.mjs", import.meta.url), "utf8");
    expect(tool).toContain("const BUNDLE_ROWS = await fetchBundleRows();");
    expect(tool).toContain("setsFromRows(BUNDLE_ROWS, CATALOGUE, PRODUCT_OVERRIDES)");
    expect(tool).not.toContain("applyBundlePrices(");
  });

  it("writes every set on sale — not only the ones the generated file knows — in the panel's order", () => {
    const out = setsFromRows(
      [
        row({ id: "mix-shave", sort: 20 }),
        row({ id: "off", sort: 1, active: false }),
        row({ id: "b-second", sort: 10 }),
        row({ id: "a-first", sort: 10 }),
      ],
      CAT,
    );
    expect(out.map((b: { id: string }) => b.id)).toEqual(["a-first", "b-second", "mix-shave"]);
  });

  it("takes the names, texts and parts from the row, and each part's name, photo and price from the catalogue", () => {
    const [b] = setsFromRows([row()], CAT);
    expect(b.title).toEqual({ RU: "Борода", ET: "Habe", EN: "Beard" });
    expect(b.desc.RU).toBe("Масло и бальзам.");
    expect(b.cat).toBe("beard");
    expect(b.items).toEqual([
      { id: "oil", size: 0, qty: 1, brand: "Proraso", name: "Beard Oil", sizeLabel: "", price: 15, img: "/shop/img/oil.webp", stock: "in" },
      { id: "balm", size: 0, qty: 1, brand: "Captain Fawcett", name: "Beard Balm", sizeLabel: "", price: 24, img: "/shop/img/balm.webp", stock: "low" },
    ]);
    expect(b).toMatchObject({ sum: 39, price: 36.66, save: 2.34, pct: 6, stock: "low" });
    expect(b.images).toEqual(["/shop/img/oil.webp", "/shop/img/balm.webp"]);
  });

  it("prices a part at the volume the set names, and counts every unit of it", () => {
    const [b] = setsFromRows(
      [row({ items: [{ productId: "wash", variant: 1, qty: 2 }, { productId: "oil", variant: 0, qty: 1 }], price: null, discount_pct: "10" })],
      CAT,
    );
    expect(b.items[0]).toMatchObject({ id: "wash", size: 1, qty: 2, sizeLabel: "250 мл", price: 16 });
    expect(b.sum).toBe(47); // 2 × 16 + 15
    expect(b.price).toBe(42.3); // the row stores a percent, not a price
    expect(b).toMatchObject({ save: 4.7, pct: 10 });
  });

  it("sells a set with neither a price nor a percent at what its parts cost", () => {
    const [b] = setsFromRows([row({ price: null, discount_pct: null })], CAT);
    expect(b).toMatchObject({ sum: 39, price: 39, save: 0, pct: 0 });
  });

  it("reads the owner's price on the base volume and moves the others by the same premium", () => {
    expect(setPartPrice(CAT[1], 1, { price: 10, sizes: null })).toEqual({ label: "250 мл", price: 17 });
    expect(setPartPrice(CAT[1], 0, { price: 10, sizes: null })).toEqual({ label: "75 мл", price: 10 });
    expect(setPartPrice(CAT[1], 1, undefined)).toEqual({ label: "250 мл", price: 16 });
  });

  it("lets the owner's own ladder decide both the volume and its price", () => {
    const own = { price: 10, sizes: [{ size: "75 мл", price: 10 }, { size: "1 л", price: 60 }] };
    expect(setPartPrice(CAT[1], 1, own)).toEqual({ label: "1 л", price: 60 });
    // a volume the ladder no longer has reads as its first one, as on the server
    expect(setPartPrice(CAT[1], 2, own)).toEqual({ label: "75 мл", price: 10 });
  });

  it("marks a set «нет в наличии» when one of its parts is switched off in the shop", () => {
    const [b] = setsFromRows([row()], CAT, { oil: overrideRow({ hidden: true }) });
    expect(b.items[0].stock).toBe("out");
    expect(b.stock).toBe("out");
    const [c] = setsFromRows([row()], CAT, { balm: overrideRow({ stock: "in" }) });
    expect(c.stock).toBe("in");
  });

  it("shows the photo the owner chose — a product or an address — before the parts' own", () => {
    expect(setsFromRows([row({ image: "wax" })], CAT)[0].images).toEqual(["/shop/img/wax.webp"]);
    expect(setsFromRows([row({ image: "https://cdn.example.com/set.jpg" })], CAT)[0].images).toEqual(["https://cdn.example.com/set.jpg"]);
    const four = [{ productId: "oil" }, { productId: "balm" }, { productId: "wax" }, { productId: "wash" }];
    expect(setsFromRows([row({ items: four, price: "50" })], CAT)[0].images).toEqual([
      "/shop/img/oil.webp", "/shop/img/balm.webp", "/shop/img/wax.webp",
    ]);
  });

  it("leaves a missing translation empty, for the page to fall back to Russian", () => {
    const [b] = setsFromRows([row({ name_et: null, name_en: "", desc_en: null })], CAT);
    expect(b.title).toEqual({ RU: "Борода", ET: "", EN: "" });
    expect(b.desc.EN).toBe("");
  });

  it("reads parts stored as text, and writes no page for a row with none", () => {
    const text = JSON.stringify([{ productId: "oil", variant: 0, qty: 1 }, { productId: "wax", variant: 0, qty: 1 }]);
    expect(setsFromRows([row({ items: text, price: "30" })], CAT)[0].items.map((i: { id: string }) => i.id)).toEqual(["oil", "wax"]);
    expect(setsFromRows([row({ items: [] }), row({ id: "broken", items: "not json" })], CAT)).toEqual([]);
  });
});

/* ---------- …and on a real Postgres, the same numbers the shop gets -------- */

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const MIN = catalogueMin as Min[];
const VARIANTS = variants as Record<string, { sizes: string[]; prices: number[] }>;
const plain = MIN.filter((p) => p.s === "in" && !VARIANTS[p.id]);
const [A, B, C] = plain;
const SIZED = MIN.find((p) => p.s === "in" && (VARIANTS[p.id]?.sizes.length ?? 0) > 2)!;

function stored(over: Record<string, unknown>) {
  const check = validateBundle({
    cat: "beard",
    title: { RU: "Тест", ET: "Test", EN: "Test" },
    desc: { RU: "Тест.", ET: "", EN: "" },
    active: true,
    sort: 900,
    ...over,
  });
  if (!check.ok) throw new Error("fixture is invalid: " + check.error);
  return upsertBundle(check.value);
}

/** What a page is written from — every field the /set/ page, its Offer and the /sets/ grid read. */
const view = (b: Bundle | Record<string, any>) => ({
  id: b.id,
  title: b.title,
  desc: b.desc,
  sum: b.sum,
  price: b.price,
  save: b.save,
  pct: b.pct,
  stock: b.stock,
  items: b.items.map((it: Record<string, unknown>) => ({
    id: it.id, size: it.size, qty: it.qty, brand: it.brand, name: it.name,
    sizeLabel: it.sizeLabel, price: it.price, stock: it.stock,
  })),
});

async function buildSees() {
  const rows = await query<Record<string, unknown>>("select * from bundles");
  const ov = await query<Record<string, unknown>>("select * from product_overrides");
  const overrides = Object.fromEntries(ov.map((r) => [r.product_id as string, overrideRow(r)]));
  return setsFromRows(rows, loadCatalogue(), overrides).map(view);
}

describe("the build and GET /api/bundles/ describe every set the same way", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    await query("delete from bundles where id like 'test-%'");
    await query("delete from product_overrides where product_id = any($1)", [[A.id, B.id, C.id, SIZED.id]]);
  });

  it("for the seeded sets and for new ones: a price, a percent, a volume, two of a part, one switched off", async () => {
    await stored({ id: "test-plain", items: [{ productId: A.id }, { productId: B.id }], price: Math.floor((A.p + B.p) * 90) / 100 });
    await stored({
      id: "test-sized", sort: 901, price: null, discountPct: 6,
      items: [{ productId: SIZED.id, variant: 1, qty: 2 }, { productId: C.id }],
    });
    await stored({ id: "test-off", sort: 902, active: false, items: [{ productId: A.id }, { productId: C.id }], price: null, discountPct: 5 });

    const api = (await listBundles({ activeOnly: true })).map(view);
    expect(api.map((b) => b.id)).toContain("test-sized");
    expect(api.map((b) => b.id)).not.toContain("test-off");
    expect(await buildSees()).toEqual(api);
  });

  it("with the owner's price, his own ladder and «Показывать в магазине» off on the parts", async () => {
    await stored({
      id: "test-owner", price: null, discountPct: 10,
      items: [{ productId: A.id }, { productId: SIZED.id, variant: 1 }, { productId: B.id }],
    });
    await upsertOverride(A.id, { price: A.p + 3 });
    await upsertOverride(SIZED.id, { sizes: [{ size: VARIANTS[SIZED.id].sizes[0], price: 4.5 }, { size: "1 л", price: 61.2 }] });
    await upsertOverride(B.id, { hidden: true });

    const api = (await listBundles({ activeOnly: true })).map(view);
    const owner = api.find((b) => b.id === "test-owner")!;
    expect(owner.items[0].price).toBe(Math.round((A.p + 3) * 100) / 100);
    expect(owner.items[1]).toMatchObject({ sizeLabel: "1 л", price: 61.2 });
    expect(owner.stock).toBe("out");
    expect(await buildSees()).toEqual(api);
  });
});
