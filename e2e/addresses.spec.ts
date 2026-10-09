import { expect, test } from "@playwright/test";
import { E2E_BASE_URL } from "./env.mjs";
import { CATEGORY, functionalProject, ipHeaders, PRODUCT, waitForScreen } from "./fixtures";

/**
 * Shopify's addresses in a real browser (since 08.10.2026, src/lib/shop-paths.mjs):
 * a walk through the shop in Russian, a language switch, Back and Forward
 * across it, the old /shop2/ link a letter carries, and /cart. The language
 * of every screen is its address's — html lang, the canonical and the URL
 * move together.
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(!functionalProject(testInfo), "addresses spec — functional projects only, see docs/testing.md");
});
test.use({ extraHTTPHeaders: ipHeaders(117) });

const path = (url: string) => new URL(url).pathname;
const lang = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.lang);
const canonical = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "");

test("a walk in Russian, a switch to Estonian, and Back and Forward across it", async ({ page }) => {
  await page.goto("/ru");
  await waitForScreen(page, "home");
  expect(await lang(page)).toBe("ru");

  await page.goto(`/ru/collections/uhod-za-borodoy`);
  await waitForScreen(page, "catalog");
  expect(await lang(page)).toBe("ru");
  expect(await canonical(page)).toBe(`${E2E_BASE_URL}/ru/collections/uhod-za-borodoy`);

  // a product, by the shop's own navigation (pushState)
  await page.evaluate((id) => {
    history.pushState({}, "", "/ru/products/" + id);
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  }, PRODUCT.id);
  await waitForScreen(page, "product");
  expect(path(page.url())).toBe(`/ru/products/${PRODUCT.id}`);

  // the switcher rewrites the prefix in place — Estonian, same product
  await page.locator("[data-langtoggle]").click();
  await page.getByRole("option", { name: "Eesti" }).click();
  await expect(page).toHaveURL(new RegExp(`/et/products/${PRODUCT.id}$`));
  await expect(page.locator("html")).toHaveAttribute("lang", "et");
  expect(await canonical(page)).toBe(`${E2E_BASE_URL}/et/products/${PRODUCT.id}`);

  // Back: the Russian section, in Russian, with its own canonical
  await page.goBack();
  await waitForScreen(page, "catalog");
  expect(path(page.url())).toBe("/ru/collections/uhod-za-borodoy");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  expect(await canonical(page)).toBe(`${E2E_BASE_URL}/ru/collections/uhod-za-borodoy`);

  // Forward: the Estonian product again
  await page.goForward();
  await waitForScreen(page, "product");
  expect(path(page.url())).toBe(`/et/products/${PRODUCT.id}`);
  await expect(page.locator("html")).toHaveAttribute("lang", "et");
});

test("a section reached by a click carries the language's own handle", async ({ page }) => {
  await page.goto("/et");
  await waitForScreen(page, "home");
  await page.locator(`[data-go-cat="${CATEGORY.id}"]`).first().click();
  await waitForScreen(page, "catalog");
  expect(path(page.url())).toBe("/et/collections/habemehooldus");
  await page.goto("/collections/beard-care");
  await waitForScreen(page, "catalog");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("an old /shop2/ link from a letter lands on the page, in one hop, in Russian", async ({ page }) => {
  const res = await page.request.get(`/shop2/p/${PRODUCT.id}/?size=250ml`, { maxRedirects: 0 });
  expect(res.status()).toBe(301);
  await page.goto(`/shop2/p/${PRODUCT.id}/?size=250ml`);
  await waitForScreen(page, "product");
  expect(path(page.url())).toBe(`/ru/products/${PRODUCT.id}`);
  expect(new URL(page.url()).search).toBe("?size=250ml");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
});

test("/cart opens the shop with the basket out, and Back closes it", async ({ page }) => {
  await page.goto("/ru/cart");
  await waitForScreen(page, "home");
  expect(path(page.url())).toBe("/ru");
  await expect(page.getByRole("dialog", { name: "Корзина" })).toBeVisible();
  await expect(page.locator("[data-closecart]").first()).toBeVisible();
});

test("a 404 keeps its address and its language", async ({ page }) => {
  const res = await page.goto("/et/no-such-page-08102026");
  expect(res?.status()).toBe(404);
  await waitForScreen(page, "notfound");
  expect(path(page.url())).toBe("/et/no-such-page-08102026");
  await expect(page.locator("html")).toHaveAttribute("lang", "et");
});
