import { expect, test } from "@playwright/test";
import { BUNDLE, ipHeaders, LANGS, shopUrl, waitForScreen } from "./fixtures";

/** Sets: landing, single set page, add to cart, checkout line shows the
 *  components. Desktop only — see docs/testing.md. */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "functional spec — desktop project only, see docs/testing.md");
});

for (const [i, lang] of LANGS.entries()) {
  test.describe(`sets — ${lang.code}`, () => {
    test.use({ extraHTTPHeaders: ipHeaders(70 + i) });

    test("sets page, set page, add to cart, checkout line breaks out components", async ({ page }) => {
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
      // a toast of some kind appeared, for a real signal either way.
      await expect(page.locator("[data-cartbadge]")).toHaveText("1");

      // Client-side navigation to checkout (cart drawer's own [data-checkout]
      // button), not page.goto(): a full reload with a bundle already in the
      // cart hits a confirmed app.js bug (spawn_task filed) where restoring
      // the cart from localStorage throws on a bundle line — DEMO, which
      // allBundles()/bundleById() read, isn't assigned until far later in the
      // file than the restore code that calls them — silently emptying the
      // whole cart. Going to checkout without a reload never touches that
      // restore path at all, exercising exactly what the shopper's own
      // "review cart, then check out" click does.
      await page.locator("[data-cart]").first().click();
      await page.locator("[data-checkout]").click();
      await waitForScreen(page, "checkout");
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
