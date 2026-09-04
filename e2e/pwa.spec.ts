import { test, expect } from "@playwright/test";
import { ipHeaders, loginAsAdmin, shopUrl, waitForScreen } from "./fixtures";
import { E2E_ADMIN_PASSWORD } from "./env.mjs";

/**
 * Three installable apps from one page (docs/inventory.md → PWA): the shop
 * manifest is what every visitor sees; the admin manifest exists only while
 * the admin route is on screen and the scanner manifest only on
 * /shop2/scan/ — so a customer's "install app" prompt can never be called
 * «Админка» or «Сканер».
 */
test.use({ extraHTTPHeaders: ipHeaders(97) });

async function manifestHref(page: import("@playwright/test").Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null);
}
async function iosTitle(page: import("@playwright/test").Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute("content") ?? null);
}

test.describe("pwa manifests", () => {
  test("storefront links the shop manifest; all three manifests are valid and distinct apps", async ({ page, request }) => {
    await page.goto(shopUrl("", "/"));
    await waitForScreen(page, "home");
    expect(await manifestHref(page)).toBe("/shop2/manifest.webmanifest");
    expect(await iosTitle(page)).toBe("Rempire");

    const shop = await (await request.get(shopUrl("", "/manifest.webmanifest"))).json();
    const admin = await (await request.get(shopUrl("", "/admin.webmanifest"))).json();
    const scanner = await (await request.get(shopUrl("", "/scanner.webmanifest"))).json();
    expect(shop.name).toBe("Rempire");
    expect(shop.start_url).toBe("/shop2/");
    expect(shop.scope).toBe("/shop2/");
    expect(admin.short_name).toBe("Админка");
    expect(admin.start_url).toBe("/shop2/admin/");
    expect(admin.scope).toBe("/shop2/admin/");
    // the scanner is its own app: own id, own scope, opens straight into the
    // viewfinder rather than into the panel
    expect(scanner.name).toBe("Rempire — сканер");
    expect(scanner.short_name).toBe("Сканер");
    expect(scanner.start_url).toBe("/shop2/scan/");
    expect(scanner.scope).toBe("/shop2/scan/");
    const ids = [shop.id, admin.id, scanner.id];
    expect(new Set(ids).size, "the three manifests must not share an id").toBe(3);
    for (const m of [shop, admin, scanner]) {
      expect(m.display).toBe("standalone");
      expect(m.icons.length).toBeGreaterThanOrEqual(2);
    }
    // the shop manifest must never mention the admin or the scanner
    expect(JSON.stringify(shop).toLowerCase()).not.toMatch(/админ|admin|сканер|scan/);
  });

  test("the admin route swaps to the admin manifest and back", async ({ page }) => {
    await page.goto(shopUrl("", "/admin/"));
    await waitForScreen(page, "admin");
    expect(await manifestHref(page)).toBe("/shop2/admin.webmanifest");
    expect(await iosTitle(page)).toBe("Админка");

    // logged in, still the admin manifest
    await loginAsAdmin(page);
    expect(await manifestHref(page)).toBe("/shop2/admin.webmanifest");

    // back in the shop (same SPA, no reload): the shop manifest again
    await page.getByRole("button", { name: "← В магазин" }).click();
    await waitForScreen(page, "home");
    expect(await manifestHref(page)).toBe("/shop2/manifest.webmanifest");
    expect(await iosTitle(page)).toBe("Rempire");
  });

  /**
   * The scanner app (docs/inventory.md → "Сканер как отдельное приложение"):
   * the manifest swap happens for a stranger too — that is what makes
   * "install, then sign in inside the app" work — but the screen behind it is
   * the admin login card, exactly as on /shop2/admin/.
   */
  test("the scan route swaps to the scanner manifest and is admin-only", async ({ page }) => {
    await page.goto(shopUrl("", "/scan/"));
    await waitForScreen(page, "scan");
    expect(await manifestHref(page)).toBe("/shop2/scanner.webmanifest");
    expect(await iosTitle(page)).toBe("Сканер");

    // a stranger gets the login card, not a camera
    await expect(page.locator("[data-admpw]")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".scanoverlay")).toHaveCount(0);
    await expect(page.getByText("Вход в админку")).toBeVisible();

    // signing in on the scan route opens the scanner itself, in place
    await page.locator("[data-admpw]").fill(E2E_ADMIN_PASSWORD);
    await page.locator("[data-admlogin]").click();
    await expect(page.locator(".scanoverlay")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".scan__brand")).toHaveText("Rempire · Сканер");
    // manual entry is always there — it is also the bluetooth-scanner target
    await expect(page.locator("[data-scanmanual]")).toBeVisible();
    // and no shop chrome behind it
    await expect(page.locator(".botnav")).toBeHidden();
    expect(await manifestHref(page)).toBe("/shop2/scanner.webmanifest");

    // «В админку» leaves the scanner app for the panel — overlay gone, admin
    // manifest back, so an install prompt there offers «Админка» again
    await page.locator("[data-scanadmin]").click();
    await waitForScreen(page, "admin");
    await expect(page.locator(".scanoverlay")).toHaveCount(0);
    expect(await manifestHref(page)).toBe("/shop2/admin.webmanifest");
    expect(await iosTitle(page)).toBe("Админка");
  });
});
