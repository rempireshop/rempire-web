import { expect, request as apiRequest, test } from "@playwright/test";
import { E2E_BASE_URL } from "./env.mjs";
import { ipHeaders, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

/** Prerendered SEO surface: hreflang, JSON-LD, sitemap, robots — and, since
 *  08.10.2026, the addresses themselves: Shopify's (src/lib/shop-paths.mjs),
 *  English unprefixed, one 301 for everything that is not the page, and a
 *  page whose language is its address. Desktop only, single run — see
 *  docs/testing.md. */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "seo spec — desktop project only, see docs/testing.md");
});
test.use({ extraHTTPHeaders: ipHeaders(110) });

test("a prerendered product page carries the full hreflang cluster and a Product JSON-LD block", async ({ page, request }) => {
  const url = shopUrl("/et", `/p/${PRODUCT.id}/`);
  expect(url).toBe(`/et/products/${PRODUCT.id}`);
  const res = await page.goto(url);
  expect(res?.status()).toBe(200);

  // tools/prerender-shop2.mjs headLinks(): 3 languages (ru/et/en) + x-default.
  const alt = page.locator('link[rel="alternate"][hreflang]');
  await expect(alt).toHaveCount(4);
  const pairs = await alt.evaluateAll((els) => els.map((e) => [e.getAttribute("hreflang"), e.getAttribute("href")]));
  const href = Object.fromEntries(pairs);
  expect(href.ru).toBe(`${E2E_BASE_URL}/ru/products/${PRODUCT.id}`);
  expect(href.et).toBe(`${E2E_BASE_URL}/et/products/${PRODUCT.id}`);
  expect(href.en).toBe(`${E2E_BASE_URL}/products/${PRODUCT.id}`);
  expect(href["x-default"]).toBe(`${E2E_BASE_URL}/products/${PRODUCT.id}`);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${E2E_BASE_URL}/et/products/${PRODUCT.id}`);

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
  expect((products[0] as { url?: string }).url).toBe(`${E2E_BASE_URL}/et/products/${PRODUCT.id}`);

  // Static files written by the same tool.
  for (const path of ["/sitemap.xml", "/robots.txt"]) {
    const r = await request.get(path);
    expect(r.status(), path).toBe(200);
  }
});

/* ---------- the language of a page is its address -------------------------
 *
 * SEO audit, 08.10.2026: an English browser on the unprefixed (then Russian)
 * address was shown an English title, <h1> and lang="en" over a Russian
 * canonical — and Googlebot renders with an en-US locale. Since the move a
 * storefront page is in its address's language and nothing else; a browser
 * that wants another may only be SENT to the twin, by the edge, before the
 * page is served. */
test.describe("the language comes from the address, never from the browser", () => {
  test("Googlebot's view — no Accept-Language, no cookie — is the address's own language, with no redirect", async () => {
    const bot = await apiRequest.newContext({ baseURL: E2E_BASE_URL, extraHTTPHeaders: { "user-agent": "Googlebot/2.1", ...ipHeaders(111) } });
    for (const [path, lang] of [[`/products/${PRODUCT.id}`, "en"], [`/ru/products/${PRODUCT.id}`, "ru"], ["/et", "et"], ["/", "en"]] as const) {
      const res = await bot.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(200);
      const html = await res.text();
      expect(html.match(/<html lang="([^"]*)"/)?.[1], path).toBe(lang);
      /* an unprefixed page says what decided it, so no cache hands it to a visitor the edge would have sent on */
      if (!/^\/(ru|et)(\/|$)/.test(path)) expect(res.headers()["vary"] ?? "", path).toMatch(/Accept-Language/i);
    }
    await bot.dispose();
  });

  test("an en-US browser on a Russian address reads Russian — title, <h1>, lang and canonical", async ({ browser }) => {
    const ctx = await browser.newContext({ locale: "en-US", storageState: { cookies: [], origins: [] }, extraHTTPHeaders: ipHeaders(112) });
    const page = await ctx.newPage();
    await page.goto(`/ru/products/${PRODUCT.id}`);
    await waitForScreen(page, "product");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${E2E_BASE_URL}/ru/products/${PRODUCT.id}`);
    expect(await page.title()).toMatch(/[А-Яа-яЁё]/);
    expect(new URL(page.url()).pathname).toBe(`/ru/products/${PRODUCT.id}`);
    await ctx.close();
  });

  test("a ru-RU browser that chose English reads English on the unprefixed address — no re-render in its own language", async ({ browser }) => {
    const ctx = await browser.newContext({ locale: "ru-RU", extraHTTPHeaders: ipHeaders(113) });   // the suite's cookie: rempire_lang=en
    const page = await ctx.newPage();
    const res = await page.goto(`/products/${PRODUCT.id}`);
    expect(res?.status()).toBe(200);
    await waitForScreen(page, "product");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(await page.title()).not.toMatch(/[А-Яа-яЁё]/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${E2E_BASE_URL}/products/${PRODUCT.id}`);
    expect(new URL(page.url()).pathname).toBe(`/products/${PRODUCT.id}`);
    await ctx.close();
  });

  test("a browser that asks for Russian or Estonian is SENT to the twin: a 302 that varies on the header and the cookie", async () => {
    for (const [header, cookie, want] of [
      ["ru-RU,ru;q=0.9,en;q=0.8", "", `/ru/products/${PRODUCT.id}?size=250ml`],
      ["et-EE,et;q=0.9", "", `/et/products/${PRODUCT.id}?size=250ml`],
      ["en-US,en;q=0.9", "rempire_lang=ru", `/ru/products/${PRODUCT.id}?size=250ml`],
    ] as const) {
      const ctx = await apiRequest.newContext({
        baseURL: E2E_BASE_URL,
        extraHTTPHeaders: { "accept-language": header, ...(cookie ? { cookie } : {}), ...ipHeaders(114) },
      });
      const res = await ctx.get(`/products/${PRODUCT.id}?size=250ml`, { maxRedirects: 0 });
      expect(res.status(), header + " " + cookie).toBe(302);
      expect(new URL(res.headers().location, E2E_BASE_URL).pathname + new URL(res.headers().location, E2E_BASE_URL).search).toBe(want);
      expect(res.headers().vary ?? "").toMatch(/Accept-Language/i);
      expect(res.headers().vary ?? "").toMatch(/Cookie/i);
      await ctx.dispose();
    }
    /* …and one that chose English stays, whatever its browser says */
    const en = await apiRequest.newContext({ baseURL: E2E_BASE_URL, extraHTTPHeaders: { "accept-language": "ru-RU", cookie: "rempire_lang=en", ...ipHeaders(115) } });
    expect((await en.get(`/products/${PRODUCT.id}`, { maxRedirects: 0 })).status()).toBe(200);
    /* the panel has no language in its address and is never sent anywhere */
    const owner = await apiRequest.newContext({ baseURL: E2E_BASE_URL, extraHTTPHeaders: { "accept-language": "ru-RU", ...ipHeaders(116) } });
    expect((await owner.get("/admin", { maxRedirects: 0 })).status()).toBe(200);
    await en.dispose();
    await owner.dispose();
  });

  test("the canonical names the page without any query — ?size=, ?variant=, utm_…", async ({ page }) => {
    await page.goto(`/products/${PRODUCT.id}?size=250ml&variant=48667959099731&utm_source=google&country=AE`);
    await waitForScreen(page, "product");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${E2E_BASE_URL}/products/${PRODUCT.id}`);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", `${E2E_BASE_URL}/products/${PRODUCT.id}`);
  });
});

/* ---------- the addresses Google still holds -------------------------------
 *
 * src/middleware.ts + src/lib/legacy-redirects.ts. Shopify's own addresses
 * ARE the shop's now and answer 200 directly; everything else moves with ONE
 * 301. The rules are pinned by tests/legacy-redirects.test.ts against every
 * row of tools/harvest/old-urls.txt; what is worth proving through a real
 * server is that the middleware is reached at all, that the hop ends on 200
 * rather than on the shop's 404, and on the right page in the right language.
 * Every URL is copied out of the Search Console export (docs/audit/2026-09-07-seo.md). */
const SHOPIFY: Array<[string, string, number, string]> = [
  // old URL,                                             final path,                                       hops, why
  ["/products/system-4-bio-botanical-shampoo", "/products/system-4-bio-botanical-shampoo", 0, "the best-earning product page — Shopify's address IS the page"],
  ["/ru/products/system-4-bio-botanical-serum", "/ru/products/system-4-bio-botanical-serum", 0, "/ru keeps Russian"],
  ["/et/products/hair-resort-spray", "/et/products/hair-resort-spray", 0, "/et stays Estonian"],
  ["/en-lv/products/xerjoff-1861-naxos-eau-de-parfum-100ml", "/products/xerjoff-1861-naxos-eau-de-parfum-100ml", 1, "the en-* storefronts fold onto the unprefixed English page"],
  ["/collections/system-4", "/collections/system-4", 0, "a collection that is a brand"],
  ["/et/collections/habemeolid", "/et/collections/habemehooldus", 1, "an Estonian sub-collection → its section"],
  ["/ru/collections/uhod-za-volosami", "/ru/collections/uhod-za-volosami", 0, "a section under its own Russian handle"],
  ["/policies/shipping-policy", "/policies/shipping-policy", 0, "Shopify's own policy page"],
  ["/pages/right-to-return", "/policies/refund-policy", 1, "a hand-made Shopify page → the policy"],
  ["/et/pages/contact", "/et/pages/contact", 0, "contact"],
  ["/blogs/blog", "/blogs/news", 1, "the old blog"],
  ["/et", "/et", 0, "a bare storefront prefix"],
  ["/products/blow-dry-ever-thicken", "/products/blow-dry-ever-smooth", 1, "a product that is gone, its line is not"],
  ["/products/captain-fawcett-barberism%C2%AE-beard-oil", "/products/captain-fawcett-barberism-beard-oil", 1, "a handle Shopify percent-escaped"],
];

test.describe("Shopify's addresses", () => {
  for (const [from, want, hops, why] of SHOPIFY) {
    test(`${from} → ${want} in ${hops} hop(s) (${why})`, async ({ request }) => {
      const first = await request.get(from, { maxRedirects: 0 });
      if (hops === 0) {
        expect(first.status(), from).toBe(200);
      } else {
        expect(first.status(), from).toBe(301);
        const to = new URL(first.headers().location, E2E_BASE_URL);
        expect(to.pathname, from).toBe(want);
        const second = await request.get(to.pathname + to.search, { maxRedirects: 0 });
        expect(second.status(), `${from} → ${to.pathname} is a chain`).toBe(200);
      }
    });
  }

  test("Shopify's product-feed query is served with the page, and the canonical folds it", async ({ request }) => {
    const feed = "?variant=48667959099731&country=AE&currency=EUR&utm_medium=product_sync&utm_source=google&utm_content=sag_organic&utm_campaign=sag_organic";
    const noisy = await request.get("/products/gatsby-moving-rubber-hair-wax-80g" + feed, { maxRedirects: 0 });
    expect(noisy.status()).toBe(200);
    expect(await noisy.text()).toContain(`<link rel="canonical" href="${E2E_BASE_URL}/products/gatsby-moving-rubber-hair-wax-80g"`);
  });

  test("a redirect is a 301 and says which rule fired", async ({ request }) => {
    const res = await request.get("/products/night-rider/", { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers().location).toMatch(/\/products\/night-rider$/);
    expect(res.headers()["x-rempire-redirect"]).toBe("slash");
  });

  test("a handle nobody has ever heard of lands on the catalogue, not on «Страница не найдена»", async ({ request }) => {
    const res = await request.get("/products/montblanc-explorer-shower-gel-150ml");
    expect(res.status()).toBe(200);
    expect(new URL(res.url()).pathname).toBe("/collections/all-products");
    const res2 = await request.get("/ru/collections/a-collection-nobody-remembers");
    expect(res2.status()).toBe(200);
    expect(new URL(res2.url()).pathname).toBe("/ru/collections/vse-tovary");
  });
});

test.describe("the shop's own addresses of the weeks before (/shop2/…)", () => {
  for (const [from, want] of [
    [`/shop2/p/${PRODUCT.id}/`, `/ru/products/${PRODUCT.id}`],
    [`/shop2/en/p/${PRODUCT.id}/?size=250ml`, `/products/${PRODUCT.id}?size=250ml`],
    ["/shop2/et/c/hair/", "/et/collections/juuksehooldus"],
    ["/shop2/", "/ru"],
    ["/shop2/info/returns/", "/ru/policies/refund-policy"],
    ["/shop2/done/?n=R-100042&s=paid", "/ru/checkout/done?n=R-100042&s=paid"],
    ["/shop2/admin/?order=R-100042", "/admin?order=R-100042"],
    ["/shop2/scan/", "/admin/scan"],
  ] as const) {
    test(`${from} → ${want}, one 301, its query kept`, async ({ request }) => {
      const res = await request.get(from, { maxRedirects: 0 });
      expect(res.status(), from).toBe(301);
      const to = new URL(res.headers().location, E2E_BASE_URL);
      expect(to.pathname + to.search).toBe(want);
      expect((await request.get(to.pathname + to.search, { maxRedirects: 0 })).status(), want).toBe(200);
    });
  }

  test("the assets under /shop2/ did not move", async ({ request }) => {
    for (const path of ["/shop2/styles.css", "/shop2/manifest.webmanifest", "/shop2/icons/favicon.svg"]) {
      expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(200);
    }
  });
});

test.describe("no page address ends in a slash — and the API answers both", () => {
  test("a page address with a slash is ONE 301 to the one without", async ({ request }) => {
    for (const [from, want] of [["/ru/", "/ru"], [`/products/${PRODUCT.id}/`, `/products/${PRODUCT.id}`], ["/collections/hair-care/", "/collections/hair-care"], ["/admin/", "/admin"]]) {
      const res = await request.get(from, { maxRedirects: 0 });
      expect(res.status(), from).toBe(301);
      expect(new URL(res.headers().location, E2E_BASE_URL).pathname).toBe(want);
    }
  });

  test("an API route answers both spellings, GET and POST, with no redirect", async ({ request }) => {
    for (const path of ["/api/overrides/", "/api/overrides"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(200);
    }
    /* Montonio POSTs to /api/payments/notify/ — a redirect would lose the body */
    for (const path of ["/api/payments/notify/", "/api/payments/notify"]) {
      const res = await request.post(path, { data: "", maxRedirects: 0 });
      expect([301, 302, 307, 308], `${path} answered ${res.status()}`).not.toContain(res.status());
      expect(res.status(), path).toBeLessThan(500);
    }
  });
});
