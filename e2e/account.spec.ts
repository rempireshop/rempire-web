import { expect, test } from "@playwright/test";
import { freshEmail, ipHeaders, LANGS, payOrder, PRODUCT, shopUrl, tr, waitForScreen } from "./fixtures";

/**
 * Account: request code → login with the exposed code → order list shows the
 * order just placed → profile save → logout. Desktop only — see
 * docs/testing.md "Why most specs run on desktop only".
 *
 * The login code is only knowable in this suite because
 * E2E_EXPOSE_LOGIN_CODE=1 rides it along in the /api/account/code response —
 * see that route's own comment and docs/testing.md. A real customer reads it
 * from e-mail; here we read the same code the browser itself just received,
 * via page.waitForResponse, and type it into the same field a person would.
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "functional spec — desktop project only, see docs/testing.md");
});

for (const [i, lang] of LANGS.entries()) {
  test.describe(`account — ${lang.code}`, () => {
    test.use({ extraHTTPHeaders: ipHeaders(50 + i) });

    test("request code, log in, see the order just placed, save profile, log out", async ({ page }) => {
      const email = freshEmail(`acct-${lang.code}`);

      // 1) Place one paid order under this address.
      await page.goto(shopUrl(lang.seg, `/p/${PRODUCT.id}/`));
      await waitForScreen(page, "product");
      await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
      await expect(page.getByRole("status")).toBeVisible();
      await page.goto(shopUrl(lang.seg, "/checkout/"));
      await waitForScreen(page, "checkout");
      const orderNumber = await payOrder(page, email, "paid");

      // 2) Account: request the code, read it off the network response, log in.
      await page.goto(shopUrl(lang.seg, "/account/"));
      await waitForScreen(page, "account");
      await page.locator("[data-email]").fill(email);
      const codeResponse = page.waitForResponse((r) => r.url().includes("/api/account/code/"));
      await page.locator("[data-login]").click();
      const codeBody = (await (await codeResponse).json()) as { ok: boolean; code?: string };
      expect(codeBody.ok).toBe(true);
      expect(codeBody.code).toMatch(/^\d{6}$/);

      await page.locator("[data-acctcode]").fill(codeBody.code!);
      await page.locator("[data-logincode]").click();
      await expect(page.locator("[data-logout]")).toBeVisible();

      // 3) The order just placed is in the list.
      await expect(page.getByText(orderNumber)).toBeVisible();

      // 3a) The gift card's third home, after the footer link and the home
      // page block: the cabinet is where a returning customer looks for
      // "what else can I buy here", and it used to live only under «Наборы».
      const giftTile = page.locator(".acct__gift .gifttile");
      await expect(giftTile).toBeVisible();
      await expect(giftTile.getByRole("heading")).toHaveText(tr("Подарочная карта", lang.code));

      // 4) Profile save.
      await page.locator('[data-acctf="name"]').fill("E2E Тестов");
      await page.locator('[data-acctf="phone"]').fill("+372 5550001");
      await page.locator("[data-save]").click();
      await expect(page.locator("[data-save]")).toContainText("✓");

      // 5) Logout returns to the signed-out (email-entry) screen.
      await page.locator("[data-logout]").click();
      await expect(page.locator("[data-login]")).toBeVisible();
      await expect(page.locator("[data-logout]")).toHaveCount(0);
    });
  });
}
