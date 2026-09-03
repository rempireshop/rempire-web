import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test, type TestInfo } from "@playwright/test";
import { ipHeaders, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

/** Accessibility smoke on 5 key screens. Desktop only, single run — see
 *  docs/testing.md. Serious/critical violations fail the test; every
 *  violation (any impact) is attached to the test result as JSON so the
 *  Playwright HTML report carries the full list even where the test passed. */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "a11y spec — desktop project only, see docs/testing.md");
});
test.use({ extraHTTPHeaders: ipHeaders(130) });
// intro() (app.js) — a once-per-session, purely decorative logo splash
// overlaid on document.body for ~2.4s on first load — already skips itself
// under prefers-reduced-motion, and is not part of any of these 5 screens'
// actual functional UI. Without this, whether axe catches it mid-animation
// (it fails color-contrast — a fixed color pairing meant to be on screen
// only briefly) depends on exactly how fast the page loads relative to its
// timer, which is timing luck, not a real, reachable a11y bug in the screen
// under test.
test.use({ contextOptions: { reducedMotion: "reduce" } });

const FAIL_ON: Array<string | null> = ["serious", "critical"];

async function checkA11y(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();

  await testInfo.attach(`axe-${name}.json`, {
    body: JSON.stringify(
      results.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length })),
      null,
      2,
    ),
    contentType: "application/json",
  });

  const blocking = results.violations.filter((v) => FAIL_ON.includes(v.impact ?? null));
  const other = results.violations.filter((v) => !FAIL_ON.includes(v.impact ?? null));
  if (other.length) {
    console.log(
      `[a11y:${name}] ${other.length} non-blocking violation(s): ${other.map((v) => `${v.id}(${v.impact})`).join(", ")}`,
    );
  }
  expect(blocking, blocking.map((v) => `${v.id} (${v.impact}): ${v.help}`).join("\n")).toEqual([]);
}

test("home", async ({ page }, testInfo) => {
  await page.goto(shopUrl("", "/"));
  await waitForScreen(page, "home");
  await checkA11y(page, testInfo, "home");
});

test("product", async ({ page }, testInfo) => {
  await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
  await waitForScreen(page, "product");
  await checkA11y(page, testInfo, "product");
});

test("checkout", async ({ page }, testInfo) => {
  await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
  await waitForScreen(page, "product");
  await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto(shopUrl("", "/checkout/"));
  await waitForScreen(page, "checkout");
  await checkA11y(page, testInfo, "checkout");
});

test("account", async ({ page }, testInfo) => {
  await page.goto(shopUrl("", "/account/"));
  await waitForScreen(page, "account");
  await checkA11y(page, testInfo, "account");
});

test("admin login", async ({ page }, testInfo) => {
  await page.goto(shopUrl("", "/admin/"));
  await expect(page.locator("[data-admpw]")).toBeVisible();
  await checkA11y(page, testInfo, "admin-login");
});
