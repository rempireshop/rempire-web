/**
 * Meta Pixel (15.11.2026, mountPixel() in public/shop2/app.js).
 *
 * Renat's pixel for his Facebook/Instagram ads, loaded only after the consent
 * banner's «Принять всё» and only on rempireshop.com. Here `rmp-pixel-test`
 * in localStorage opens localhost for it, and connect.facebook.net is
 * answered by a stand-in for fbevents.js that drains Meta's queue into
 * `window.__px` — so nothing reaches Meta from a test run, and the calls the
 * shop made are what the assertions read.
 *
 * What it holds the shop to:
 *   · nothing loads before the shopper answers, nor after «Только необходимое»;
 *   · «Принять всё» loads it at once and counts the page already on screen;
 *   · the four events Meta asked for — ViewContent, AddToCart,
 *     InitiateCheckout, Purchase with the value in EUR and the order number
 *     as eventID — and Purchase only once per order;
 *   · the owner's panel sends Meta nothing;
 *   · a `v: 1` «Принять всё» (given before the Meta line existed) is asked
 *     again; a `v: 1` «Только необходимое» stands.
 */
import { expect, type Page, test } from "@playwright/test";
import { E2E_BASE_URL } from "./env.mjs";
import { functionalProject, ipHeaders, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

const PIXEL_ID = "1082368324784460";

/** Stands in for fbevents.js: every queued and later call lands in window.__px. */
const FAKE_FBEVENTS = `(function () {
  var f = window.fbq; window.__px = window.__px || []; window.__pxHref = window.__pxHref || [];
  if (!f) return;
  f.callMethod = function () {
    window.__pxHref.push(location.href);   // what the real script would send as the page address
    window.__px.push(JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments))));
  };
  (f.queue || []).forEach(function (a) { f.callMethod.apply(f, a); });
  f.queue = [];
})();`;

type Call = unknown[];

async function watchPixel(page: Page): Promise<{ loads: string[] }> {
  const loads: string[] = [];
  await page.addInitScript(() => {
    try { localStorage.setItem("rmp-pixel-test", "1"); } catch { /* a storage-less page has no pixel either */ }
  });
  await page.route("https://connect.facebook.net/**", async (route) => {
    loads.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "application/javascript", body: FAKE_FBEVENTS });
  });
  // the real script would report to www.facebook.com/tr — nothing may, from a test
  await page.route("https://www.facebook.com/**", (route) => route.abort());
  return { loads };
}

function calls(page: Page): Promise<Call[]> {
  return page.evaluate(() => ((window as unknown as { __px?: unknown[][] }).__px ?? []) as unknown[][]);
}
async function tracked(page: Page, name: string): Promise<Record<string, unknown>[]> {
  return (await calls(page)).filter((c) => c[0] === "track" && c[1] === name).map((c) => (c[2] ?? {}) as Record<string, unknown>);
}

function consentState(value: Record<string, unknown>) {
  return {
    cookies: [
      {
        name: "rempire_lang", value: "en", domain: "localhost", path: "/",
        expires: -1, httpOnly: false, secure: false, sameSite: "Lax" as const,
      },
    ],
    origins: [{ origin: E2E_BASE_URL, localStorage: [{ name: "rempire-consent", value: JSON.stringify(value) }] }],
  };
}

test.beforeEach(async ({}, testInfo) => {
  test.skip(!functionalProject(testInfo) || testInfo.project.name !== "desktop", "one engine is enough for the pixel's wiring");
});

test.describe("before a yes", () => {
  test.use({ extraHTTPHeaders: ipHeaders(232), storageState: { cookies: [], origins: [] }, locale: "en-US" });

  test("nothing loads until «Принять всё», which counts the page on screen", async ({ page }) => {
    const { loads } = await watchPixel(page);
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await expect(page.locator(".cbanner__box")).toContainText("Meta");
    expect(loads, "the pixel loaded before the visitor answered").toHaveLength(0);
    expect(await page.evaluate(() => typeof (window as unknown as { fbq?: unknown }).fbq)).toBe("undefined");

    await page.locator('[data-consent="all"]').click();
    await expect.poll(() => loads.length, { message: "no fbevents.js after «Принять всё»" }).toBe(1);
    await expect.poll(() => calls(page)).toEqual(expect.arrayContaining([
      ["set", "autoConfig", false, PIXEL_ID],
      ["init", PIXEL_ID],
      ["track", "PageView", {}],
    ]));
    // the product page that was already open is counted, too
    await expect.poll(() => tracked(page, "ViewContent")).toEqual([
      expect.objectContaining({ content_ids: [PRODUCT.id], content_type: "product_group", currency: "EUR" }),
    ]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("rempire-consent") || "{}"))).toMatchObject({ v: 2, analytics: true, ads: true });
  });

  test("«Только необходимое» keeps it out, page after page", async ({ page }) => {
    const { loads } = await watchPixel(page);
    await page.goto(shopUrl("", "/"));
    await waitForScreen(page, "home");
    await page.locator('[data-consent="need"]').click();
    await expect(page.locator(".cbanner__box")).toHaveCount(0);
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.waitForTimeout(500);
    expect(loads, "the pixel loaded after «Только необходимое»").toHaveLength(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("rempire-consent") || "{}"))).toMatchObject({ v: 2, ads: false });
  });
});

test.describe("an answer from before the Meta line", () => {
  test.describe("«Принять всё»", () => {
    test.use({ extraHTTPHeaders: ipHeaders(233), storageState: consentState({ v: 1, analytics: true, at: 0 }) });
    test("is asked once more, and the pixel waits for the new answer", async ({ page }) => {
      const { loads } = await watchPixel(page);
      await page.goto(shopUrl("", "/"));
      await waitForScreen(page, "home");
      await expect(page.locator(".cbanner__box")).toBeVisible();
      await page.waitForTimeout(300);
      expect(loads).toHaveLength(0);
    });
  });
  test.describe("«Только необходимое»", () => {
    test.use({ extraHTTPHeaders: ipHeaders(234), storageState: consentState({ v: 1, analytics: false, at: 0 }) });
    test("stands: no banner, no pixel", async ({ page }) => {
      const { loads } = await watchPixel(page);
      await page.goto(shopUrl("", "/"));
      await waitForScreen(page, "home");
      await page.waitForTimeout(300);
      await expect(page.locator(".cbanner__box")).toHaveCount(0);
      expect(loads).toHaveLength(0);
    });
  });
});

test.describe("with a yes", () => {
  test.use({ extraHTTPHeaders: ipHeaders(235), storageState: consentState({ v: 2, analytics: true, ads: true, at: 0 }) });

  test("product, basket and checkout send Meta's events", async ({ page }) => {
    await watchPixel(page);
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await expect.poll(() => tracked(page, "ViewContent")).toEqual([
      expect.objectContaining({ content_ids: [PRODUCT.id], currency: "EUR", value: expect.any(Number) }),
    ]);

    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await expect.poll(() => tracked(page, "AddToCart")).toEqual([
      expect.objectContaining({ content_ids: [PRODUCT.id], currency: "EUR", value: expect.any(Number) }),
    ]);

    // the drawer's own «Оформить заказ» — a navigation, which is where the checkout event lives
    await page.locator("[data-cart]:visible").first().click();
    await page.locator("[data-checkout]:visible").first().click();
    await waitForScreen(page, "checkout");
    await expect.poll(() => tracked(page, "InitiateCheckout")).toEqual([
      expect.objectContaining({ content_ids: [PRODUCT.id], num_items: 1, currency: "EUR", value: expect.any(Number) }),
    ]);
  });

  test("a paid receipt is one Purchase, with the value in EUR and the order number", async ({ page }) => {
    await watchPixel(page);
    await page.goto("/ru/checkout/done?n=R-100077&s=paid&t=41.90");
    await waitForScreen(page, "done");
    await expect.poll(() => calls(page)).toEqual(expect.arrayContaining([
      ["track", "Purchase", { value: 41.9, currency: "EUR" }, { eventID: "R-100077" }],
    ]));
    // the same receipt again (a reload, the bank's redirect twice) is not a second sale
    await page.reload();
    await waitForScreen(page, "done");
    await expect.poll(() => tracked(page, "PageView")).toHaveLength(1);
    expect(await tracked(page, "Purchase")).toHaveLength(0);
  });

  test("the owner's panel sends Meta nothing", async ({ page }) => {
    const { loads } = await watchPixel(page);
    const res = await page.goto(shopUrl("", "/admin/"));
    await expect(page.locator("[data-admpw]")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);
    expect(loads, "fbevents.js loaded on the admin screen").toHaveLength(0);
    // …and the panel's own CSP does not even allow it (next.config.ts, ADMIN_HEADERS)
    expect(res?.headers()["content-security-policy"] ?? "").not.toContain("facebook");
  });

  /* Security review of 8185aec2: the receipt's address carries a bought gift
     card's code and PDF token (`g`), and Meta's script sends the page address
     with every event. */
  test("a gift card's code never reaches Meta, and the receipt keeps it", async ({ page }) => {
    await watchPixel(page);
    const code = "RMP-ABCD-EFGH";
    await page.goto(`/ru/checkout/done?n=R-100078&s=paid&t=50.00&g=${code}~abcdefghijklmnop1234`);
    await waitForScreen(page, "done");
    await expect.poll(() => tracked(page, "Purchase")).toEqual([{ value: 50, currency: "EUR" }]);
    const hrefs = await page.evaluate(() => (window as unknown as { __pxHref?: string[] }).__pxHref ?? []);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(h, "the page address Meta would see").not.toMatch(/RMP-|[?&]g=/);
    await expect(page.locator(`[data-giftpdf="${code}"]`)).toBeVisible();
    // a reload of the same receipt still has the gift card (kept for this tab)
    await page.reload();
    await waitForScreen(page, "done");
    await expect(page.locator(`[data-giftpdf="${code}"]`)).toBeVisible();
  });

  test("a tab that loaded the pixel starts a fresh page on the way into the panel", async ({ page }) => {
    await watchPixel(page);
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as { fbq?: unknown }).fbq)).toBe("function");
    // the shop's own Back into the panel — a history move inside the same page
    await Promise.all([
      page.waitForEvent("load"),
      page.evaluate(() => {
        history.pushState({}, "", "/admin");
        window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
      }),
    ]);
    await expect(page.locator("[data-admpw]")).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => typeof (window as unknown as { fbq?: unknown }).fbq)).toBe("undefined");
  });
});
