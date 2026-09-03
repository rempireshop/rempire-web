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
