import { expect, test } from "@playwright/test";
import { CATEGORY, ipHeaders, LANGS, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

/** Category nav, brand page, search, infinite scroll. Desktop only — see
 *  docs/testing.md "Why most specs run on desktop only". */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "functional spec — desktop project only, see docs/testing.md");
});
test.use({ extraHTTPHeaders: ipHeaders(20) });

for (const lang of LANGS) {
  test.describe(`catalogue — ${lang.code}`, () => {
    test("category navigation lists products", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");

      await page.locator(`[data-go-cat="${CATEGORY.id}"]`).first().click();
      await waitForScreen(page, "catalog");
      await expect(page).toHaveURL(new RegExp(`/shop2${lang.seg}/c/${CATEGORY.id}/?$`));

      await expect(page.locator("#catgrid .card").first()).toBeVisible();
      // "N товаров" / "N toodet" / "N products" — assert the number only,
      // the surrounding word is a UI_RX-templated string (app.js), not a
      // fixed dictionary key, so a regex on the digits is the robust check.
      await expect(page.locator("[data-count]")).toHaveText(/\d+/);
    });

    test("brand page shows only that brand's products", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");

      await page.locator(`.brandstrip__it[data-go-brand="${PRODUCT.brand}"]`).click();
      await waitForScreen(page, "catalog");
      // A brand with a logo (BRAND_LOGOS, brandMark() in app.js) renders
      // `<span role="img" aria-label="…">` — a CSS background-image, not a
      // real <img>/alt — instead of plain text; System 4 is one of those.
      // getByRole('img', {name}) reads the computed accessible name (works
      // for both that case and the plain-text one other brands use), where
      // .textContent() would see an empty string and getByAltText() would
      // never match at all (there is no `alt` attribute here to read).
      await expect(page.getByText(PRODUCT.brand).or(page.getByRole("img", { name: PRODUCT.brand })).first()).toBeVisible();
      await expect(page.locator("#catgrid .card").first()).toBeVisible();
    });

    test("search finds results and shows an empty state for gibberish", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");

      // Brand names are not translated (Latin, no Cyrillic — translateTree()
      // skips them), so one query string works in all three languages.
      await page.locator("[data-search]").fill("System");
      await waitForScreen(page, "search");
      await expect(page).toHaveURL(/\/search\/\?q=System/);
      await expect(page.locator(".grid .card").first()).toBeVisible();

      await page.locator("[data-search2]").fill("zzzznonexistentquery12345");
      await expect(page.locator(".empty, .muted", { hasText: "zzzznonexistentquery12345" })).toBeVisible();
    });

    test("infinite scroll appends more products", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/c/hair/")); // hair has the most SKUs — guarantees >12
      await waitForScreen(page, "catalog");

      const cards = page.locator("#catgrid .card");
      const before = await cards.count();
      expect(before).toBeGreaterThan(0);

      const sentinel = page.locator("#sentinel");
      if ((await sentinel.count()) === 0) {
        test.skip(true, "fewer than 12 products in this category — nothing to page in");
      }
      await sentinel.scrollIntoViewIfNeeded();
      // The observer debounces on a 320ms timer (app.js) before appending.
      await expect(async () => {
        expect(await cards.count()).toBeGreaterThan(before);
      }).toPass({ timeout: 5_000 });
    });
  });
}
