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
import { isCartPermalink, parseCartPermalink, segFromAcceptLanguage } from "@/lib/cart-permalink";
import { resolveCartLink } from "@/lib/merchant-cart";
import { buildFeed, feedOffers, idStem, type FeedInput } from "@/lib/merchant-feed";
import { exec, query } from "@/lib/db";
import { DEFAULT_SHIPPING_RULES } from "@/lib/shipping";
import { setupDb, teardownDb } from "./helpers";

const SHAMPOO = "system-4-bio-botanical-shampoo"; // 75/250/500 мл
const LONG = "sim-sensitive-system-4-oil-cure-scalp-treatment-o"; // 49 characters, three sizes
const GATSBY = "mandom-gatsby-moving-rubber"; // no sizes at all

const EMPTY: FeedInput = { overrides: {}, descriptions: {}, custom: [], eans: {}, rules: DEFAULT_SHIPPING_RULES };
const withOverrides = (overrides: FeedInput["overrides"]): FeedInput => ({ ...EMPTY, overrides });
const go = (path: string, input: FeedInput = EMPTY, seg = "") => resolveCartLink(parseCartPermalink(path)!, input, seg);

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
    expect(segFromAcceptLanguage("ru-RU,ru;q=0.9")).toBe("");
    expect(segFromAcceptLanguage("en-GB,en;q=0.9")).toBe("en");
    expect(segFromAcceptLanguage("fi-FI,fi;q=0.9,ru;q=0.5")).toBe("");
    expect(segFromAcceptLanguage("de-DE")).toBe("en");
    expect(segFromAcceptLanguage(null)).toBe("en");
  });
});

describe("an id the feed wrote → the product and the size", () => {
  it("a product with no sizes: its page, and into the basket", () => {
    expect(go(`/cart/${GATSBY}:1`)).toEqual({ path: `/shop2/p/${GATSBY}/?buy=1`, reason: "buy" });
  });

  it("one size of several: that size", () => {
    expect(go(`/cart/${SHAMPOO}_250ml:2`)).toEqual({ path: `/shop2/p/${SHAMPOO}/?size=250ml&buy=2`, reason: "buy" });
  });

  it("a long id the feed shortened to a hashed stem", () => {
    const ids = feedOffers(EMPTY).filter((o) => o.productId === LONG);
    expect(ids.length).toBe(3);
    for (const o of ids) {
      expect(o.id.startsWith(idStem(LONG, 6) + "_")).toBe(true);
      expect(o.id).not.toContain(LONG);   // it IS the shortened form
      expect(go(`/cart/${o.id}:1`)).toEqual({ path: `/shop2/p/${LONG}/?size=${o.slug}&buy=1`, reason: "buy" });
    }
  });

  it("in the language the browser asked for", () => {
    expect(go(`/cart/${GATSBY}:1`, EMPTY, "et").path).toBe(`/shop2/et/p/${GATSBY}/?buy=1`);
    expect(go(`/cart/${GATSBY}:1`, EMPTY, "en").path).toBe(`/shop2/en/p/${GATSBY}/?buy=1`);
  });

  it("every item of today's feed comes back as its own product and size", () => {
    const offers = feedOffers(EMPTY);
    expect(offers.length).toBeGreaterThan(200);
    // a few are sold out in the catalogue file itself — those open their page and add nothing
    expect(offers.filter((o) => !o.available).length).toBeGreaterThan(0);
    for (const o of offers) {
      const query = [o.slug ? `size=${encodeURIComponent(o.slug)}` : "", o.available ? "buy=1" : ""].filter(Boolean).join("&");
      const want = `/shop2/p/${encodeURIComponent(o.productId)}/` + (query ? "?" + query : "");
      expect([o.id, resolveCartLink([{ id: o.id, qty: 1 }], EMPTY, "", offers).path]).toEqual([o.id, want]);
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
    expect(go(`/cart/${SHAMPOO}_50ml-2:1`, input).path).toBe(`/shop2/p/${SHAMPOO}/?size=50ml-2&buy=1`);
    expect(go(`/cart/${SHAMPOO}_v3:1`, input).path).toBe(`/shop2/p/${SHAMPOO}/?size=v3&buy=1`);
  });

  it("carries the quantity through", () => {
    expect(go(`/cart/${GATSBY}:4`).path).toBe(`/shop2/p/${GATSBY}/?buy=4`);
    expect(go(`/cart/${GATSBY}:1000`).path).toBe(`/shop2/p/${GATSBY}/?buy=99`);
  });
});

describe("what cannot be put in the basket", () => {
  it("a sold-out product: its page, on that size, and nothing added", () => {
    const input = withOverrides({ [SHAMPOO]: { stock: "out" } as never });
    expect(go(`/cart/${SHAMPOO}_250ml:1`, input)).toEqual({ path: `/shop2/p/${SHAMPOO}/?size=250ml`, reason: "sold-out" });
  });

  it("one size counted to zero: that size's page; its siblings still go in", () => {
    const input = withOverrides({ [SHAMPOO]: { stockByVariant: { "250 мл": "out" } } as never });
    expect(go(`/cart/${SHAMPOO}_250ml:1`, input).reason).toBe("sold-out");
    expect(go(`/cart/${SHAMPOO}_500ml:1`, input).reason).toBe("buy");
  });

  it("a hidden product: the shop's home page, not its 404", () => {
    const input = withOverrides({ [SHAMPOO]: { hidden: true } as never });
    expect(go(`/cart/${SHAMPOO}_250ml:1`, input)).toEqual({ path: "/shop2/", reason: "hidden" });
    expect(go(`/cart/${GATSBY}:1`, withOverrides({ [GATSBY]: { hidden: true } as never }), "et"))
      .toEqual({ path: "/shop2/et/", reason: "hidden" });
  });

  it("a size since taken off the ladder: the product's page", () => {
    expect(go(`/cart/${SHAMPOO}_999ml:1`)).toEqual({ path: `/shop2/p/${SHAMPOO}/`, reason: "product" });
    expect(go(`/cart/${idStem(LONG, 6)}_2l:1`)).toEqual({ path: `/shop2/p/${LONG}/`, reason: "product" });
  });

  it("an id nobody issued: the home page", () => {
    expect(go("/cart/no-such-thing:1")).toEqual({ path: "/shop2/", reason: "unknown" });
    expect(go("/cart/12345678901:1", EMPTY, "en")).toEqual({ path: "/shop2/en/", reason: "unknown" });
    expect(go("/cart/abc-0123abcd_x:1")).toEqual({ path: "/shop2/", reason: "unknown" });
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
    let url = "/shop2/p/x/" + search;
    const loc = { get search() { return url.slice(url.indexOf("?") >= 0 ? url.indexOf("?") : url.length); }, pathname: "/shop2/p/x/" };
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
    expect(out.url).toBe("/shop2/p/x/?size=250ml");   // `buy` gone, `size` kept — a reload adds nothing
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
      expect(out.url).toBe("/shop2/p/x/");
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
    expect(legacy.headers.get("location")).toBe("https://rempireshop.com/shop2/c/all/");
  });

  it("the route answers with a 302 to the product, never cached", async () => {
    const { GET } = await import("@/app/cart/[...path]/route");
    const res = await GET(new Request(`https://rempireshop.com/cart/${SHAMPOO}_250ml:1/`, { headers: { "accept-language": "et-EE,et" } }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://rempireshop.com/shop2/et/p/${SHAMPOO}/?size=250ml&buy=1`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-rempire-cart")).toBe("buy");
  });

  it("reads the live switches: a product hidden in the panel goes home", async () => {
    await query("insert into product_overrides (product_id, hidden) values ($1, true)", [SHAMPOO]);
    const { GET } = await import("@/app/cart/[...path]/route");
    const res = await GET(new Request(`https://rempireshop.com/cart/${SHAMPOO}_250ml:1/`, { headers: { "accept-language": "ru" } }));
    expect(res.headers.get("location")).toBe("https://rempireshop.com/shop2/");
    expect(res.headers.get("x-rempire-cart")).toBe("hidden");
  });
});
