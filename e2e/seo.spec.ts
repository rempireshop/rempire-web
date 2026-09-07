import { expect, test } from "@playwright/test";
import { ipHeaders, PRODUCT, shopUrl } from "./fixtures";

/** Prerendered SEO surface: hreflang, JSON-LD, sitemap, robots. Desktop only,
 *  single run — see docs/testing.md. */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "seo spec — desktop project only, see docs/testing.md");
});
test.use({ extraHTTPHeaders: ipHeaders(110) });

test("a prerendered product page carries the full hreflang cluster and a Product JSON-LD block", async ({ page, request }) => {
  const url = shopUrl("/et", `/p/${PRODUCT.id}/`);
  const res = await page.goto(url);
  expect(res?.status()).toBe(200);

  // tools/prerender-shop2.mjs headLinks(): 3 languages (ru/et/en) + x-default.
  const alt = page.locator('link[rel="alternate"][hreflang]');
  await expect(alt).toHaveCount(4);
  const tags = await alt.evaluateAll((els) => els.map((e) => e.getAttribute("hreflang")));
  expect(new Set(tags)).toEqual(new Set(["ru", "et", "en", "x-default"]));
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);

  // At least one <script type="application/ld+json"> block is a schema.org
  // Product with an offers block (tools/prerender-shop2.mjs headBlock()).
  const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(scripts.length).toBeGreaterThan(0);
  const products = scripts
    .map((raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })
    .filter((o): o is Record<string, unknown> => !!o && o["@type"] === "Product");
  expect(products.length).toBeGreaterThan(0);
  expect(products[0]).toHaveProperty("offers");
  expect((products[0] as { brand?: { name?: string } }).brand?.name).toBe(PRODUCT.brand);

  // Static files written by the same tool.
  for (const path of ["/sitemap.xml", "/robots.txt"]) {
    const r = await request.get(path);
    expect(r.status(), path).toBe(200);
  }
});

/* ---------- the Shopify addresses Google still holds ----------------------
 *
 * src/middleware.ts + src/lib/legacy-redirects.ts. The rules themselves are
 * pinned by tests/legacy-redirects.test.ts against all 1 639 rows of
 * docs/redirect-map.csv; what is worth proving through a real server is the
 * part unit tests cannot see — that the middleware is reached at all, that the
 * chain ends on 200 rather than on the shop's 404, and that the page it ends
 * on is the right one in the right language.
 *
 * Every URL here is copied out of the Search Console export of 07.09.2026
 * (docs/audit/2026-09-07-seo.md), with its impressions in the comment. */
const LEGACY: Array<[string, string, string]> = [
  // old URL,                                             final path,                                    what it proves
  ["/products/system-4-bio-botanical-shampoo", "/shop2/p/system-4-bio-botanical-shampoo/", "90 imp, 5 clicks — the best-earning product page"],
  ["/ru/products/system-4-bio-botanical-serum", "/shop2/p/system-4-bio-botanical-serum/", "77 imp, 5 clicks — /ru keeps Russian, unprefixed"],
  ["/et/products/hair-resort-spray", "/shop2/et/p/hair-resort-spray/", "6 imp, 1 click — /et stays Estonian"],
  ["/en-lv/products/xerjoff-1861-naxos-eau-de-parfum-100ml", "/shop2/en/p/xerjoff-1861-naxos-eau-de-parfum-100ml/", "26 imp — the three en-* storefronts collapse onto /en"],
  ["/collections/system-4", "/shop2/b/system-4/", "106 imp, 2 clicks — a collection that is a brand"],
  ["/et/collections/habemeolid", "/shop2/et/c/beard/", "28 imp — an Estonian collection that is a section"],
  ["/policies/shipping-policy", "/shop2/info/shipping/", "6 imp — Shopify's own policy page"],
  ["/et/pages/contact", "/shop2/et/info/contact/", "8 imp"],
  ["/blogs/blog", "/shop2/blog/", "6 imp — the old blog"],
  ["/et", "/shop2/et/", "52 imp, 2 clicks — a bare storefront prefix"],
  ["/products/blow-dry-ever-thicken", "/shop2/p/blow-dry-ever-smooth/", "10 imp, 1 click — a product that is gone, its line is not"],
  ["/products/captain-fawcett-barberism%C2%AE-beard-oil", "/shop2/p/captain-fawcett-barberism-beard-oil/", "a handle Shopify percent-escaped"],
];

test.describe("the old Shopify URLs", () => {
  for (const [from, want, why] of LEGACY) {
    test(`${from} lands on ${want} (${why})`, async ({ request }) => {
      const res = await request.get(from);
      expect(res.status(), from).toBe(200);
      expect(new URL(res.url()).pathname, from).toBe(want);
    });
  }

  test("Shopify's product-feed query is dropped, not carried into a second address", async ({ request }) => {
    /* 121 of the 473 ranking URLs carry ?variant=…&country=AE&currency=EUR&
       utm_*=…sag_organic, and 61 paths are indexed under more than one address
       because of it. Both forms have to end on the one page. */
    const feed = "?variant=48667959099731&country=AE&currency=EUR&utm_medium=product_sync&utm_source=google&utm_content=sag_organic&utm_campaign=sag_organic";
    const plain = await request.get("/products/gatsby-moving-rubber-hair-wax-80g");
    const noisy = await request.get("/products/gatsby-moving-rubber-hair-wax-80g" + feed);
    expect(plain.status()).toBe(200);
    expect(noisy.status()).toBe(200);
    expect(new URL(noisy.url()).pathname).toBe("/shop2/p/gatsby-moving-rubber-hair-wax-80g/");
    expect(new URL(noisy.url()).search).toBe("");
    expect(noisy.url()).toBe(plain.url());
  });

  test("the redirect itself is a 301 and says which rule fired", async ({ request }) => {
    /* Not followed: the status and the header are the contract with Google.
       Note the trailing slash — `trailingSlash: true` 308s the bare form to it
       before any middleware runs, which is how every /shop/… legacy redirect
       in next.config.ts has always behaved. */
    const res = await request.get("/products/night-rider/", { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers().location).toContain("/shop2/p/night-rider/");
    expect(res.headers()["x-rempire-redirect"]).toBe("product");
  });

  test("a handle nobody has ever heard of lands on the catalogue, not on «Страница не найдена»", async ({ request }) => {
    const res = await request.get("/products/montblanc-explorer-shower-gel-150ml");
    expect(res.status()).toBe(200);
    expect(new URL(res.url()).pathname).toBe("/shop2/c/all/");
    const res2 = await request.get("/collections/a-collection-nobody-remembers");
    expect(res2.status()).toBe(200);
    expect(new URL(res2.url()).pathname).toBe("/shop2/c/all/");
  });

  test("the shop's own addresses are untouched by the middleware", async ({ request }) => {
    for (const path of [`/shop2/p/${PRODUCT.id}/`, "/shop2/et/", "/shop2/c/hair/", "/sitemap.xml", "/robots.txt"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(200);
      expect(res.headers()["x-rempire-redirect"], path).toBeUndefined();
    }
  });
});
