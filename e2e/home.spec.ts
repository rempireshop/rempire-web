import { expect, test } from "@playwright/test";
import { ipHeaders, LANGS, shopUrl, waitForScreen } from "./fixtures";

/**
 * Home: hero, rails, sets rail, footer company line, language switch.
 * Desktop only — see docs/testing.md "Why most specs run on desktop only".
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "functional spec — desktop project only, see docs/testing.md");
});
test.use({ extraHTTPHeaders: ipHeaders(10) });

for (const lang of LANGS) {
  test.describe(`home — ${lang.code}`, () => {
    test("hero, rails and the sets rail render", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");

      // Hero: at least one slide, marked active via data-on="1".
      const hero = page.locator(".hero");
      await expect(hero).toBeVisible();
      await expect(page.locator('.hero__slide[data-on="1"]').first()).toBeVisible();

      // Two product rails ("Популярные товары", "Новые товары"), cards inside.
      const railTitles = page.locator(".sec__title");
      await expect(railTitles.first()).toBeVisible();
      expect(await railTitles.count()).toBeGreaterThanOrEqual(2);
      await expect(page.locator(".card").first()).toBeVisible();

      // Sets rail — on by default (DEMO.bundles defaults true, app.js), a
      // dedicated section distinct from the plain product rails.
      const setsRail = page.locator(".sec--bundles");
      await expect(setsRail).toBeVisible();
      await expect(setsRail.locator('[data-go="bundles"]')).toBeVisible();
    });

    test("footer shows the company line", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");

      // Footer sections are closed <details> — open every one so content
      // becomes visible, without depending on any translated summary text.
      const summaries = page.locator(".ftr .ftr__acc summary");
      const n = await summaries.count();
      for (let i = 0; i < n; i++) await summaries.nth(i).click();

      // Company data (legalName/regCode/vatNumber/address) is plain Latin —
      // translateTree() skips it, so it is byte-identical in all 3 languages
      // (docs/testing.md — no dictionary lookup needed for this assertion).
      const footer = page.locator(".ftr");
      await expect(footer.getByText("Rempire Store OÜ").first()).toBeVisible();
      await expect(footer.getByText("12216136")).toBeVisible();
      await expect(footer.getByText("EE102723858")).toBeVisible();
      await expect(footer.getByText("Mardi 1, 10145 Tallinn").first()).toBeVisible();

      // Bottom signature line: "© 2026 " is a literal string, not a computed
      // year, so it is stable to assert on exactly.
      await expect(page.locator(".ftr__sig")).toContainText("© 2026 Rempire Store OÜ");
    });
  });
}

test.describe("language switch", () => {
  test("changes the URL prefix and visible text", async ({ page }) => {
    await page.goto(shopUrl("", "/"));
    await waitForScreen(page, "home");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");

    const allProductsLink = page.locator('[data-go-cat="all"]').first();
    await expect(allProductsLink).toHaveText("Все товары");

    await page.locator("[data-langtoggle]").click();
    await page.getByRole("option", { name: "Eesti" }).click();

    // history.replaceState, not a real navigation — expect() polls page.url().
    await expect(page).toHaveURL(/\/shop2\/et\/?$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "et");
    await expect(page.locator('[data-go-cat="all"]').first()).toHaveText("Kõik tooted");

    await page.locator("[data-langtoggle]").click();
    await page.getByRole("option", { name: "English" }).click();
    await expect(page).toHaveURL(/\/shop2\/en\/?$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator('[data-go-cat="all"]').first()).toHaveText("All products");

    // Back to Русский.
    await page.locator("[data-langtoggle]").click();
    await page.getByRole("option", { name: "Русский" }).click();
    await expect(page).toHaveURL(/\/shop2\/?$/);
    await expect(page.locator('[data-go-cat="all"]').first()).toHaveText("Все товары");
  });

  test("a language-prefixed URL loads directly in that language", async ({ page }) => {
    await page.goto(shopUrl("/et", "/"));
    await waitForScreen(page, "home");
    await expect(page.locator("html")).toHaveAttribute("lang", "et");
    await expect(page.locator('[data-go-cat="all"]').first()).toHaveText("Kõik tooted");
  });
});
