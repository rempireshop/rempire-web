import { test, expect } from "@playwright/test";
import { ipHeaders, loginAsAdmin, shopUrl, waitForScreen } from "./fixtures";

/**
 * Two installable apps from one page (docs/inventory.md → PWA): the shop
 * manifest is what every visitor sees; the admin manifest exists only while
 * the admin route is on screen, so a customer's "install app" prompt can
 * never be called «Админка».
 */
test.use({ extraHTTPHeaders: ipHeaders(97) });

async function manifestHref(page: import("@playwright/test").Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null);
}
async function iosTitle(page: import("@playwright/test").Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute("content") ?? null);
}

test.describe("pwa manifests", () => {
  test("storefront links the shop manifest; both manifests are valid and distinct apps", async ({ page, request }) => {
    await page.goto(shopUrl("", "/"));
    await waitForScreen(page, "home");
    expect(await manifestHref(page)).toBe("/shop2/manifest.webmanifest");
    expect(await iosTitle(page)).toBe("Rempire");

    const shop = await (await request.get(shopUrl("", "/manifest.webmanifest"))).json();
    const admin = await (await request.get(shopUrl("", "/admin.webmanifest"))).json();
    expect(shop.name).toBe("Rempire");
    expect(shop.start_url).toBe("/shop2/");
    expect(shop.scope).toBe("/shop2/");
    expect(admin.short_name).toBe("Админка");
    expect(admin.start_url).toBe("/shop2/admin/");
    expect(admin.scope).toBe("/shop2/admin/");
    expect(admin.id).not.toBe(shop.id);
    for (const m of [shop, admin]) {
      expect(m.display).toBe("standalone");
      expect(m.icons.length).toBeGreaterThanOrEqual(2);
    }
    // the shop manifest must never mention the admin
    expect(JSON.stringify(shop).toLowerCase()).not.toMatch(/админ|admin/);
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
});
