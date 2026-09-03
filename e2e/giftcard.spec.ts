import { expect, type Browser, test } from "@playwright/test";
import { E2E_ADMIN_PASSWORD } from "./env.mjs";
import { continueButton, freshEmail, ipHeaders, LANGS, payOrder, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

/** The e2e-only admin lookup (src/app/api/e2e/gift-card/route.ts), in its own
 *  throwaway browser context so it never touches the customer `page`'s
 *  cookies. Returns the code(s) issued for one order. */
async function giftCardsForOrder(
  browser: Browser,
  orderNumber: string,
): Promise<Array<{ code: string; amount: number; balance: number }>> {
  const ctx = await browser.newContext();
  const req = ctx.request;
  const login = await req.post("/api/admin/login/", { data: { password: E2E_ADMIN_PASSWORD } });
  expect(login.ok()).toBe(true);
  const lookup = await req.get(`/api/e2e/gift-card/?order=${orderNumber}`);
  expect(lookup.ok()).toBe(true);
  const body = (await lookup.json()) as { ok: boolean; cards: Array<{ code: string; amount: number; balance: number }> };
  expect(body.ok).toBe(true);
  await ctx.close();
  return body.cards;
}

/**
 * Gift card: buy one, pay, confirm (via the e2e-only admin lookup route —
 * see src/app/api/e2e/gift-card/route.ts for why that route has to exist)
 * that a real code was issued, then redeem it on a second order and see the
 * discount. Desktop only — see docs/testing.md.
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "functional spec — desktop project only, see docs/testing.md");
});

for (const [i, lang] of LANGS.entries()) {
  test.describe(`gift card — ${lang.code}`, () => {
    test.use({ extraHTTPHeaders: ipHeaders(60 + i) });

    test("buying a gift card issues a real code, which then discounts a second order", async ({ page, browser }) => {
      const buyerEmail = freshEmail(`gift-${lang.code}`);

      // 1) Buy a 25 € gift card.
      await page.goto(shopUrl(lang.seg, "/gift/"));
      await waitForScreen(page, "gift");
      await page.locator('[data-giftamt="25"]').click();
      await page.locator('[data-giftf="name"]').fill("Mari");
      await page.locator('[data-giftf="message"]').fill("С днём рождения!");
      await page.locator('[data-addgift="25"]').click();
      await expect(page.getByRole("status")).toBeVisible();

      await page.goto(shopUrl(lang.seg, "/checkout/"));
      await waitForScreen(page, "checkout");
      const giftOrderNumber = await payOrder(page, buyerEmail, "paid");

      // 2) (API) confirm a real code was issued for that order.
      const cards = await giftCardsForOrder(browser, giftOrderNumber);
      expect(cards).toHaveLength(1);
      expect(cards[0].code).toMatch(/^RMP-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(cards[0].amount).toBe(25);
      expect(cards[0].balance).toBe(25);
      const giftCode = cards[0].code;

      // 3) Redeem it on a second order — the discount shows in the summary.
      await page.goto(shopUrl(lang.seg, `/p/${PRODUCT.id}/`));
      await waitForScreen(page, "product");
      await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
      await expect(page.getByRole("status")).toBeVisible();
      await page.goto(shopUrl(lang.seg, "/checkout/"));
      await waitForScreen(page, "checkout");
      await page.locator("[data-email]").fill(freshEmail(`redeem-${lang.code}`));
      await continueButton(page, 2).click();

      await page.locator("[data-promo]").fill(giftCode);
      await page.locator("[data-applypromo]").click();
      await expect(page.locator("[data-giftoff]")).toBeVisible();
    });
  });
}
