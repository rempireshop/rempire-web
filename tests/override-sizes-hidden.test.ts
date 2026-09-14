/**
 * The product editor's three controls that used to be dead — «+ Размер», «×»
 * and «Показывать в магазине» (db/migrations/147_override_sizes_hidden.sql).
 *
 * What is proven here is the half a browser cannot: that the size ladder the
 * owner saves is the ladder the shop CHARGES from (a volume the generated
 * catalogue file has never heard of included), that removing a rung really
 * removes it, and that a hidden product can no longer be bought or indexed —
 * the last of which stopped meaning "until the next deploy" on 08.09.2026,
 * see the block at the bottom of this file.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variants from "@/data/catalogue.variants.json";
import { query } from "@/lib/db";
import { cleanSizes, createOrder, getOverrides, OrderError, overrideLadder, upsertOverride } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const VARIANTS = variants as Record<string, { sizes: string[]; prices: number[] }>;

const plain = CATALOGUE.find((p) => p.s === "in" && !VARIANTS[p.id])!;
const sized = CATALOGUE.find((p) => p.s === "in" && VARIANTS[p.id])!;

const customer = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };
const ship = { method: "parcel", country: "EE" };

function order(items: Array<Record<string, unknown>>) {
  return { lang: "ru", items, customer, shipping: ship } as Parameters<typeof createOrder>[0];
}

describe("product_overrides.sizes / .hidden", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(truncateAll);

  it("has both columns", async () => {
    const cols = await query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'product_overrides'",
    );
    const names = cols.map((c) => c.column_name);
    expect(names).toContain("sizes");
    expect(names).toContain("hidden");
  });

  it("defaults to «not hidden, the catalogue's own volumes»", async () => {
    await upsertOverride(plain.id, { price: 9 });
    const o = (await getOverrides([plain.id]))[plain.id];
    expect(o.hidden).toBe(false);
    expect(o.sizes).toBeNull();
  });

  /* ---- «+ Размер» ------------------------------------------------------- */

  it("stores the whole ladder and hands the first rung's price to `price`", async () => {
    await upsertOverride(plain.id, { sizes: [{ size: "100 мл", price: 12.5 }, { size: "250 мл", price: 22 }] });
    const o = (await getOverrides([plain.id]))[plain.id];
    expect(o.sizes).toEqual([{ size: "100 мл", price: 12.5 }, { size: "250 мл", price: 22 }]);
    // everything older than migration 147 reads `price` alone — it must agree
    expect(o.price).toBe(12.5);
  });

  it("lets a shopper buy a volume the catalogue file has never heard of", async () => {
    expect(VARIANTS[plain.id]).toBeUndefined();
    await upsertOverride(plain.id, { sizes: [{ size: "100 мл", price: 12.5 }, { size: "250 мл", price: 22 }] });
    const made = await createOrder(order([{ id: plain.id, variant: "250 мл", qty: 2 }]));
    expect(made.items[0].variant).toBe("250 мл");
    expect(made.items[0].price).toBe(22);
    expect(made.items[0].sum).toBe(44);
  });

  it("prices every rung from the ladder, not from a premium over the file", async () => {
    await upsertOverride(sized.id, { sizes: [{ size: "A", price: 5 }, { size: "B", price: 6 }] });
    const made = await createOrder(order([{ id: sized.id, variant: "B", qty: 1 }]));
    expect(made.items[0].price).toBe(6);
  });

  /* ---- «×» -------------------------------------------------------------- */

  it("refuses a volume the owner removed", async () => {
    const gone = VARIANTS[sized.id].sizes[VARIANTS[sized.id].sizes.length - 1];
    await upsertOverride(sized.id, { sizes: [{ size: "только эта", price: 10 }] });
    await expect(createOrder(order([{ id: sized.id, variant: gone, qty: 1 }]))).rejects.toMatchObject({
      code: "bad_variant",
    });
  });

  it("null gives the volumes back to the catalogue file", async () => {
    await upsertOverride(sized.id, { sizes: [{ size: "только эта", price: 10 }] });
    await upsertOverride(sized.id, { sizes: null });
    expect((await getOverrides([sized.id]))[sized.id].sizes).toBeNull();
    const keep = VARIANTS[sized.id].sizes[0];
    const made = await createOrder(order([{ id: sized.id, variant: keep, qty: 1 }]));
    expect(made.items[0].variant).toBe(keep);
  });

  /* ---- «Показывать в магазине» ------------------------------------------ */

  it("refuses to sell a hidden product", async () => {
    await upsertOverride(plain.id, { hidden: true });
    await expect(createOrder(order([{ id: plain.id, qty: 1 }]))).rejects.toBeInstanceOf(OrderError);
    await expect(createOrder(order([{ id: plain.id, qty: 1 }]))).rejects.toMatchObject({ code: "out_of_stock" });
  });

  it("sells it again the moment the switch goes back on", async () => {
    await upsertOverride(plain.id, { hidden: true });
    await upsertOverride(plain.id, { hidden: false });
    const made = await createOrder(order([{ id: plain.id, qty: 1 }]));
    expect(made.items).toHaveLength(1);
  });

  it("hiding does not touch the volumes and vice versa", async () => {
    await upsertOverride(plain.id, { sizes: [{ size: "50 мл", price: 7 }, { size: "90 мл", price: 9 }] });
    await upsertOverride(plain.id, { hidden: true });
    const o = (await getOverrides([plain.id]))[plain.id];
    expect(o.hidden).toBe(true);
    expect(o.sizes).toHaveLength(2);
  });

  /* ---- the sanitiser ---------------------------------------------------- */

  it("drops rungs that are not rungs, and duplicate labels", () => {
    expect(cleanSizes([{ size: "A", price: 1 }, { size: "A", price: 2 }, { size: "B", price: "x" }, { size: "C", price: 3 }]))
      .toEqual([{ size: "A", price: 1 }, { size: "C", price: 3 }]);
    expect(cleanSizes("нет")).toBeNull();
    expect(cleanSizes([])).toBeNull();
    expect(cleanSizes(null)).toBeNull();
    expect(cleanSizes([{ size: "x", price: -1 }])).toBeNull();
  });

  it("keeps at most twelve rungs and one short line per label", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ size: `s${i}`, price: 1 }));
    expect(cleanSizes(many)).toHaveLength(12);
    expect(cleanSizes([{ size: "x".repeat(90), price: 1 }])![0].size).toHaveLength(30);
  });

  it("a single unlabelled rung is «один объём», not a ladder", () => {
    expect(overrideLadder({ sizes: [{ size: "", price: 9 }] } as never)).toBeNull();
    expect(overrideLadder({ sizes: [{ size: "100 мл", price: 9 }] } as never))
      .toEqual({ sizes: ["100 мл"], prices: [9] });
    expect(overrideLadder(null)).toBeNull();
  });
});

/* ---------- hidden without a deploy ---------------------------------------
 *
 * A catalogue product has a static page written at build and a row in the
 * static sitemap, and until 08.09.2026 both went on answering until the next
 * deploy — Dim: «if the item is hidden, it should be hidden without any
 * deploys or rebuilds». The two layers that make that true are the lookup
 * src/middleware.ts asks before the static layer is allowed to answer, and the
 * product sitemap the app serves instead of writing. Both are here; the layer
 * a unit test cannot reach — the middleware standing in front of a real static
 * file — is proven end to end in e2e/admin-products.spec.ts. */

const LIVE = "https://rempireshop.com";

describe("a hidden catalogue product, without a rebuild", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    await truncateAll();
    process.env.PUBLIC_BASE_URL = LIVE;
  });

  it("GET /api/overrides/hidden/ names exactly the ids the switch is off for", async () => {
    const { GET } = await import("@/app/api/overrides/hidden/route");
    expect(await (await GET()).json()).toEqual({ ok: true, ids: [] });

    await upsertOverride(plain.id, { hidden: true });
    await upsertOverride(sized.id, { price: 1.5 });   // an override that is not a hiding
    const res = await GET();
    expect(res.status).toBe(200);
    // never cached: every second of s-maxage is a second the hidden page is still served
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, ids: [plain.id] });

    await upsertOverride(plain.id, { hidden: false });
    expect(await (await GET()).json()).toEqual({ ok: true, ids: [] });
  });

  it("its own page answers 404 with noindex, and 200 again when the switch goes back on", async () => {
    const { productPageResponse } = await import("@/lib/product-page");
    expect((await productPageResponse(plain.id, "")).status).toBe(200);

    await upsertOverride(plain.id, { hidden: true });
    for (const seg of ["", "et", "en"]) {
      const res = await productPageResponse(plain.id, seg);
      expect(res.status, seg || "ru").toBe(404);
      expect(await res.text()).toContain('<meta name="robots" content="noindex, nofollow">');
    }

    await upsertOverride(plain.id, { hidden: false });
    expect((await productPageResponse(plain.id, "")).status).toBe(200);
  });

  it("drops out of the sitemap the app serves, and comes back", async () => {
    const { GET } = await import("@/app/sitemap-products.xml/route");
    const locs = async () => [...(await (await GET()).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

    const before = await locs();
    // every product in every language, each <url> carrying the whole cluster
    expect(before).toHaveLength(CATALOGUE.length * 3);
    expect(before).toContain(`${LIVE}/shop2/p/${plain.id}/`);
    expect(before).toContain(`${LIVE}/shop2/et/p/${plain.id}/`);

    await upsertOverride(plain.id, { hidden: true });
    const after = await locs();
    expect(after).toHaveLength((CATALOGUE.length - 1) * 3);
    expect(after.some((l) => l.includes(`/p/${plain.id}/`))).toBe(false);
    // the neighbours are untouched — hiding one product is not un-listing the shop
    expect(after).toContain(`${LIVE}/shop2/p/${sized.id}/`);

    await upsertOverride(plain.id, { hidden: false });
    expect(await locs()).toHaveLength(CATALOGUE.length * 3);
  });

  it("is a valid sitemap: xhtml namespace, four alternates per url, priority following the shelf", async () => {
    const { GET } = await import("@/app/sitemap-products.xml/route");
    const res = await GET();
    expect(res.headers.get("content-type")).toContain("application/xml");
    const xml = await res.text();
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">');
    const locs = (xml.match(/<loc>/g) || []).length;
    expect((xml.match(/<xhtml:link/g) || []).length).toBe(locs * 4);
    /* A product the owner has taken off the shelf keeps its page and its
       ranking — it just stops asking for the same crawl budget as one somebody
       can buy today. */
    const out = CATALOGUE.find((p) => p.s === "out");
    if (out) {
      const row = xml.split("<url>").find((u) => u.includes(`/shop2/p/${out.id}/<`))!;
      expect(row).toContain("<priority>0.4</priority>");
    }
    const inStock = xml.split("<url>").find((u) => u.includes(`/shop2/p/${plain.id}/<`))!;
    expect(inStock).toContain("<priority>0.7</priority>");
  });
});

/* ---------------------------------------------------------------------------
   «×» and the basket that was already sitting in localStorage.

   A cart line carries the INDEX of the rung, not its name. Take a rung off the
   ladder and every screen clamps that index quietly — sizePrice() and
   lineLabelParts() both do — so the cart looks healthy and charges the last
   rung that still exists. What went out on the order, though, was the raw
   index: variantOf() found no such rung, createOrder() threw `bad_variant`,
   and ORDER_ERRS had no sentence for it, so the shopper was told «Не
   получилось оформить заказ — попробуйте ещё раз» for ever. The basket could
   not be checked out and did not say why (audit 14.09.2026).

   Fixed at both ends: the order carries the rung the cart is showing, and
   `bad_variant` has words of its own for the cases that get past it.
--------------------------------------------------------------------------- */
const APP_JS = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

/** Cut `function <name>(…) { … }` out of app.js by brace matching. */
function slice(name: string): string {
  const start = APP_JS.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = APP_JS.indexOf("{", start); i < APP_JS.length; i++) {
    if (APP_JS[i] === "{") depth++;
    else if (APP_JS[i] === "}" && --depth === 0) return APP_JS.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

type ShopProduct = { id: string; sizes?: string[]; prices?: number[]; price?: number };

/** The three functions of the cart that touch a line's size, over one catalogue. */
function cart(catalogue: ShopProduct[]) {
  const body = `
    var CATALOGUE = CAT;
    var COLOUR_RU = {};
    function byId(id) {
      for (var i = 0; i < CATALOGUE.length; i++) if (CATALOGUE[i].id === id) return CATALOGUE[i];
      return CATALOGUE[0];
    }
    ${slice("colourRu")}
    ${slice("sizePrice")}
    ${slice("lineLabelParts")}
    ${slice("lineVariant")}
    return {
      /** what the order carries */
      posted: lineVariant,
      /** what the cart charges */
      price: function (l) { return sizePrice(byId(l.id), l.size || 0); },
      /** what the cart shows */
      label: function (l) { return lineLabelParts(l).join(" "); }
    };
  `;
  const run = new Function("CAT", body) as (c: ShopProduct[]) => {
    posted: (l: { id: string; size?: number | string | null }) => unknown;
    price: (l: { id: string; size?: number }) => number;
    label: (l: { id: string; size?: number }) => string;
  };
  return run(catalogue);
}

describe("a basket saved before a size was deleted", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(truncateAll);

  /* The ladder as the shop sees it after the owner pressed «×» on the third
     rung: two left, and a cart line still pointing at index 2. */
  const LADDER = [{ size: "75 мл", price: 10 }, { size: "250 мл", price: 16 }];
  const shelf: ShopProduct[] = [{ id: sized.id, sizes: ["75 мл", "250 мл"], prices: [10, 16] }];
  const stale = { id: sized.id, size: 2 };

  it("posts the rung the cart is showing, not the one that is gone", () => {
    const c = cart(shelf);
    // the cart already clamps: it shows and charges the last rung there is
    expect(c.label(stale)).toBe("250 мл");
    expect(c.price(stale)).toBe(16);
    // …and that is what goes out now
    expect(c.posted(stale)).toBe(1);
    expect(c.posted({ id: sized.id, size: 0 })).toBe(0); // a live index is untouched
  });

  it("checks that basket out — the whole point", async () => {
    await upsertOverride(sized.id, { sizes: LADDER });
    const c = cart(shelf);
    const made = await createOrder(order([{ id: sized.id, variant: c.posted(stale) as number, qty: 1 }]));
    // the shopper gets the volume the cart showed them, at the price it showed
    expect(made.items[0].variant).toBe("250 мл");
    expect(made.items[0].price).toBe(16);
  });

  it("…where the raw stale index is still refused, as it must be", async () => {
    await upsertOverride(sized.id, { sizes: LADDER });
    await expect(createOrder(order([{ id: sized.id, variant: 2, qty: 1 }]))).rejects.toMatchObject({
      code: "bad_variant",
    });
  });

  it("leaves a label alone — the server resolves those by name", () => {
    const c = cart(shelf);
    expect(c.posted({ id: sized.id, size: "250 мл" })).toBe("250 мл");
  });

  it("says nothing about a size for a product that has only one price", () => {
    const c = cart([{ id: "solo", prices: [9], sizes: ["100 мл"] }]);
    expect(c.posted({ id: "solo", size: 3 })).toBeNull();
  });

  /* And when one gets past all of that — a replayed payload, an override
     ladder that landed after the line was built — the shopper has to be told
     something they can act on. ORDER_ERRS is the storefront's own map. */
  it("has a sentence for bad_variant instead of the endless «попробуйте ещё раз»", () => {
    const errs = new Function(`${APP_JS.slice(APP_JS.indexOf("var ORDER_ERRS = {"), APP_JS.indexOf("function orderErrText("))}
      ${slice("orderErrText")}
      return orderErrText;`)() as (code: string) => string;
    expect(errs("bad_variant")).not.toBe(errs("something_else_entirely"));
    expect(errs("bad_variant")).toContain("размер");
  });
});
