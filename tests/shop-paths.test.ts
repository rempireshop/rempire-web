/**
 * src/lib/shop-paths.mjs — the shop's addresses since 08.10.2026, Shopify's
 * own (Dim: «the URLs need to be as they were previously») — and its ES5
 * twin in public/shop2/app.js (shopPathFor / shopRouteOf), which a script the
 * page loads without a build step has to carry for itself.
 *
 * The two must give the same answer for every address, or the canonical the
 * server writes and the one app.js rewrites on boot disagree, and a click and
 * a crawl land on two addresses for one page. So both are run over the same
 * matrix here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import {
  CAT_HANDLES,
  LANG_PREFIX,
  langFromAcceptLanguage,
  legacyShopTarget,
  modernShopHref,
  parseShopPath,
  publicPath,
  SUB_HANDLES,
} from "@/lib/shop-paths.mjs";
import { slugify } from "@/lib/legacy-redirects";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8").replace(/\r\n/g, "\n");

/** The address functions of app.js, run on their own. */
function appPaths(): {
  shopPathFor: (lang: string, rest: string) => string;
  shopRouteOf: (p: string) => { lang: string; prefixed: boolean; rest: string } | null;
  langFromPath: (p: string) => string;
  stripLangPrefix: (p: string) => string;
} {
  const from = src.indexOf("  var LANG_OF_SEG = ");
  const to = src.indexOf("  /** The panel and its scanner live at one address");
  expect(from, "app.js lost its address region").toBeGreaterThan(0);
  expect(to).toBeGreaterThan(from);
  const ctx: Record<string, unknown> = {};
  runInNewContext(
    src.slice(from, to) +
      "\nthis.shopPathFor = shopPathFor; this.shopRouteOf = shopRouteOf;" +
      " this.langFromPath = langFromPath; this.stripLangPrefix = stripLangPrefix;",
    ctx,
  );
  return ctx as ReturnType<typeof appPaths>;
}

const LANGS = ["EN", "RU", "ET"] as const;
const IDS = (catalogueMin as Array<{ id: string }>).map((p) => p.id);
const BRAND_SLUGS = [...new Set((catalogueMin as Array<{ b: string }>).map((p) => slugify(p.b)))];

/** Every route a page of the shop can have. */
const RESTS = [
  "/",
  ...IDS.slice(0, 40).map((id) => `/p/${id}/`),
  "/p/c-abc123/",
  ...Object.keys(CAT_HANDLES).map((c) => `/c/${c}/`),
  ...Object.keys(SUB_HANDLES).map((k) => `/c/${k}/`),
  ...BRAND_SLUGS.map((b) => `/b/${b}/`),
  "/brands/", "/sets/", "/set/beard-start/", "/gift/",
  "/info/shipping/", "/info/returns/", "/info/privacy/", "/info/terms/", "/info/contact/",
  "/blog/", "/blog/kak-uhazhivat/",
  "/search/", "/account/", "/checkout/", "/done/", "/cart/", "/admin/", "/scan/",
];

describe("publicPath — Shopify's addresses, English unprefixed", () => {
  it("spells every kind of page the way Shopify did", () => {
    expect(publicPath("EN", "/")).toBe("/");
    expect(publicPath("RU", "/")).toBe("/ru");
    expect(publicPath("ET", "/")).toBe("/et");
    expect(publicPath("EN", "/p/system-4-bio-botanical-shampoo/")).toBe("/products/system-4-bio-botanical-shampoo");
    expect(publicPath("RU", "/p/system-4-bio-botanical-shampoo/")).toBe("/ru/products/system-4-bio-botanical-shampoo");
    expect(publicPath("ET", "/p/x/")).toBe("/et/products/x");
    expect(publicPath("EN", "/c/hair/")).toBe("/collections/hair-care");
    expect(publicPath("RU", "/c/hair/")).toBe("/ru/collections/uhod-za-volosami");
    expect(publicPath("ET", "/c/hair/")).toBe("/et/collections/juuksehooldus");
    expect(publicPath("RU", "/c/all/")).toBe("/ru/collections/vse-tovary");
    expect(publicPath("EN", "/c/all/")).toBe("/collections/all-products");
    expect(publicPath("ET", "/c/all/")).toBe("/et/collections/koik-tooted");
    expect(publicPath("ET", "/b/kevin-murphy/")).toBe("/et/collections/kevin-murphy");
    expect(publicPath("EN", "/b/cbd-daily/")).toBe("/collections/cbd-daily-haircare");
    expect(publicPath("EN", "/brands/")).toBe("/collections/brands");
    expect(publicPath("RU", "/sets/")).toBe("/ru/collections/sets");
    expect(publicPath("RU", "/set/beard-start/")).toBe("/ru/collections/sets/beard-start");
    expect(publicPath("EN", "/gift/")).toBe("/products/gift-card");
    expect(publicPath("EN", "/info/shipping/")).toBe("/policies/shipping-policy");
    expect(publicPath("RU", "/info/returns/")).toBe("/ru/policies/refund-policy");
    expect(publicPath("ET", "/info/privacy/")).toBe("/et/policies/privacy-policy");
    expect(publicPath("EN", "/info/terms/")).toBe("/policies/terms-of-service");
    expect(publicPath("EN", "/info/contact/")).toBe("/pages/contact");
    expect(publicPath("EN", "/blog/")).toBe("/blogs/news");
    expect(publicPath("RU", "/blog/x/")).toBe("/ru/blogs/news/x");
    expect(publicPath("ET", "/search/?q=vaha")).toBe("/et/search?q=vaha");
    expect(publicPath("RU", "/done/?n=R-1&s=paid")).toBe("/ru/checkout/done?n=R-1&s=paid");
    expect(publicPath("EN", "/cart/")).toBe("/cart");
  });

  it("gives the owner's panel and scanner one address in every language", () => {
    for (const L of LANGS) {
      expect(publicPath(L, "/admin/")).toBe("/admin");
      expect(publicPath(L, "/admin/?order=R-100042")).toBe("/admin?order=R-100042");
      expect(publicPath(L, "/scan/")).toBe("/admin/scan");
    }
  });

  it("never ends a page address in a slash", () => {
    for (const L of LANGS) for (const r of RESTS) {
      const p = publicPath(L, r);
      expect(p === "/" || !p.endsWith("/"), `${L} ${r} → ${p}`).toBe(true);
    }
  });

  it("uses the per-language handles Shopify had, all different and none a brand", () => {
    const seen = new Set<string>();
    for (const [cat, per] of Object.entries(CAT_HANDLES)) {
      for (const L of LANGS) {
        const h = (per as Record<string, string>)[L];
        expect(BRAND_SLUGS.includes(h), `${cat} ${L}: ${h} is also a brand`).toBe(false);
        expect(["brands", "sets"].includes(h)).toBe(false);
        seen.add(L + ":" + h);
      }
    }
    expect(seen.size).toBe(Object.keys(CAT_HANDLES).length * 3);
    expect(IDS.includes("gift-card"), "a product id would shadow the gift card").toBe(false);
  });
});

describe("parseShopPath — the address back into the route", () => {
  it("round-trips every page in every language", () => {
    for (const L of LANGS) for (const r of RESTS) {
      const p = publicPath(L, r);
      const back = parseShopPath(p);
      expect(back, p).not.toBeNull();
      expect(back!.rest, p).toBe(r);
      expect(back!.canonical, p).toBe(p);
      if (r !== "/admin/" && r !== "/scan/") expect(back!.lang, p).toBe(L);
    }
  });

  it("reads a section under another language's handle as the section, with this language's canonical", () => {
    expect(parseShopPath("/et/collections/hair-care")).toMatchObject({ lang: "ET", rest: "/c/hair/", canonical: "/et/collections/juuksehooldus" });
    expect(parseShopPath("/collections/uhod-za-volosami")).toMatchObject({ lang: "EN", rest: "/c/hair/", canonical: "/collections/hair-care" });
  });

  it("knows what is not a page shape", () => {
    for (const p of ["/shop2/p/x/", "/products", "/collections/a/b/c", "/pages/right-to-return", "/blogs/blog", "/wat", "/ru/wat/now"]) {
      expect(parseShopPath(p), p).toBeNull();
    }
  });
});

describe("app.js carries the same two functions", () => {
  const app = appPaths();
  it("shopPathFor === publicPath, for every route and language", () => {
    for (const L of LANGS) for (const r of RESTS) expect(app.shopPathFor(L, r), `${L} ${r}`).toBe(publicPath(L, r));
    expect(app.shopPathFor("RU", "/search/?q=x")).toBe(publicPath("RU", "/search/?q=x"));
  });
  it("shopRouteOf === parseShopPath, for every address", () => {
    const addresses = [
      ...LANGS.flatMap((L) => RESTS.map((r) => publicPath(L, r))),
      "/et/collections/hair-care", "/collections/unknown-brand", "/shop2/p/x/", "/wat", "/ru/wat/now", "/RU/products/x",
    ];
    for (const a of addresses) {
      const want = parseShopPath(a);
      const got = app.shopRouteOf(a);
      expect(got ? { lang: got.lang, prefixed: got.prefixed, rest: got.rest } : null, a)
        .toEqual(want ? { lang: want.lang, prefixed: want.prefixed, rest: want.rest } : null);
    }
  });
  it("reads the language prefix the same way", () => {
    expect(app.langFromPath("/ru/products/x")).toBe("RU");
    expect(app.langFromPath("/et")).toBe("ET");
    expect(app.langFromPath("/products/x")).toBe("");
    expect(app.stripLangPrefix("/ru/foo/bar")).toBe("/foo/bar");
    expect(app.stripLangPrefix("/et")).toBe("/");
    expect(LANG_PREFIX).toEqual({ EN: "", RU: "/ru", ET: "/et" });
  });
});

describe("the /shop2/ addresses of 25.08–08.10.2026 → today's", () => {
  it("maps every screen, Russian unprefixed as it was", () => {
    const want: Array<[string, string]> = [
      ["/shop2/", "/ru"],
      ["/shop2", "/ru"],
      ["/shop2/en/", "/"],
      ["/shop2/et/", "/et"],
      ["/shop2/p/x/", "/ru/products/x"],
      ["/shop2/en/p/x/", "/products/x"],
      ["/shop2/et/c/hair/", "/et/collections/juuksehooldus"],
      ["/shop2/c/all/", "/ru/collections/vse-tovary"],
      ["/shop2/b/cbd-daily/", "/ru/collections/cbd-daily-haircare"],
      ["/shop2/info/returns/", "/ru/policies/refund-policy"],
      ["/shop2/en/info/contact/", "/pages/contact"],
      ["/shop2/sets/", "/ru/collections/sets"],
      ["/shop2/set/beard-start/", "/ru/collections/sets/beard-start"],
      ["/shop2/gift/", "/ru/products/gift-card"],
      ["/shop2/brands/", "/ru/collections/brands"],
      ["/shop2/blog/", "/ru/blogs/news"],
      ["/shop2/en/blog/x/", "/blogs/news/x"],
      ["/shop2/search/", "/ru/search"],
      ["/shop2/account/", "/ru/account"],
      ["/shop2/checkout/", "/ru/checkout"],
      ["/shop2/done/", "/ru/checkout/done"],
      ["/shop2/admin/", "/admin"],
      ["/shop2/et/admin/", "/admin"],
      ["/shop2/scan/", "/admin/scan"],
      ["/shop2/ru/p/x/", "/ru/products/x"],
      ["/shop", "/ru"],
      ["/shop/c/hair", "/ru/collections/uhod-za-volosami"],
      ["/shop/p/x/", "/ru/products/x"],
    ];
    for (const [from, to] of want) expect(legacyShopTarget(from), from).toBe(to);
  });

  it("never moves an asset", () => {
    for (const p of ["/shop2/app.min.js", "/shop2/styles.css", "/shop2/icons/icon-192.png", "/shop2/og/c-x.png", "/shop/img/a.webp", "/shop/catalogue2.js", "/shop2/index.html"]) {
      expect(legacyShopTarget(p), p).toBeNull();
    }
    expect(legacyShopTarget("/shopping")).toBeNull();
  });

  it("rewrites a stored link to the page it became, and leaves every other link alone", () => {
    expect(modernShopHref("/shop2/et/p/x/")).toBe("/et/products/x");
    expect(modernShopHref("/shop2/p/x/?size=250ml#a")).toBe("/ru/products/x?size=250ml#a");
    expect(modernShopHref("https://rempireshop.com/shop2/en/c/hair/")).toBe("https://rempireshop.com/collections/hair-care");
    expect(modernShopHref("https://rempireshop.diipsolutions.eu/shop2/")).toBe("https://rempireshop.diipsolutions.eu/ru");
    for (const keep of ["https://example.com/shop2/p/x/", "/products/x", "mailto:a@b.c", "/shop2/og/x.png", "#top"]) {
      expect(modernShopHref(keep), keep).toBe(keep);
    }
  });
});

describe("Accept-Language — what the edge reads for an unprefixed page", () => {
  it("takes the first of the shop's three languages, by q and then by order", () => {
    expect(langFromAcceptLanguage("ru-RU,ru;q=0.9,en;q=0.8")).toBe("RU");
    expect(langFromAcceptLanguage("en-US,en;q=0.9,ru;q=0.8")).toBe("EN");
    expect(langFromAcceptLanguage("de-DE,et;q=0.5,ru;q=0.4")).toBe("ET");
    expect(langFromAcceptLanguage("en;q=0.5,ru;q=0.9")).toBe("RU");
    expect(langFromAcceptLanguage("de-DE,fr")).toBe("");
    /* Googlebot sends none: it must be served the URL's own language */
    expect(langFromAcceptLanguage(null)).toBe("");
    expect(langFromAcceptLanguage("")).toBe("");
  });
});
