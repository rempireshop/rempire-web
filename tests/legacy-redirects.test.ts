/**
 * src/lib/legacy-redirects.ts — every address that has to MOVE, and where to.
 *
 * Since 08.10.2026 the shop answers at Shopify's own addresses
 * (src/lib/shop-paths.mjs), so most of what Google holds is now the page
 * itself and answers 200 with no redirect at all. What this file still moves
 * is everything that is not the page: the shop's own /shop2/… scheme of the
 * weeks before, Shopify's other spellings, and a trailing slash — each with
 * ONE 301, never a chain.
 *
 * Three fixtures, all real: tools/harvest/old-urls.txt (Shopify's own
 * sitemap, 1 639 rows, harvested 02.09.2026), docs/redirect-map.csv (the same
 * URL space as it was exported) and the URLs Search Console recorded
 * impressions for (docs/audit/2026-09-07-seo.md). Pure functions, no database,
 * no network — src/middleware.ts is covered end to end by e2e/seo.spec.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { legacyTarget, slugify } from "@/lib/legacy-redirects";
import { isSubcollection, parseShopPath } from "@/lib/shop-paths.mjs";

const ROOT = path.join(__dirname, "..");
const IDS = new Set((catalogueMin as Array<{ id: string }>).map((p) => p.id));
const BRANDS = new Set((catalogueMin as Array<{ b: string }>).map((p) => slugify(p.b)));
const LEGAL = ["shipping", "returns", "terms", "privacy", "contact"];

/** Where an address ends up: itself, or the one place its 301 names. */
function resolve(address: string): { path: string; hops: number } {
  const [pathname, search] = address.split("?");
  const hit = legacyTarget(pathname, search ? "?" + search : "");
  return hit ? { path: hit.path, hops: 1 } : { path: address, hops: 0 };
}

/** The address is a page the shop serves — the right shape, and a thing that exists. */
function assertServable(target: string, from: string) {
  const [pathname, search] = target.split("?");
  expect(legacyTarget(pathname, search ? "?" + search : ""), `${from} → ${target} would move again (a chain)`).toBeNull();
  const route = parseShopPath(pathname);
  expect(route, `${from} → ${target} is not a page of the shop`).toBeTruthy();
  const rest = route!.rest;
  let ok = true;
  let m: RegExpExecArray | null;
  if ((m = /^\/p\/([^/]+)\/$/.exec(rest))) ok = IDS.has(decodeURIComponent(m[1]));
  else if ((m = /^\/b\/([^/]+)\/$/.exec(rest))) ok = BRANDS.has(m[1]);
  else if ((m = /^\/info\/([^/]+)\/$/.exec(rest))) ok = LEGAL.includes(m[1]);
  else if ((m = /^\/c\/([^/]+)\/([^/]+)\/$/.exec(rest))) ok = isSubcollection(m[1], m[2]);
  expect(ok, `${from} → ${target} names a page the shop does not have`).toBe(true);
}

/** The map, as `old path (no origin) → the row's own suggestion`. */
function mapRows(): Array<{ old: string; neu: string; kind: string }> {
  const lines = readFileSync(path.join(ROOT, "docs", "redirect-map.csv"), "utf8").trim().split(/\r?\n/);
  return lines.slice(1).map((line) => {
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') { quoted = !quoted; continue; }
      if (ch === "," && !quoted) { cells.push(cur); cur = ""; continue; }
      cur += ch;
    }
    cells.push(cur);
    return {
      old: cells[0].replace(/^https:\/\/rempireshop\.com/, "") || "/",
      neu: cells[1] || "",
      kind: cells[2] || "",
    };
  });
}

/** Shopify's own sitemap, as paths. */
function oldUrls(): string[] {
  return readFileSync(path.join(ROOT, "tools", "harvest", "old-urls.txt"), "utf8")
    .trim().split(/\r?\n/).map((u) => u.replace(/^https?:\/\/[^/]+/, "") || "/");
}

describe("the addresses that ARE the page", () => {
  it("leaves Shopify's own addresses alone — they are the shop's now", () => {
    for (const p of [
      "/", "/ru", "/et",
      "/products/system-4-bio-botanical-shampoo",
      "/ru/products/system-4-bio-botanical-serum",
      "/et/products/hair-resort-spray",
      "/collections/system-4", "/collections/hair-care", "/ru/collections/uhod-za-volosami", "/et/collections/juuksehooldus",
      "/collections/cbd-daily-haircare", "/collections/brands", "/et/collections/sets",
      "/policies/shipping-policy", "/ru/policies/refund-policy", "/pages/contact",
      "/blogs/news", "/ru/blogs/news/kak-uhazhivat",
      "/products/gift-card", "/search", "/account", "/cart", "/checkout", "/checkout/done", "/admin", "/admin/scan",
      "/products/c-abc123",
    ]) {
      expect(legacyTarget(p), p).toBeNull();
    }
  });

  it("serves a Shopify product link with its feed query as it is — the canonical folds it", () => {
    expect(legacyTarget("/products/touchable", "?variant=46826646143315&country=AE&currency=EUR&utm_source=google")).toBeNull();
    expect(legacyTarget("/products/x-not-a-product", "?variant=1")).not.toBeNull();
  });

  it("leaves the API, the assets and the sitemaps alone", () => {
    for (const p of ["/api/overrides/", "/api/payments/notify", "/sitemap.xml", "/sitemap-products.xml", "/robots.txt",
      "/favicon.ico", "/shop2/app.min.js", "/shop2/og/c-x.png", "/shop/img/a.webp", "/feed/google-en.xml"]) {
      expect(legacyTarget(p), p).toBeNull();
    }
  });
});

describe("one 301 for everything that is not the page", () => {
  it("drops a trailing slash and keeps the query", () => {
    expect(legacyTarget("/products/night-rider/", "?size=250ml")).toEqual({ path: "/products/night-rider?size=250ml", reason: "slash" });
    expect(legacyTarget("/ru/")).toEqual({ path: "/ru", reason: "slash" });
    expect(legacyTarget("/collections/system-4/")?.path).toBe("/collections/system-4");
    expect(legacyTarget("/test/")?.path).toBe("/test");
    expect(legacyTarget("/ru/nothing-here/")?.path).toBe("/ru/nothing-here");
  });

  it("moves the /shop2/ scheme to today's address in one hop, query and all", () => {
    expect(legacyTarget("/shop2/")).toEqual({ path: "/ru", reason: "shop2" });
    expect(legacyTarget("/shop2/en/p/night-rider/")?.path).toBe("/products/night-rider");
    expect(legacyTarget("/shop2/et/c/beard/")?.path).toBe("/et/collections/habemehooldus");
    expect(legacyTarget("/shop2/done/", "?n=R-100042&s=paid&t=41.90")?.path).toBe("/ru/checkout/done?n=R-100042&s=paid&t=41.90");
    expect(legacyTarget("/shop2/checkout/", "?resume=abc.def")?.path).toBe("/ru/checkout?resume=abc.def");
    expect(legacyTarget("/shop2/admin/", "?order=R-100042")?.path).toBe("/admin?order=R-100042");
    expect(legacyTarget("/shop2/scan/")?.path).toBe("/admin/scan");
    expect(legacyTarget("/shop2/info/shipping/")?.path).toBe("/ru/policies/shipping-policy");
    expect(legacyTarget("/shop2/p/x/", "?size=250ml")?.path).toBe("/ru/products/x?size=250ml");
    expect(legacyTarget("/shop/p/night-rider/")?.path).toBe("/ru/products/night-rider");
    expect(legacyTarget("/shop/c/hair")?.path).toBe("/ru/collections/uhod-za-volosami");
  });

  it("folds the English storefronts onto the unprefixed one", () => {
    for (const prefix of ["en-lv", "en-lt", "en-fi", "en"]) {
      expect(legacyTarget(`/${prefix}/products/xerjoff-1861-naxos-eau-de-parfum-100ml`)?.path)
        .toBe("/products/xerjoff-1861-naxos-eau-de-parfum-100ml");
    }
    expect(legacyTarget("/en-fi/")).toEqual({ path: "/", reason: "lang" });
    expect(legacyTarget("/en-lv/products/touchable", "?variant=1&utm_source=google")?.path).toBe("/products/touchable");
    expect(legacyTarget("/en/products/touchable", "?size=250ml")?.path).toBe("/products/touchable?size=250ml");
    expect(legacyTarget("/en-lt/search", "?q=wax&type=product")?.path).toBe("/search?q=wax");
    expect(legacyTarget("/ET/products/maxi-wash")?.path).toBe("/et/products/maxi-wash");
  });

  it("decodes a handle Shopify escaped — «barberism%C2%AE» is one product, not a 404", () => {
    expect(legacyTarget("/products/captain-fawcett-barberism%C2%AE-beard-oil")?.path)
      .toBe("/products/captain-fawcett-barberism-beard-oil");
    expect(legacyTarget("/ru/products/captain-fawcett-barberism%C2%AE-beard-oil")?.path)
      .toBe("/ru/products/captain-fawcett-barberism-beard-oil");
  });

  it("sends a discontinued product to the nearest thing the shop still sells", () => {
    expect(legacyTarget("/products/blow-dry-ever-thicken")).toEqual({ path: "/products/blow-dry-ever-smooth", reason: "product-alias" });
    expect(legacyTarget("/products/lumin-skin-something-we-never-had")).toEqual({ path: "/collections/lumin-skin", reason: "product-brand" });
    expect(legacyTarget("/ru/products/montblanc-explorer-shower-gel-150ml")).toEqual({ path: "/ru/collections/vse-tovary", reason: "product-unknown" });
    expect(legacyTarget("/et/products/delivery")).toEqual({ path: "/et/policies/shipping-policy", reason: "product-info" });
  });

  it("moves every other collection spelling to its section, in the same language", () => {
    /* a published subcollection is a page of its own since 09.10.2026
       (tests/subcollections.test.ts); every other one goes to its section */
    expect(legacyTarget("/et/collections/habemeolid")).toBeNull();
    expect(legacyTarget("/collections/korean-cosmetics")?.path).toBe("/collections/face-care");
    expect(legacyTarget("/et/collections/juuksemaskid")?.path).toBe("/et/collections/juuksehooldus");
    expect(legacyTarget("/collections/vse-tovary")?.path).toBe("/collections/all-products");
    expect(legacyTarget("/ru/collections/all")?.path).toBe("/ru/collections/vse-tovary");
    expect(legacyTarget("/ru/collections/hair-care")?.path).toBe("/ru/collections/uhod-za-volosami");
    expect(legacyTarget("/collections/top-brands")?.path).toBe("/collections/brands");
    expect(legacyTarget("/collections")?.path).toBe("/collections/all-products");
    expect(legacyTarget("/collections/cbd-daily")?.path).toBe("/collections/cbd-daily-haircare");
    expect(legacyTarget("/collections/vendors", "?q=Kevin.Murphy")?.path).toBe("/collections/kevin-murphy");
    expect(legacyTarget("/collections/hair-care/some-tag")?.path).toBe("/collections/hair-care");
    /* a handle nobody mapped may be a brand of the owner's own products — the
       catch-all route asks the database (src/lib/notfound-page.ts) */
    expect(legacyTarget("/collections/a-collection-nobody-remembers")).toBeNull();
  });

  it("reads Shopify's other product URL, /collections/<x>/products/<handle>", () => {
    expect(legacyTarget("/collections/system-4/products/system-4-bio-botanical-shampoo")?.path)
      .toBe("/products/system-4-bio-botanical-shampoo");
    expect(legacyTarget("/et/collections/kevin-murphy/products/night-rider")?.path).toBe("/et/products/night-rider");
  });

  it("maps the other policy and page spellings onto the five pages", () => {
    expect(legacyTarget("/pages/right-to-return")?.path).toBe("/policies/refund-policy");
    expect(legacyTarget("/ru/pages/data-sharing-opt-out")?.path).toBe("/ru/policies/privacy-policy");
    expect(legacyTarget("/policies/contact-information")?.path).toBe("/pages/contact");
    expect(legacyTarget("/en-lv/policies/legal-notice")?.path).toBe("/policies/terms-of-service");
    expect(legacyTarget("/pages/something-else")).toEqual({ path: "/pages/contact", reason: "info-unknown" });
  });

  it("sends the old blog and its articles to the blog", () => {
    expect(legacyTarget("/blogs/blog")?.path).toBe("/blogs/news");
    expect(legacyTarget("/et/blogs/news/the-ultimate-guide-on-how-to-moisturize-your-skin-for-a-healthy-glow")?.path)
      .toBe("/et/blogs/news");
  });

  it("answers Shopify's other doors", () => {
    expect(legacyTarget("/account/login")?.path).toBe("/account");
    expect(legacyTarget("/checkouts/cn/abc")?.path).toBe("/account");
    expect(legacyTarget("/62123456789/orders/abc123")?.path).toBe("/account");
    expect(legacyTarget("/62123456789/checkouts/abc/recover")?.path).toBe("/account");
    expect(legacyTarget("/discount/WELCOME10", "?redirect=/collections/shampoo")?.path).toBe("/collections/shampoo");
    expect(legacyTarget("/discount/WELCOME10", "?redirect=/collections/hair-mask")?.path).toBe("/collections/hair-care");
    expect(legacyTarget("/discount/WELCOME10", "?redirect=/products/night-rider")?.path).toBe("/products/night-rider");
    expect(legacyTarget("/discount/WELCOME10", "?redirect=https://evil.example/")?.path).toBe("/");
    expect(legacyTarget("/ru/discount/X")?.path).toBe("/ru");
    expect(legacyTarget("/gift_cards/abc")?.path).toBe("/products/gift-card");
    expect(legacyTarget("/password")?.path).toBe("/");
    expect(legacyTarget("/cart/add")?.path).toBe("/cart");
    expect(legacyTarget("/apps/reviews")?.path).toBe("/");
    expect(legacyTarget("/sitemap_products_1.xml", "?from=1&to=2")?.path).toBe("/sitemap.xml");
    expect(legacyTarget("/agents.md")?.path).toBe("/");
  });

  it("keeps the shopper's own words on a Shopify search and drops everything else", () => {
    expect(legacyTarget("/search", "?q=gatsby%20wax")).toBeNull();
    expect(legacyTarget("/en-fi/search", "?q=vaha&type=product")?.path).toBe("/search?q=vaha");
  });
});

describe("tools/harvest/old-urls.txt — Shopify's whole sitemap", () => {
  const rows = oldUrls();
  it("has the 1 639 rows", () => {
    expect(rows.length).toBe(1639);
  });
  it("lands every row on a page the shop serves: directly, or in ONE 301", () => {
    let direct = 0;
    let oneHop = 0;
    for (const row of rows) {
      const { path: to, hops } = resolve(row);
      if (hops) oneHop++;
      else direct++;
      if (to === "/sitemap.xml") continue;
      /* a blog article is the one shape whose existence only the database
         knows; the old ones are redirected by name, the live ones answered */
      assertServable(to, row);
    }
    /* Shopify's own addresses — the products, the sections in their own
       language's spelling, the brands, the three homes — answer directly. */
    expect(direct).toBeGreaterThan(600);
    expect(direct + oneHop).toBe(1639);
  });
  it("never sends a language-prefixed URL to another language", () => {
    for (const row of rows) {
      const { path: to } = resolve(row);
      const want = /^\/et(\/|$)/.test(row) ? "ET" : /^\/ru(\/|$)/.test(row) ? "RU" : "EN";
      const got = parseShopPath(to.split("?")[0]);
      if (!got) continue;
      if (got.rest === "/admin/" || got.rest === "/scan/") continue;
      expect(got.lang, row + " → " + to).toBe(want);
    }
  });
});

describe("docs/redirect-map.csv — all 1 639 rows", () => {
  const rows = mapRows();
  it("has the rows the audit counted", () => {
    expect(rows.length).toBe(1639);
  });
  it("resolves every row to a page the shop serves, in at most one hop", () => {
    for (const row of rows) {
      const { path: to } = resolve(row.old);
      if (to === "/sitemap.xml") continue;
      assertServable(to, row.old);
    }
  });
  it("lands nine in ten of the rows the map gave up on (every /ru/ and /et/ product) on the product's own page", () => {
    const gaveUp = rows.filter((r) => r.neu === "/shop/" && /\/products\/[^/]+$/.test(r.old));
    expect(gaveUp.length).toBeGreaterThan(600);
    let real = 0;
    for (const row of gaveUp) if (/^\/p\//.test(parseShopPath(resolve(row.old).path)?.rest ?? "")) real++;
    expect(real / gaveUp.length).toBeGreaterThan(0.9);
  });
});

describe("the URLs Search Console has impressions for", () => {
  /* The addresses that carried the most impressions in 29.08–05.09.2026,
     verbatim from the export, query strings and all. Every one of them has to
     land on a real page — these are the rankings the switch puts at risk. */
  const RANKING: Array<[string, string]> = [
    ["/products/gatsby-moving-rubber-hair-wax-80g?variant=48667959099731&country=AE&currency=EUR&utm_medium=product_sync&utm_source=google",
      "/products/gatsby-moving-rubber-hair-wax-80g?variant=48667959099731&country=AE&currency=EUR&utm_medium=product_sync&utm_source=google"],
    ["/products/gatsby-moving-rubber-grunge-mat-grey-hair-wax", "/products/gatsby-moving-rubber-grunge-mat-grey-hair-wax"],
    ["/products/system-4-bio-botanical-shampoo", "/products/system-4-bio-botanical-shampoo"],
    ["/ru/products/system-4-bio-botanical-serum", "/ru/products/system-4-bio-botanical-serum"],
    ["/collections/system-4", "/collections/system-4"],
    ["/collections/lumin-skin", "/collections/lumin-skin"],
    // its own page again since 09.10.2026 — 66 impressions at 50 (SEO audit §6.2)
    ["/et/collections/habemeolid", "/et/collections/habemeolid"],
    ["/et", "/et"],
    ["/ru", "/ru"],
    ["/", "/"],
    ["/et/products/hair-resort-spray", "/et/products/hair-resort-spray"],
    ["/en-lv/products/xerjoff-1861-naxos-eau-de-parfum-100ml", "/products/xerjoff-1861-naxos-eau-de-parfum-100ml"],
    ["/policies/shipping-policy", "/policies/shipping-policy"],
    ["/et/pages/contact", "/et/pages/contact"],
    ["/blogs/blog", "/blogs/news"],
  ];
  it.each(RANKING)("%s → %s", (from, want) => {
    expect(resolve(from).path).toBe(want);
  });
});
