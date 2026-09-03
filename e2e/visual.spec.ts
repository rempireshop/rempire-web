import { existsSync } from "node:fs";
import { expect, test, type TestInfo } from "@playwright/test";
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

/**
 * In CI, a missing baseline for this platform is not "no comparison to make"
 * — toHaveScreenshot() writes the actual screenshot as a brand-new baseline
 * and still fails the assertion ("A snapshot doesn't exist … writing
 * actual"), which reads exactly like a real visual regression on every CI
 * run until a human notices and commits the generated image. The repo ships
 * Windows baselines only (docs/testing.md "Visual snapshots"); Linux ones are
 * generated and committed once, deliberately, not auto-accepted by a CI run.
 * Skip cleanly instead, with a message that says exactly what to run —
 * local runs (no process.env.CI) are untouched and keep today's behaviour.
 */
function skipIfNoBaseline(testInfo: TestInfo, name: string): void {
  if (!process.env.CI) return;
  const path = testInfo.snapshotPath(name, { kind: "screenshot" });
  test.skip(!existsSync(path), `No baseline yet at ${path} — generate and commit one with \`npm run e2e:update\` run on this platform (see docs/testing.md "Visual snapshots").`);
}

test("home", async ({ page }, testInfo) => {
  skipIfNoBaseline(testInfo, "home-et.png");
  await page.goto(shopUrl("/et", "/"));
  await waitForScreen(page, "home");
  // Captured promptly (well inside the 6s hero auto-rotate interval) so the
  // first slide is what the baseline and every comparison both see.
  await expect(page).toHaveScreenshot("home-et.png");
});

test("product", async ({ page }, testInfo) => {
  skipIfNoBaseline(testInfo, "product-et.png");
  await page.goto(shopUrl("/et", `/p/${PRODUCT.id}/`));
  await waitForScreen(page, "product");
  await expect(page).toHaveScreenshot("product-et.png");
});

test("checkout", async ({ page }, testInfo) => {
  skipIfNoBaseline(testInfo, "checkout-et.png");
  await page.goto(shopUrl("/et", `/p/${PRODUCT.id}/`));
  await waitForScreen(page, "product");
  await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto(shopUrl("/et", "/checkout/"));
  await waitForScreen(page, "checkout");
  await expect(page).toHaveScreenshot("checkout-et.png");
});
