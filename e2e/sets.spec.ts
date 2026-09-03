import { expect, test } from "@playwright/test";
import { BUNDLE, ipHeaders, LANGS, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

/** Sets: landing, single set page, add to cart, checkout line shows the
 *  components. Desktop only — see docs/testing.md. */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "functional spec — desktop project only, see docs/testing.md");
});

for (const [i, lang] of LANGS.entries()) {
  test.describe(`sets — ${lang.code}`, () => {
    test.use({ extraHTTPHeaders: ipHeaders(70 + i) });

    test("sets page, set page, add to cart, checkout line breaks out components", async ({ page }) => {
      // A plain product first, so the reload below has to restore a *mixed*
      // cart — not just the bundle line on its own.
      await page.goto(shopUrl(lang.seg, `/p/${PRODUCT.id}/`));
      await waitForScreen(page, "product");
      await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
      await expect(page.getByRole("status")).toBeVisible();

      await page.goto(shopUrl(lang.seg, "/sets/"));
      await waitForScreen(page, "bundles");
      const card = page.locator(`[data-go-bundle="${BUNDLE.id}"]`);
      await expect(card).toBeVisible();
      await card.click();

      await waitForScreen(page, "bundle");
      await expect(page).toHaveURL(new RegExp(`/shop2${lang.seg}/set/${BUNDLE.id}/?$`));
      for (const name of BUNDLE.componentNames) {
        await expect(page.locator(".bitems")).toContainText(name);
      }

      // Two add-to-set buttons render on this page (a sticky-bar duplicate,
      // same pattern as the product page's .pdp__add) — .btn--wide is the
      // primary one.
      await page.locator(`button.btn--wide[data-addbundle="${BUNDLE.id}"]`).click();
      // addBundleToCart() (app.js) toasts on BOTH the success path and the
      // "an item ran out" failure path — check the cart badge, not just that
      // a toast of some kind appeared, for a real signal either way. "2":
      // the product line (qty 1) plus the bundle line (always qty 1 on add).
      await expect(page.locator("[data-cartbadge]")).toHaveText("2");

      // A full reload — not client-side navigation — deliberately: this is
      // the regression check for a fixed app.js bug where restoring the cart
      // from localStorage threw on any bundle line (DEMO, which
      // allBundles()/bundleById() read, wasn't assigned until far later in
      // the file than the restore code that called them) and silently
      // emptied the *whole* saved cart, not just the bundle line — so the
      // plain product line disappeared too. Fixed by guarding allBundles()
      // against DEMO not being initialised yet, plus a try/catch around the
      // restore filter so a throw there can never again wipe a saved cart.
      await page.reload();
      await waitForScreen(page, "bundle");
      await expect(page.locator("[data-cartbadge]")).toHaveText("2");

      await page.locator("[data-cart]").first().click();
      await page.locator("[data-checkout]").click();
      await waitForScreen(page, "checkout");
      // The product line survived the reload too, not just the bundle one.
      await expect(page.locator(".cosum")).toContainText(PRODUCT.brand);
      // lineNoteHTML() (app.js) renders the same .cline__parts breakout both
      // in the cart drawer and in the checkout summary — this is the summary
      // instance, inside .cosum.
      const parts = page.locator(".cosum .cline__parts").first();
      await expect(parts).toBeVisible();
      for (const name of BUNDLE.componentNames) {
        await expect(parts).toContainText(name);
      }
    });
  });
}
