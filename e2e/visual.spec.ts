import { expect, test } from "@playwright/test";
import { ipHeaders, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

/**
 * Visual regression: home, product, checkout — ET, all three viewport
 * projects (that is the whole point of this file, unlike every other spec
 * in this suite — see docs/testing.md "Why most specs run on desktop only").
 * Threshold is generous (playwright.config.ts expect.toHaveScreenshot) and
 * baselines are kept per-platform ({platform} in snapshotPathTemplate) —
 * see docs/testing.md "Visual snapshots" for what that does and does not
 * paper over, and how to update the images with `npm run e2e:update`.
 */
test.use({ extraHTTPHeaders: ipHeaders(140) });

test("home", async ({ page }) => {
  await page.goto(shopUrl("/et", "/"));
  await waitForScreen(page, "home");
  // Captured promptly (well inside the 6s hero auto-rotate interval) so the
  // first slide is what the baseline and every comparison both see.
  await expect(page).toHaveScreenshot("home-et.png");
});

test("product", async ({ page }) => {
  await page.goto(shopUrl("/et", `/p/${PRODUCT.id}/`));
  await waitForScreen(page, "product");
  await expect(page).toHaveScreenshot("product-et.png");
});

test("checkout", async ({ page }) => {
  await page.goto(shopUrl("/et", `/p/${PRODUCT.id}/`));
  await waitForScreen(page, "product");
  await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto(shopUrl("/et", "/checkout/"));
  await waitForScreen(page, "checkout");
  await expect(page).toHaveScreenshot("checkout-et.png");
});
