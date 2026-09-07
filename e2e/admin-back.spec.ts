import { expect, type Page, test } from "@playwright/test";
import { freshEmail, ipHeaders, loginAsAdmin, payOrder, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

/**
 * «Назад» inside the panel — every card and every sheet.
 *
 * Built 07.09.2026 (audit question 6, Dim's answer «да»): the whole admin
 * lives at one address, so one history entry is parked while anything is open
 * and the browser's Back spends it to close the topmost layer instead of
 * dropping the owner into the shop (app.js `admLayers` / `admSyncHistory`).
 *
 * Dim, 07.09.2026: «Back button should work in admin.» So this file does not
 * test the mechanism — it walks the owner's actual doors, one at a time, and
 * after every Back asks the two questions that matter: is the card gone, and
 * am I still in the admin. The scanner overlay is here because it was the one
 * that was NOT in the layer list: Back left the panel with the camera running.
 */

/** Presses the browser's Back and waits for the panel to answer. */
async function back(page: Page): Promise<void> {
  await page.goBack();
  await expect(page.locator('body[data-screen="admin"]'),
    "Back left the admin altogether").toBeAttached();
}

async function section(page: Page, key: string): Promise<void> {
  await page.locator(`[data-admtab="${key}"][aria-current]:visible`).first().click();
}

test.describe("admin — «Назад» closes what is open", () => {
  test.use({ extraHTTPHeaders: ipHeaders(154) });

  test("desktop: order card, product editor, customer card, settings page, confirm card, blog editor", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the cards are the same on both; the phone gets its own test below");
    test.setTimeout(180_000);

    // a paid order, so there is an order card to open and a customer behind it
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    const number = await payOrder(page, freshEmail("back"), "paid");

    await loginAsAdmin(page);

    // ---- the order card ----------------------------------------------------
    await section(page, "orders");
    await page.locator(`[data-admorder]:has-text("${number}")`).first().click();
    await expect(page.locator('[data-admorder=""]')).toBeVisible();
    await back(page);
    await expect(page.locator('[data-admorder=""]'), "Back did not close the order card").toHaveCount(0);
    await expect(page.locator("[data-admorderq]"), "the orders list did not come back").toBeVisible();

    // ---- a confirm card over that card: two layers, two presses ------------
    await page.locator(`[data-admorder]:has-text("${number}")`).first().click();
    await expect(page.locator('[data-admorder=""]')).toBeVisible();
    await page.locator("[data-admshipnow]").first().click();   // «Отправлен» asks first
    await expect(page.locator(".adm-confirm")).toBeVisible();
    await back(page);
    await expect(page.locator(".adm-confirm"), "Back did not close the confirm card").toHaveCount(0);
    await expect(page.locator('[data-admorder=""]'), "Back took the card as well as the confirm").toBeVisible();
    await back(page);
    await expect(page.locator('[data-admorder=""]'), "the second Back did not close the card").toHaveCount(0);

    // ---- the product editor ------------------------------------------------
    await section(page, "goods");
    await page.locator("[data-admgoods]").first().click();
    await expect(page.locator("[data-admsavegoods]")).toBeVisible();
    await back(page);
    await expect(page.locator("[data-admsavegoods]"), "Back did not close the product editor").toHaveCount(0);

    // ---- the customer card -------------------------------------------------
    // a guest checkout leaves no customer row, so make one to open
    await section(page, "people");
    if ((await page.locator("[data-admcustopen]").count()) === 0) {
      await page.locator("[data-admpartnernew]").click();
      await page.locator('[data-partnerf="email"]').fill(freshEmail("back-partner"));
      await page.locator('[data-partnerf="company"]').fill("Salon Back OÜ");
      await page.locator("[data-admpartnersave]").click();
      await page.locator("[data-admapply]").click();
      await expect(page.locator("[data-admcustopen]").first()).toBeVisible();
    }
    await page.locator("[data-admcustopen]").first().click();
    await expect(page.locator("[data-admcustclose]")).toBeVisible();
    await back(page);
    await expect(page.locator("[data-admcustclose]"), "Back did not close the customer card").toHaveCount(0);

    // ---- a settings page ---------------------------------------------------
    await section(page, "setup");
    await page.locator('[data-admsetpage="home"]').click();
    await expect(page.locator("[data-admsetback]")).toBeVisible();
    await back(page);
    await expect(page.locator("[data-admsetback]"), "Back did not close the settings page").toHaveCount(0);
    await expect(page.locator('[data-admsetpage="home"]'), "the settings index did not come back").toBeVisible();

    // ---- the blog editor ---------------------------------------------------
    await section(page, "blog");
    await page.locator("[data-admblognew]").click();
    await expect(page.locator("[data-admblogback]")).toBeVisible();
    await back(page);
    await expect(page.locator("[data-admblogback]"), "Back did not close the blog editor").toHaveCount(0);
  });

  test("desktop: the scanner overlay — Back closes it instead of leaving the panel", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one run is enough; the overlay is the same on both");
    await loginAsAdmin(page);
    await section(page, "goods");
    await page.locator('.adm-tab[data-admtab="stock"]').click();

    // no camera in headless Chromium — the overlay says so in Russian and
    // stays up, which is exactly the state Back has to be able to leave
    await page.locator("[data-scanopen]").first().click();
    await expect(page.locator(".scanoverlay")).toBeVisible();
    await back(page);
    await expect(page.locator(".scanoverlay"), "Back left the panel with the camera still open").toHaveCount(0);
    await expect(page.locator('.adm-tab[data-admtab="stock"]'), "the warehouse did not come back").toBeVisible();

    // Escape does the same thing, for the same reason
    await page.locator("[data-scanopen]").first().click();
    await expect(page.locator(".scanoverlay")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".scanoverlay"), "Escape did not close the scanner").toHaveCount(0);
  });

  test("phone: the «Ещё» sheet, and a card opened from it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "«Ещё» is the phone's own sheet");
    await loginAsAdmin(page);

    await page.locator("[data-admmore]").click();
    await expect(page.locator(".adm-sheet")).toBeVisible();
    await back(page);
    await expect(page.locator(".adm-sheet"), "Back did not close the «Ещё» sheet").toHaveCount(0);

    // …and a card reached through it closes the same way
    await page.locator("[data-admmore]").click();
    await page.locator('.adm-sheet [data-admtab="setup"]').click();
    await expect(page.locator(".adm-sheet")).toHaveCount(0);
    await page.locator('[data-admsetpage="company"]').click();
    await expect(page.locator("[data-admsetback]")).toBeVisible();
    await back(page);
    await expect(page.locator("[data-admsetback]"), "Back did not close the settings page on a phone").toHaveCount(0);
  });

  test("closing with the button leaves no press that does nothing", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "history bookkeeping, not layout");

    // into the panel from the shop, so there IS somewhere for Back to go
    await page.goto(shopUrl("", "/"));
    await waitForScreen(page, "home");
    await loginAsAdmin(page);
    await section(page, "goods");
    await page.locator("[data-admgoods]").first().click();
    await expect(page.locator("[data-admsavegoods]")).toBeVisible();

    // closed with «← Товары»: the entry the card parked is spent quietly…
    await page.locator("[data-admclose]").first().click();
    await expect(page.locator("[data-admsavegoods]")).toHaveCount(0);
    await expect(page.locator("[data-admgoods]").first()).toBeVisible();

    // …so the NEXT Back is a real navigation out of the panel, not a no-op
    await page.goBack();
    await expect(page.locator('body[data-screen="admin"]'),
      "Back after a button-close did nothing at all").toHaveCount(0);
  });
});
