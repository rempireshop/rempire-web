/**
 * Product creation — the owner's own products
 * (db/migrations/131_custom_products.sql, src/lib/custom-products.ts).
 *
 * What is pinned: the validation names the field it refuses; the id is made
 * from brand + name and stays unique; the admin routes create, read, patch
 * and hide; the public feed carries the active rows in the catalogue's shape
 * and drops the hidden ones; the checkout prices a `c-…` id from the row
 * (sizes included) with product_overrides on top, and refuses a hidden one;
 * the assistant's create_product sanitiser agrees with the library's bounds.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { exec, query } from "@/lib/db";
import {
  baseCustomId,
  cleanCustomProductInput,
  createCustomProduct,
  CustomProductError,
  getCustomProduct,
  isCustomId,
  listCustomProducts,
  PRICE_MAX,
  PRICE_MIN,
  PRODUCT_CATS,
  setCustomProductActive,
  slugForId,
  toCatalogueProduct,
  updateCustomProduct,
} from "@/lib/custom-products";
import { getLevel, getLevels, listMoves, move, setLevel, setQty, variantTransitions } from "@/lib/inventory";
import { sanitizeAction } from "@/app/api/assistant/actions";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";

function fail(raw: unknown): CustomProductError {
  try {
    cleanCustomProductInput(raw);
  } catch (err) {
    if (err instanceof CustomProductError) return err;
    throw err;
  }
  throw new Error("expected cleanCustomProductInput to refuse " + JSON.stringify(raw));
}

describe("cleanCustomProductInput — pure validation", () => {
  const good = { brand: " Proraso ", name: "Beard Balm — бальзам для бороды", cat: "beard", price: "14,90" };

  it("keeps a well-formed single-price product, trimmed, price in cents", () => {
    const out = cleanCustomProductInput(good);
    expect(out).toMatchObject({ brand: "Proraso", name: "Beard Balm — бальзам для бороды", cat: "beard", subcat: "", sizes: [], prices: [14.9] });
    expect(out.description).toBeNull();
    expect(out.gallery).toBeNull();
    expect(out.seo).toBeNull();
  });

  it("names the field it refuses: brand, name, cat, price", () => {
    expect(fail({ ...good, brand: "  " })).toMatchObject({ code: "brand_required", field: "brand" });
    expect(fail({ ...good, name: "" })).toMatchObject({ code: "name_required", field: "name" });
    expect(fail({ ...good, cat: "sunglasses" })).toMatchObject({ code: "bad_cat", field: "cat" });
    expect(fail({ ...good, price: 0.5 })).toMatchObject({ code: "bad_price", field: "price" });
    expect(fail({ ...good, price: PRICE_MAX + 1 })).toMatchObject({ code: "bad_price", field: "price" });
    expect(fail({ ...good, price: "abc" })).toMatchObject({ code: "bad_price", field: "price" });
    expect(fail({ brand: "A", name: "B", cat: "hair" })).toMatchObject({ code: "bad_price", field: "price" });
  });

  it("sizes and prices stay aligned — one price per size, in every spelling", () => {
    expect(cleanCustomProductInput({ ...good, sizes: ["75 мл", "250 мл"], prices: [9, "16,50"] }))
      .toMatchObject({ sizes: ["75 мл", "250 мл"], prices: [9, 16.5] });
    // one price for every size
    expect(cleanCustomProductInput({ ...good, price: 9, sizes: ["75 мл", "250 мл"] }))
      .toMatchObject({ sizes: ["75 мл", "250 мл"], prices: [9, 9] });
    // the assistant's shape
    expect(cleanCustomProductInput({ brand: "A", name: "B", cat: "hair", sizes: [{ size: "75 мл", price: 9 }, { size: "250 мл", price: 16 }] }))
      .toMatchObject({ sizes: ["75 мл", "250 мл"], prices: [9, 16] });
    expect(fail({ ...good, sizes: ["75 мл", "250 мл"], prices: [9] })).toMatchObject({ code: "sizes_prices_mismatch", field: "sizes" });
    expect(fail({ ...good, sizes: ["75 мл", "250 мл"], prices: [9, 900] })).toMatchObject({ code: "bad_price", field: "sizes" });
    expect(fail({ ...good, sizes: ["75 мл", ""], prices: [9, 16] })).toMatchObject({ code: "bad_size", field: "sizes" });
    expect(fail({ ...good, sizes: ["75 мл", "75 мл"], prices: [9, 16] })).toMatchObject({ code: "sizes_duplicate", field: "sizes" });
    expect(fail({ ...good, sizes: Array.from({ length: 13 }, (_, i) => `${i} мл`), price: 9 })).toMatchObject({ code: "too_many_sizes" });
  });

  it("keeps a known subsection and drops an unknown one to «авто»", () => {
    expect(cleanCustomProductInput({ ...good, subcat: "ba" }).subcat).toBe("ba");
    expect(cleanCustomProductInput({ ...good, subcat: "zz" }).subcat).toBe("");
    expect(cleanCustomProductInput({ ...good, cat: "perfume", subcat: "ba" }).subcat).toBe("");
  });

  it("cleans the trilingual texts and the gallery through the shop's own sanitisers", () => {
    const out = cleanCustomProductInput({
      ...good,
      description: { RU: "  Текст ", FR: "non" },
      seo: { EN: { title: "Title", desc: "" } },
      gallery: [{ url: "https://media.rempireshop.com/products/x/1-a.webp", thumb: "https://media.rempireshop.com/products/x/1-a-thumb.webp", alt: "" }, { url: "javascript:alert(1)" }],
    });
    expect(out.description).toEqual({ RU: "Текст" });
    expect(out.seo).toEqual({ EN: { title: "Title" } });
    expect(out.gallery).toHaveLength(1);
  });
});

describe("ids", () => {
  it("transliterates Cyrillic and Estonian letters instead of dropping them", () => {
    expect(slugForId("Proraso Бальзам для бороды")).toBe("proraso-balzam-dlya-borody");
    expect(slugForId("Õli & Vaha  šampoon")).toBe("oli-vaha-sampoon");
    expect(baseCustomId("Proraso", "Beard Balm — бальзам")).toBe("c-proraso-beard-balm-balzam");
    expect(baseCustomId("", "")).toBe("c-tovar");
  });
  it("isCustomId knows the prefix and nothing else", () => {
    expect(isCustomId("c-proraso-beard-balm")).toBe(true);
    expect(isCustomId("touchable")).toBe(false);
    expect(isCustomId("c-")).toBe(false);
    expect(isCustomId("c-Über")).toBe(false);
  });
  it("the assistant's sanitiser and the library agree on the bounds", () => {
    const known = new Set<string>();
    const ok = sanitizeAction({ type: "create_product", brand: "Proraso", name: "Balm", cat: "beard", price: PRICE_MIN }, known, true);
    expect(ok).toMatchObject({ type: "create_product", brand: "Proraso", name: "Balm", cat: "beard", price: 1, sizes: [], prices: [1] });
    expect(sanitizeAction({ type: "create_product", brand: "Proraso", name: "Balm", cat: "beard", price: PRICE_MAX + 1 }, known, true)).toBeNull();
    for (const cat of PRODUCT_CATS) {
      expect(sanitizeAction({ type: "create_product", brand: "A", name: "B", cat, price: 10 }, known, true)).toBeTruthy();
    }
    expect(sanitizeAction({ type: "create_product", brand: "A", name: "B", cat: "all", price: 10 }, known, true)).toBeNull();
    // a shopper (non-admin) never gets to create anything
    expect(sanitizeAction({ type: "create_product", brand: "A", name: "B", cat: "hair", price: 10 }, known, false)).toBeNull();
    // sizes with their own prices, and a description in three languages
    const sized = sanitizeAction({
      type: "create_product", brand: "A", name: "B", cat: "hair",
      sizes: [{ size: "75 мл", price: 9 }, { size: "250 мл", price: "16,5" }, { size: "" }],
      description: { RU: "Ру", ET: "Ee", EN: "En", FR: "non" },
    }, known, true) as Record<string, unknown>;
    expect(sized).toMatchObject({ sizes: ["75 мл", "250 мл"], prices: [9, 16.5], price: 9, description: { RU: "Ру", ET: "Ee", EN: "En" } });
    // …and the library accepts what the sanitiser hands over, as the route will
    expect(cleanCustomProductInput(sized)).toMatchObject({ sizes: ["75 мл", "250 мл"], prices: [9, 16.5] });
  });
  it("the assistant's update_product hands over a patch updateCustomProduct() reads whole", () => {
    const known = new Set(["c-proraso-balm"]);
    const patch = sanitizeAction({
      type: "update_product", id: "c-proraso-balm", name: "Balm 2",
      sizes: [{ size: "75 мл", price: 9 }, { size: "250 мл", price: "16,5" }], description: { RU: "Ру" },
    }, known, true) as Record<string, unknown>;
    expect(patch).toEqual({ type: "update_product", id: "c-proraso-balm", name: "Balm 2", sizes: ["75 мл", "250 мл"], prices: [9, 16.5], description: { RU: "Ру" } });
    // the merged row the route validates: brand and cat come from the row, the rest from the patch
    expect(cleanCustomProductInput({ brand: "Proraso", cat: "beard", ...patch })).toMatchObject({ name: "Balm 2", sizes: ["75 мл", "250 мл"], prices: [9, 16.5], description: { RU: "Ру" } });
  });
});

/* ---------- a size renamed or removed keeps the stock straight ------------- */

describe("variantTransitions — pure", () => {
  it("a label respelled at its position is a rename; one dropped is a deletion; a swap is nothing", () => {
    expect(variantTransitions(["100 мл", "250 мл"], ["100 ml", "250 мл"])).toEqual({ renames: [["100 мл", "100 ml"]], deletes: [] });
    expect(variantTransitions(["100 мл", "250 мл"], ["100 мл"])).toEqual({ renames: [], deletes: ["250 мл"] });
    expect(variantTransitions(["100 мл", "250 мл"], ["250 мл", "100 мл"])).toEqual({ renames: [], deletes: [] });
    expect(variantTransitions(["100 мл", "250 мл"], ["100 мл", "250 мл", "500 мл"])).toEqual({ renames: [], deletes: [] });
    // a rename and a deletion at once, and a label that moved to another position is not renamed
    expect(variantTransitions(["a", "b", "c"], ["a2", "c"])).toEqual({ renames: [["a", "a2"]], deletes: ["b"] });
    expect(variantTransitions(["a", "b"], ["b", "x"])).toEqual({ renames: [], deletes: ["a"] });
  });
  it("one price ↔ sizes: the '' row follows the first size, and comes back", () => {
    expect(variantTransitions([], ["100 мл", "250 мл"])).toEqual({ renames: [["", "100 мл"]], deletes: [] });
    expect(variantTransitions(["100 мл", "250 мл"], [])).toEqual({ renames: [["100 мл", ""]], deletes: ["250 мл"] });
    expect(variantTransitions([], [])).toEqual({ renames: [], deletes: [] });
  });
});

describe("a size renamed or removed on a custom product (PGlite)", () => {
  let admin = "";
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    resetRateLimits();
    await truncateAll();
    await exec("truncate custom_products");
  });

  const BALM = { brand: "Proraso", name: "Beard Balm", cat: "beard", sizes: ["100 мл", "250 мл"], prices: [14.9, 24.9] };

  it("renaming a size at its position moves the count, the barcode and the ledger under the new label", async () => {
    const a = await createCustomProduct(BALM);
    await move({ productId: a.id, variant: "100 мл", delta: 7, reason: "goods_in", actor: "test" });
    await setLevel(a.id, "100 мл", { ean: "4006381333931", lowThreshold: 3 });
    await setQty(a.id, "250 мл", 2);

    const row = await updateCustomProduct(a.id, { sizes: ["100 ml", "250 мл"], prices: [14.9, 24.9] });
    expect(row).toMatchObject({ sizes: ["100 ml", "250 мл"], prices: [14.9, 24.9] });
    expect(await getLevel(a.id, "100 мл")).toBeNull();
    expect(await getLevel(a.id, "100 ml")).toMatchObject({ qty: 7, ean: "4006381333931", lowThreshold: 3, state: "in" });
    expect(await getLevel(a.id, "250 мл")).toMatchObject({ qty: 2 });
    // the ledger moved with it — so the size is still «tracked», with its history
    const moves = await listMoves({ productId: a.id });
    expect(moves.map((m) => [m.variant, m.delta]).sort()).toEqual([["100 ml", 7], ["250 мл", 2]]);
    const levels = await getLevels({ q: a.id });
    expect(levels.map((l) => [l.variant, l.qty, l.tracked]).sort()).toEqual([["100 ml", 7, true], ["250 мл", 2, true]]);
    // nothing stranded under the old label
    expect(await query("select variant from stock_levels where product_id = $1 order by variant", [a.id])).toEqual([{ variant: "100 ml" }, { variant: "250 мл" }]);
  });

  it("removing a size deletes its rows; a swap of two labels touches nothing", async () => {
    const a = await createCustomProduct(BALM);
    await setQty(a.id, "100 мл", 5);
    await setQty(a.id, "250 мл", 9);
    await updateCustomProduct(a.id, { sizes: ["250 мл", "100 мл"], prices: [24.9, 14.9] });
    expect(await getLevel(a.id, "100 мл")).toMatchObject({ qty: 5 });
    expect(await getLevel(a.id, "250 мл")).toMatchObject({ qty: 9 });

    await updateCustomProduct(a.id, { sizes: ["250 мл"], prices: [24.9] });
    expect(await getLevel(a.id, "100 мл")).toBeNull();
    expect(await getLevel(a.id, "250 мл")).toMatchObject({ qty: 9 });
    expect((await listMoves({ productId: a.id })).map((m) => m.variant)).toEqual(["250 мл"]);
    // …and a size added back later starts untracked, not «tracked, 0»
    await updateCustomProduct(a.id, { sizes: ["250 мл", "100 мл"], prices: [24.9, 14.9] });
    expect((await getLevels({ q: a.id })).find((l) => l.variant === "100 мл")).toMatchObject({ qty: 0, tracked: false });
  });

  it("one price ↔ sizes: the product's own count becomes the first size's, and comes back", async () => {
    const a = await createCustomProduct({ brand: "Acme", name: "Wax", cat: "styling", price: 9 });
    await setQty(a.id, "", 4);
    await updateCustomProduct(a.id, { sizes: ["50 мл", "100 мл"], prices: [9, 15] });
    expect(await getLevel(a.id, "")).toBeNull();
    expect(await getLevel(a.id, "50 мл")).toMatchObject({ qty: 4 });
    await setQty(a.id, "100 мл", 6);
    await updateCustomProduct(a.id, { price: 9 });
    expect(await getLevel(a.id, "")).toMatchObject({ qty: 4 });
    expect(await getLevel(a.id, "50 мл")).toBeNull();
    expect(await getLevel(a.id, "100 мл")).toBeNull();
  });

  it("a refused edit changes nothing — rows included; the route does the same work as the library", async () => {
    const a = await createCustomProduct(BALM);
    await setQty(a.id, "100 мл", 3);
    await expect(updateCustomProduct(a.id, { sizes: ["100 ml", "100 ml"], prices: [1, 2] })).rejects.toMatchObject({ code: "sizes_duplicate" });
    expect(await getLevel(a.id, "100 мл")).toMatchObject({ qty: 3 });

    const one = await import("@/app/api/admin/products/[id]/route");
    const res = await one.PUT(
      new Request(`${ORIGIN}/api/admin/products/${a.id}/`, {
        method: "PUT", headers: { "content-type": "application/json", cookie: admin, "x-forwarded-for": "203.0.113.78" },
        body: JSON.stringify({ sizes: ["100 ml", "250 мл"], prices: [14.9, 24.9] }),
      }),
      { params: Promise.resolve({ id: a.id }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).product.sizes).toEqual(["100 ml", "250 мл"]);
    expect(await getLevel(a.id, "100 ml")).toMatchObject({ qty: 3 });
    expect(await getLevel(a.id, "100 мл")).toBeNull();
  });
});

describe("custom products (PGlite)", () => {
  let admin = "";

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    resetRateLimits();
    await truncateAll();
    await exec("truncate custom_products");
  });

  function req(path: string, method: string, body?: unknown, cookie: string | null = admin) {
    const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "203.0.113.77" };
    if (cookie) headers.cookie = cookie;
    return new Request(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("creates with a unique id from brand + name, and the next one with the same name gets -2", async () => {
    const a = await createCustomProduct({ brand: "Proraso", name: "Beard Balm", cat: "beard", price: 14.9 });
    expect(a.id).toBe("c-proraso-beard-balm");
    expect(a.active).toBe(true);
    const b = await createCustomProduct({ brand: "Proraso", name: "Beard Balm", cat: "beard", price: 15 });
    expect(b.id).toBe("c-proraso-beard-balm-2");
    expect((await listCustomProducts()).map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("updateCustomProduct is a patch: untouched fields survive, sizes and prices stay aligned", async () => {
    const a = await createCustomProduct({ brand: "Proraso", name: "Beard Balm", cat: "beard", price: 14.9, description: { RU: "Ру" } });
    const b = await updateCustomProduct(a.id, { sizes: ["100 мл", "250 мл"], prices: [14.9, 24.9] });
    expect(b).toMatchObject({ id: a.id, brand: "Proraso", sizes: ["100 мл", "250 мл"], prices: [14.9, 24.9], description: { RU: "Ру" } });
    // a plain price again means «one size now»
    const c = await updateCustomProduct(a.id, { price: 12 });
    expect(c).toMatchObject({ sizes: [], prices: [12] });
    // a size list without prices: every size starts at the old first price
    const d = await updateCustomProduct(a.id, { sizes: ["1", "2", "3"] });
    expect(d).toMatchObject({ sizes: ["1", "2", "3"], prices: [12, 12, 12] });
    await expect(updateCustomProduct(a.id, { name: "" })).rejects.toMatchObject({ code: "name_required" });
    expect(await updateCustomProduct("c-nobody", { name: "x" })).toBeNull();
  });

  it("hide and show keep the row; the catalogue shape says what the shop reads", async () => {
    const a = await createCustomProduct({ brand: "Proraso", name: "Beard Balm", cat: "beard", sizes: ["100 мл", "250 мл"], prices: [14.9, 24.9] });
    const hidden = await setCustomProductActive(a.id, false);
    expect(hidden?.active).toBe(false);
    expect(await getCustomProduct(a.id)).toMatchObject({ active: false });
    expect((await listCustomProducts({ activeOnly: true })).length).toBe(0);
    expect((await listCustomProducts()).length).toBe(1);
    const shape = toCatalogueProduct((await setCustomProductActive(a.id, true))!);
    expect(shape).toMatchObject({
      id: a.id, brand: "Proraso", name: "Beard Balm", cat: "beard", price: 14.9,
      sizes: ["100 мл", "250 мл"], prices: [14.9, 24.9], priceFrom: true,
      img: "/brand/rempire-tower.svg", stock: "in", custom: true, active: true,
    });
    expect(shape.gallery).toBeUndefined();
  });

  it("the admin routes: POST creates, GET lists, PUT patches, DELETE hides, PUT {active:true} shows", async () => {
    const { GET, POST } = await import("@/app/api/admin/products/route");
    const one = await import("@/app/api/admin/products/[id]/route");

    // the door
    expect((await POST(req("/api/admin/products/", "POST", { brand: "A", name: "B", cat: "hair", price: 9 }, null))).status).toBe(401);
    expect((await GET(req("/api/admin/products/", "GET", undefined, null))).status).toBe(401);

    const created = await POST(req("/api/admin/products/", "POST", { brand: "Proraso", name: "Beard Balm", cat: "beard", subcat: "ba", price: "14,90" }));
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.ok).toBe(true);
    expect(body.product).toMatchObject({ id: "c-proraso-beard-balm", price: 14.9, subcat: "ba", custom: true });

    const refused = await POST(req("/api/admin/products/", "POST", { brand: "", name: "B", cat: "hair", price: 9 }));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ ok: false, error: "brand_required", field: "brand" });
    expect((await POST(req("/api/admin/products/", "POST", "[1]"))).status).toBe(400);

    const list = await (await GET(req("/api/admin/products/", "GET"))).json();
    expect(list.products.map((p: { id: string }) => p.id)).toEqual(["c-proraso-beard-balm"]);

    const patched = await one.PUT(req("/api/admin/products/c-proraso-beard-balm/", "PUT", { price: 19, description: { RU: "Ру", ET: "Ee", EN: "En" } }), ctx("c-proraso-beard-balm"));
    expect((await patched.json()).product).toMatchObject({ price: 19, description: { RU: "Ру", ET: "Ee", EN: "En" } });
    const bad = await one.PUT(req("/api/admin/products/c-proraso-beard-balm/", "PUT", { cat: "nope" }), ctx("c-proraso-beard-balm"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "bad_cat", field: "cat" });

    const gone = await one.DELETE(req("/api/admin/products/c-proraso-beard-balm/", "DELETE"), ctx("c-proraso-beard-balm"));
    expect((await gone.json()).product.active).toBe(false);
    expect((await (await one.GET(req("/api/admin/products/c-proraso-beard-balm/", "GET"), ctx("c-proraso-beard-balm"))).json()).product.active).toBe(false);
    const back = await one.PUT(req("/api/admin/products/c-proraso-beard-balm/", "PUT", { active: true }), ctx("c-proraso-beard-balm"));
    expect((await back.json()).product.active).toBe(true);

    expect((await one.GET(req("/api/admin/products/touchable/", "GET"), ctx("touchable"))).status).toBe(404);
    expect((await one.GET(req("/api/admin/products/c-nobody/", "GET"), ctx("c-nobody"))).status).toBe(404);
  });

  it("the public feed carries the active rows in the catalogue's shape and leaves the hidden ones out", async () => {
    const { GET: publicGet } = await import("@/app/api/overrides/route");
    const a = await createCustomProduct({ brand: "Proraso", name: "Beard Balm", cat: "beard", price: 14.9,
      gallery: [{ url: "https://media.rempireshop.com/products/c-x/1-a.webp", thumb: "https://media.rempireshop.com/products/c-x/1-a-thumb.webp", alt: "" }] });
    const b = await createCustomProduct({ brand: "Proraso", name: "Hidden", cat: "beard", price: 9 });
    await setCustomProductActive(b.id, false);
    const feed = await (await publicGet()).json();
    expect(feed.ok).toBe(true);
    expect(feed.custom).toHaveLength(1);
    expect(feed.custom[0]).toMatchObject({
      id: a.id, brand: "Proraso", name: "Beard Balm", cat: "beard", price: 14.9, stock: "in", custom: true,
      img: "https://media.rempireshop.com/products/c-x/1-a.webp",
      gallery: ["https://media.rempireshop.com/products/c-x/1-a.webp"],
    });
    expect(feed.custom[0].photos[0].thumb).toBe("https://media.rempireshop.com/products/c-x/1-a-thumb.webp");
  });

  it("the checkout prices a custom id from its row — sizes, an override on top — and refuses a hidden one", async () => {
    const { priceItems, upsertOverride } = await import("@/lib/orders");
    const a = await createCustomProduct({ brand: "Proraso", name: "Beard Balm", cat: "beard", sizes: ["100 мл", "250 мл"], prices: [14.9, 24.9] });
    const single = await createCustomProduct({ brand: "Proraso", name: "Oil", cat: "beard", price: 12 });

    const priced = await priceItems([{ id: a.id, variant: "250 мл", qty: 2 }, { id: single.id, qty: 1 }]);
    expect(priced.lines[0]).toMatchObject({ id: a.id, kind: "product", title: "Beard Balm", brand: "Proraso", variant: "250 мл", price: 24.9, sum: 49.8 });
    expect(priced.lines[1]).toMatchObject({ id: single.id, variant: null, price: 12 });
    expect(priced.subtotal).toBe(61.8);
    // the size by index works too, like the catalogue's
    expect((await priceItems([{ id: a.id, variant: 0, qty: 1 }])).lines[0]).toMatchObject({ variant: "100 мл", price: 14.9 });

    // product_overrides on a custom id, with nothing special-cased: the
    // override replaces the base and the bigger size keeps its premium
    await upsertOverride(a.id, { price: 10 });
    const over = await priceItems([{ id: a.id, variant: "250 мл", qty: 1 }]);
    expect(over.lines[0].price).toBe(20);
    await upsertOverride(a.id, { price: null, stock: "out" });
    await expect(priceItems([{ id: a.id, qty: 1 }])).rejects.toMatchObject({ code: "out_of_stock" });

    await setCustomProductActive(single.id, false);
    await expect(priceItems([{ id: single.id, qty: 1 }])).rejects.toMatchObject({ code: "out_of_stock" });
    await expect(priceItems([{ id: "c-never-made", qty: 1 }])).rejects.toMatchObject({ code: "unknown_item" });
  });

  it("«Склад» lists a custom product's sizes like any catalogue row", async () => {
    const { getLevels } = await import("@/lib/inventory");
    const a = await createCustomProduct({ brand: "Proraso", name: "Beard Balm", cat: "beard", sizes: ["100 мл", "250 мл"], prices: [14.9, 24.9] });
    const rows = await getLevels({ q: a.id });
    expect(rows.map((r) => r.variant).sort()).toEqual(["100 мл", "250 мл"]);
    expect(rows[0]).toMatchObject({ productId: a.id, brand: "Proraso", name: "Beard Balm", tracked: false });
  });
});
