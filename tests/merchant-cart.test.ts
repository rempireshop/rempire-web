/**
 * Merchant Center's «Checkout» link — `/cart/<item id>:<qty>` — lands in the
 * basket, with the product and the size the feed gave that id.
 *
 * Merchant Center → Business info → Checkout is Shopify's cart permalink,
 * `https://rempireshop.com/cart/{id}:1`. Until today every `/cart/…` went to
 * the catalogue (src/lib/legacy-redirects.ts): a «Buy» click on Google
 * Shopping would have dropped the shopper on «Все товары» with an empty
 * basket, the day rempireshop.com points here.
 *
 * The ids are the feed's own (src/lib/merchant-feed.ts): the product id, a
 * hashed stem for the long ones, `_<size>` for one size of several — and the
 * resolver looks them up in the same pass that hands them out (feedOffers /
 * planFeed), so this file also pins that the two agree id for id.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import shopifyTable from "@/data/shopify-variants.json";
import { isCartPermalink, parseCartPermalink, segFromAcceptLanguage } from "@/lib/cart-permalink";
import { resolveCartLink } from "@/lib/merchant-cart";
import { buildFeed, feedOffers, idStem, sizeSlug, type FeedInput } from "@/lib/merchant-feed";
import { shopifyVariant, shopifyVariantId, type ShopifyVariant } from "@/lib/shopify-variants";
import { exec, query } from "@/lib/db";
import { DEFAULT_SHIPPING_RULES } from "@/lib/shipping";
import { setupDb, teardownDb } from "./helpers";

const SHAMPOO = "system-4-bio-botanical-shampoo"; // 75/250/500 мл
const LONG = "sim-sensitive-system-4-oil-cure-scalp-treatment-o"; // 49 characters, three sizes
const GATSBY = "mandom-gatsby-moving-rubber"; // no sizes at all

/* Shopify's ids, from Merchant Center's export of its Shopify product source
   (src/data/shopify-variants.json, tools/build-shopify-variants.mjs). */
const ANGEL = "kevin-murphy-angel-wash"; // 40 / 250 мл
const ANGEL_250 = "47186649547091"; // Shopify product 8561872142675
const ANGEL_40 = "49691145797971";
const WAX = "captain-fawcett-barberism-moustache-wax"; // one size; Shopify's handle is «barberism%C2%AE-…»
const WAX_V = "47181433143635"; // Shopify product 8560400073043
const SHOPIFY = shopifyTable as Record<string, ShopifyVariant>;

const EMPTY: FeedInput = { overrides: {}, descriptions: {}, custom: [], eans: {}, rules: DEFAULT_SHIPPING_RULES };
const withOverrides = (overrides: FeedInput["overrides"]): FeedInput => ({ ...EMPTY, overrides });
/* `seg` is the language prefix — "ru", "et", or "" for English since 08.10.2026 */
const go = (path: string, input: FeedInput = EMPTY, seg = "ru") => resolveCartLink(parseCartPermalink(path)!, input, seg);

describe("the permalink's shape", () => {
  it("reads one id and its quantity, with or without the trailing slash", () => {
    expect(parseCartPermalink("/cart/mandom-gatsby-moving-rubber:1")).toEqual([{ id: GATSBY, qty: 1 }]);
    expect(parseCartPermalink(`/cart/${SHAMPOO}_250ml:3/`)).toEqual([{ id: `${SHAMPOO}_250ml`, qty: 3 }]);
  });

  it("reads several, the way Shopify's permalinks could carry them", () => {
    expect(parseCartPermalink("/cart/a:1,b_75ml:2")).toEqual([{ id: "a", qty: 1 }, { id: "b_75ml", qty: 2 }]);
  });

  it("clamps the quantity to what the basket takes — 1 to 99", () => {
    expect(parseCartPermalink("/cart/a:0")![0].qty).toBe(1);
    expect(parseCartPermalink("/cart/a:250")![0].qty).toBe(99);
  });

  it("is not every /cart address — those keep their legacy redirect", () => {
    for (const p of ["/cart", "/cart/", "/cart/abc", "/cart/:1", "/cart/abc:", "/cart/abc:x", "/cart/a:1/b", "/ru/cart/a:1", "/cart/a b:1"]) {
      expect([p, isCartPermalink(p)]).toEqual([p, false]);
    }
    expect(isCartPermalink("/cart/c-own-balm_100ml:1")).toBe(true);
  });

  it("opens the shop in the browser's language — Estonian, Russian or English", () => {
    expect(segFromAcceptLanguage("et-EE,et;q=0.9,en;q=0.8")).toBe("et");
    expect(segFromAcceptLanguage("ru-RU,ru;q=0.9")).toBe("ru");
    expect(segFromAcceptLanguage("en-GB,en;q=0.9")).toBe("");
    expect(segFromAcceptLanguage("fi-FI,fi;q=0.9,ru;q=0.5")).toBe("ru");
    expect(segFromAcceptLanguage("de-DE")).toBe("");
    expect(segFromAcceptLanguage(null)).toBe("");
  });
});

describe("an id the feed wrote → the product and the size", () => {
  it("a product with no sizes: its page, and into the basket", () => {
    expect(go(`/cart/${GATSBY}:1`)).toEqual({ path: `/ru/products/${GATSBY}?buy=1`, reason: "buy" });
  });

  it("one size of several: that size", () => {
    expect(go(`/cart/${SHAMPOO}_250ml:2`)).toEqual({ path: `/ru/products/${SHAMPOO}?size=250ml&buy=2`, reason: "buy" });
  });

  it("a long id the feed shortened to a hashed stem", () => {
    const ids = feedOffers(EMPTY).filter((o) => o.productId === LONG);
    expect(ids.length).toBe(3);
    for (const o of ids) {
      expect(o.id.startsWith(idStem(LONG, 6) + "_")).toBe(true);
      expect(o.id).not.toContain(LONG);   // it IS the shortened form
      expect(go(`/cart/${o.id}:1`)).toEqual({ path: `/ru/products/${LONG}?size=${o.slug}&buy=1`, reason: "buy" });
    }
  });

  it("in the language the browser asked for", () => {
    expect(go(`/cart/${GATSBY}:1`, EMPTY, "et").path).toBe(`/et/products/${GATSBY}?buy=1`);
    expect(go(`/cart/${GATSBY}:1`, EMPTY, "").path).toBe(`/products/${GATSBY}?buy=1`);
  });

  it("every item of today's feed comes back as its own product and size", () => {
    const offers = feedOffers(EMPTY);
    expect(offers.length).toBeGreaterThan(200);
    // a few are sold out in the catalogue file itself — those open their page and add nothing
    expect(offers.filter((o) => !o.available).length).toBeGreaterThan(0);
    for (const o of offers) {
      const query = [o.slug ? `size=${encodeURIComponent(o.slug)}` : "", o.available ? "buy=1" : ""].filter(Boolean).join("&");
      const want = `/ru/products/${encodeURIComponent(o.productId)}` + (query ? "?" + query : "");
      expect([o.id, resolveCartLink([{ id: o.id, qty: 1 }], EMPTY, "ru", offers).path]).toEqual([o.id, want]);
    }
  });

  it("the ids are the feed's own — g:id for g:id, in the same order", () => {
    const { xml } = buildFeed({ ...EMPTY, lang: "EN", base: "https://rempireshop.com" });
    const gids = [...xml.matchAll(/<g:id>([^<]*)<\/g:id>/g)].map((m) => m[1]);
    expect(feedOffers(EMPTY).map((o) => o.id)).toEqual(gids);
  });

  it("…including the owner's own ladder and a size that repeats", () => {
    const input = withOverrides({ [SHAMPOO]: { sizes: [{ size: "50 мл", price: 10 }, { size: "50 мл", price: 12 }, { size: "", price: 14 }] } as never });
    const { xml } = buildFeed({ ...input, lang: "RU", base: "https://rempireshop.com" });
    const gids = [...xml.matchAll(/<g:id>([^<]*)<\/g:id>/g)].map((m) => m[1]);
    expect(feedOffers(input).map((o) => o.id)).toEqual(gids);
    expect(go(`/cart/${SHAMPOO}_50ml-2:1`, input).path).toBe(`/ru/products/${SHAMPOO}?size=50ml-2&buy=1`);
    expect(go(`/cart/${SHAMPOO}_v3:1`, input).path).toBe(`/ru/products/${SHAMPOO}?size=v3&buy=1`);
  });

  it("carries the quantity through", () => {
    expect(go(`/cart/${GATSBY}:4`).path).toBe(`/ru/products/${GATSBY}?buy=4`);
    expect(go(`/cart/${GATSBY}:1000`).path).toBe(`/ru/products/${GATSBY}?buy=99`);
  });
});

describe("what cannot be put in the basket", () => {
  it("a sold-out product: its page, on that size, and nothing added", () => {
    const input = withOverrides({ [SHAMPOO]: { stock: "out" } as never });
    expect(go(`/cart/${SHAMPOO}_250ml:1`, input)).toEqual({ path: `/ru/products/${SHAMPOO}?size=250ml`, reason: "sold-out" });
  });

  it("one size counted to zero: that size's page; its siblings still go in", () => {
    const input = withOverrides({ [SHAMPOO]: { stockByVariant: { "250 мл": "out" } } as never });
    expect(go(`/cart/${SHAMPOO}_250ml:1`, input).reason).toBe("sold-out");
    expect(go(`/cart/${SHAMPOO}_500ml:1`, input).reason).toBe("buy");
  });

  it("a hidden product: the shop's home page, not its 404", () => {
    const input = withOverrides({ [SHAMPOO]: { hidden: true } as never });
    expect(go(`/cart/${SHAMPOO}_250ml:1`, input)).toEqual({ path: "/ru", reason: "hidden" });
    expect(go(`/cart/${GATSBY}:1`, withOverrides({ [GATSBY]: { hidden: true } as never }), "et"))
      .toEqual({ path: "/et", reason: "hidden" });
  });

  it("a size since taken off the ladder: the product's page", () => {
    expect(go(`/cart/${SHAMPOO}_999ml:1`)).toEqual({ path: `/ru/products/${SHAMPOO}`, reason: "product" });
    expect(go(`/cart/${idStem(LONG, 6)}_2l:1`)).toEqual({ path: `/ru/products/${LONG}`, reason: "product" });
  });

  it("an id nobody issued: the home page", () => {
    expect(go("/cart/no-such-thing:1")).toEqual({ path: "/ru", reason: "unknown" });
    expect(go("/cart/12345678901:1", EMPTY, "")).toEqual({ path: "/", reason: "unknown" });
    expect(go("/cart/abc-0123abcd_x:1")).toEqual({ path: "/ru", reason: "unknown" });
  });
});

describe("Shopify's ids — Merchant Center's Shopify product source, until our own feeds take over", () => {
  /* Merchant Center fills {id} of the «Checkout» link with the item's id, and
     the items of Shopify's source are `shopify_<CC>_<product>_<variant>`.
     Until 09.10.2026 every one of them landed on the home page with an empty
     basket. */
  it("reads the variant out of Shopify's item id, or a bare one", () => {
    expect(shopifyVariantId(`shopify_ZZ_8561872142675_${ANGEL_250}`)).toBe(ANGEL_250);
    expect(shopifyVariantId(`shopify_EE_8561872142675_${ANGEL_250}`)).toBe(ANGEL_250);
    expect(shopifyVariantId(ANGEL_250)).toBe(ANGEL_250);
    for (const id of ["shopify_ZZ_8561872142675", "shopify_ZZZ_1_2", "shopify_ZZ_x_2", `${SHAMPOO}_250ml`, "", "12a"]) {
      expect([id, shopifyVariantId(id)]).toEqual([id, null]);
    }
    expect(shopifyVariant("1")).toBeNull();
    expect(shopifyVariant("constructor")).toBeNull();
    expect(shopifyVariant(ANGEL_250)).toEqual({ p: ANGEL, s: "250ml" });
  });

  it("the table names only catalogue products, and only sizes today's feed sells", () => {
    const ids = new Set((catalogueMin as Array<{ id: string }>).map((p) => p.id));
    const offers = feedOffers(EMPTY);
    const entries = Object.entries(SHOPIFY);
    expect(entries.length).toBeGreaterThan(300);
    for (const [vid, v] of entries) {
      expect(/^\d+$/.test(vid), vid).toBe(true);
      expect(ids.has(v.p), `${vid} → ${v.p}`).toBe(true);
      const mine = offers.filter((o) => o.productId === v.p);
      if (v.s) expect(mine.some((o) => o.slug === v.s), `${vid} → ${v.p} ${v.s}`).toBe(true);
      /* No size: a product the shop sells in one size — every Shopify variant
         of a product sold here in several found its size in this export. */
      else expect(mine.length, `${vid} → ${v.p} has several sizes and no size of them`).toBeLessThanOrEqual(1);
    }
    expect(entries.filter(([, v]) => v.s).length).toBeGreaterThan(150);
  });

  it("a size of several: that size, into the basket — as the feed's own id would", () => {
    const own = go(`/cart/${ANGEL}_250ml:1`);
    expect(own).toEqual({ path: `/ru/products/${ANGEL}?size=250ml&buy=1`, reason: "buy" });
    expect(go(`/cart/shopify_ZZ_8561872142675_${ANGEL_250}:1`)).toEqual(own);
    expect(go(`/cart/${ANGEL_250}:1`)).toEqual(own);
    expect(go(`/cart/shopify_ZZ_8561872142675_${ANGEL_40}:2`, EMPTY, "et"))
      .toEqual({ path: `/et/products/${ANGEL}?size=40ml&buy=2`, reason: "buy" });
  });

  it("a product sold in one size: into the basket, with no size to name", () => {
    expect(go(`/cart/shopify_ZZ_8560400073043_${WAX_V}:1`, EMPTY, ""))
      .toEqual({ path: `/products/${WAX}?buy=1`, reason: "buy" });
    expect(go(`/cart/${WAX_V}:3`, EMPTY, "")).toEqual({ path: `/products/${WAX}?buy=3`, reason: "buy" });
  });

  it("every variant of the table lands on its own product, and on its size", () => {
    const offers = feedOffers(EMPTY);
    for (const [vid, v] of Object.entries(SHOPIFY)) {
      const got = resolveCartLink([{ id: `shopify_ZZ_1_${vid}`, qty: 1 }], EMPTY, "ru", offers);
      expect([vid, got.path.split("?")[0]]).toEqual([vid, `/ru/products/${encodeURIComponent(v.p)}`]);
      expect(["buy", "sold-out"]).toContain(got.reason);
      if (v.s) expect(got.path, vid).toContain(`size=${encodeURIComponent(v.s)}`);
    }
  });

  it("sold out, a size counted to zero, hidden — the same answers as our own ids", () => {
    const out = withOverrides({ [ANGEL]: { stock: "out" } as never });
    expect(go(`/cart/${ANGEL_250}:1`, out)).toEqual({ path: `/ru/products/${ANGEL}?size=250ml`, reason: "sold-out" });
    const sizeOut = withOverrides({ [ANGEL]: { stockByVariant: { "250 мл": "out" } } as never });
    expect(go(`/cart/${ANGEL_250}:1`, sizeOut).reason).toBe("sold-out");
    expect(go(`/cart/${ANGEL_40}:1`, sizeOut).reason).toBe("buy");
    const hidden = withOverrides({ [ANGEL]: { hidden: true } as never });
    expect(go(`/cart/shopify_ZZ_8561872142675_${ANGEL_250}:1`, hidden)).toEqual({ path: "/ru", reason: "hidden" });
  });

  it("a size the owner has since taken off the ladder: the product's page, to choose there", () => {
    const input = withOverrides({ [ANGEL]: { sizes: [{ size: "40 мл", price: 6 }, { size: "100 мл", price: 14 }] } as never });
    expect(go(`/cart/${ANGEL_250}:1`, input)).toEqual({ path: `/ru/products/${ANGEL}`, reason: "product" });
    expect(go(`/cart/${ANGEL_40}:1`, input).path).toBe(`/ru/products/${ANGEL}?size=40ml&buy=1`);
    /* …and a one-size product the owner has given a ladder of several */
    const wax = withOverrides({ [WAX]: { sizes: [{ size: "15 мл", price: 15 }, { size: "50 мл", price: 30 }] } as never });
    expect(go(`/cart/${WAX_V}:1`, wax)).toEqual({ path: `/ru/products/${WAX}`, reason: "product" });
  });

  it("a product the owner has cut down to the one size: that size goes in, by its label; the other is gone", () => {
    /* One rung is no group: the feed's item carries no size slug at all,
       so the variant's `250ml` is found by the label's own (sizeSlug). */
    const input = withOverrides({ [ANGEL]: { sizes: [{ size: "250 мл", price: 26 }] } as never });
    expect(feedOffers(input).filter((o) => o.productId === ANGEL).map((o) => [o.slug, o.label])).toEqual([["", "250 мл"]]);
    expect(sizeSlug("250 мл")).toBe("250ml");
    expect(go(`/cart/${ANGEL_250}:1`, input)).toEqual({ path: `/ru/products/${ANGEL}?buy=1`, reason: "buy" });
    expect(go(`/cart/${ANGEL_40}:1`, input)).toEqual({ path: `/ru/products/${ANGEL}`, reason: "product" });
  });

  it("a Shopify variant nobody mapped: the home page, as before", () => {
    expect(go("/cart/shopify_ZZ_8561872142675_1:1")).toEqual({ path: "/ru", reason: "unknown" });
    expect(go("/cart/99999999999999:1", EMPTY, "")).toEqual({ path: "/", reason: "unknown" });
  });

  it("the middleware's shape lets both through", () => {
    expect(isCartPermalink(`/cart/shopify_ZZ_8561872142675_${ANGEL_250}:1`)).toBe(true);
    expect(isCartPermalink(`/cart/${ANGEL_250}:1`)).toBe(true);
  });
});

describe("the storefront: ?buy= puts it in the basket and opens the checkout", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
  function slice(name: string): string {
    const start = src.indexOf(`function ${name}(`);
    let depth = 0;
    for (let i = src.indexOf("{", start); i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(name);
  }
  type P = { id: string; stock: string; sizes: string[] };
  function run(search: string, product: P | null, cart: Array<Record<string, unknown>> = [], sizeGone = false) {
    const S: Record<string, unknown> = { screen: "product", productId: product ? product.id : "x", size: 1, cart };
    const calls: string[] = [];
    let url = "/ru/products/x" + search;
    const loc = { get search() { return url.slice(url.indexOf("?") >= 0 ? url.indexOf("?") : url.length); }, pathname: "/ru/products/x" };
    const hist = { state: null, replaceState: (_s: unknown, _t: string, u: string) => { url = u; } };
    new Function("S", "location", "history", "byIdOrNull", "sizeOut", "CART_MAX_QTY", "persist", "cartPush", "pushCart", "track", "sizePrice", "go",
      `${slice("buyFromLink")} buyFromLink();`)(
      S, loc, hist, () => product, () => sizeGone, 99,
      () => calls.push("persist"), { off: true }, () => calls.push("pushCart"), () => calls.push("track"), () => 1,
      (s: string) => { calls.push("go:" + s); S.screen = s; },
    );
    return { S, calls, url };
  }
  const P1: P = { id: SHAMPOO, stock: "in", sizes: ["75 мл", "250 мл", "500 мл"] };

  it("adds the line at the size the page opened on, and goes to the checkout", () => {
    const out = run("?size=250ml&buy=2", P1);
    expect(out.S.cart).toEqual([{ id: SHAMPOO, size: 1, qty: 2 }]);
    expect(out.calls).toContain("go:checkout");
    expect(out.url).toBe("/ru/products/x?size=250ml");   // `buy` gone, `size` kept — a reload adds nothing
  });

  it("the same link twice is one line, not two", () => {
    const out = run("?size=250ml&buy=2", P1, [{ id: SHAMPOO, size: 1, qty: 2 }]);
    expect(out.S.cart).toEqual([{ id: SHAMPOO, size: 1, qty: 2 }]);
  });

  it("refuses a sold-out product or size, and stays on its page", () => {
    for (const [p, gone] of [[{ ...P1, stock: "out" }, false], [P1, true]] as const) {
      const out = run("?buy=1", p, [], gone);
      expect(out.S.cart).toEqual([]);
      expect(out.calls).not.toContain("go:checkout");
      expect(out.url).toBe("/ru/products/x");
    }
  });

  it("does nothing without ?buy=", () => {
    const out = run("?size=250ml", P1);
    expect(out.S.cart).toEqual([]);
    expect(out.calls).toEqual([]);
  });

  it("runs at boot, after the page's own route is known", () => {
    const boot = src.slice(src.indexOf("function firstPaint()"));
    expect(boot.indexOf("buyFromLink();")).toBeGreaterThan(boot.indexOf("routeFromPath();"));
  });
});

describe("the door: middleware and route", () => {
  beforeAll(async () => {
    await setupDb();
  });
  afterAll(async () => {
    await teardownDb();
  });
  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await exec("truncate product_overrides, custom_products restart identity cascade");
  });

  it("the middleware lets the permalink through, and still redirects every other /cart", async () => {
    const { middleware } = await import("@/middleware");
    const pass = await middleware(new NextRequest(`https://rempireshop.com/cart/${GATSBY}:1/`));
    expect(pass.headers.get("x-middleware-next")).toBe("1");
    const legacy = await middleware(new NextRequest("https://rempireshop.com/cart/"));
    expect(legacy.status).toBe(301);
    // every other /cart/… is folded into /cart, the basket (Shopify's scheme, 08.10.2026)
    expect(legacy.headers.get("location")).toBe("https://rempireshop.com/cart");
  });

  it("the route answers with a 302 to the product, never cached", async () => {
    const { GET } = await import("@/app/cart/[...path]/route");
    const res = await GET(new Request(`https://rempireshop.com/cart/${SHAMPOO}_250ml:1/`, { headers: { "accept-language": "et-EE,et" } }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://rempireshop.com/et/products/${SHAMPOO}?size=250ml&buy=1`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-rempire-cart")).toBe("buy");
  });

  it("answers Merchant Center's Shopify item id with the product, the size and the basket", async () => {
    const { middleware } = await import("@/middleware");
    const path = `/cart/shopify_ZZ_8561872142675_${ANGEL_250}:1`;
    const pass = await middleware(new NextRequest(`https://rempireshop.com${path}`));
    expect(pass.headers.get("x-middleware-next")).toBe("1");
    const { GET } = await import("@/app/cart/[...path]/route");
    const res = await GET(new Request(`https://rempireshop.com${path}`, { headers: { "accept-language": "en-GB,en" } }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://rempireshop.com/products/${ANGEL}?size=250ml&buy=1`);
    expect(res.headers.get("x-rempire-cart")).toBe("buy");
  });

  it("reads the live switches: a product hidden in the panel goes home", async () => {
    await query("insert into product_overrides (product_id, hidden) values ($1, true)", [SHAMPOO]);
    const { GET } = await import("@/app/cart/[...path]/route");
    const res = await GET(new Request(`https://rempireshop.com/cart/${SHAMPOO}_250ml:1/`, { headers: { "accept-language": "ru" } }));
    expect(res.headers.get("location")).toBe("https://rempireshop.com/ru");
    expect(res.headers.get("x-rempire-cart")).toBe("hidden");
  });
});
