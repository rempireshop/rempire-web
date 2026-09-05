import { expect, type Browser, type Page, test } from "@playwright/test";
import { E2E_ADMIN_PASSWORD } from "./env.mjs";
import {
  continueButton,
  freshEmail,
  functionalProject,
  ipHeaders,
  LANGS,
  loginAsAdmin,
  openSummary,
  payButton,
  PRODUCT,
  shopUrl,
  waitForScreen,
} from "./fixtures";

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
 * The gift-cards-only checkout: step 2 is «Получатель», not «Доставка».
 *
 * fixtures.ts's payOrder() cannot be used here — it fills a courier address,
 * and on this checkout none of those fields exist at all. That is the point of
 * the feature, so the assertions on the way through are part of the test.
 */
async function payDigitalOrder(page: Page, buyerEmail: string, recipientEmail: string): Promise<string> {
  await page.locator("[data-email]").fill(buyerEmail);
  await continueButton(page, 2).click();

  // nothing about a parcel survives: no country, no method, no parcel point,
  // no address
  await expect(page.locator("[data-country]")).toHaveCount(0);
  await expect(page.locator('input[data-dm="courier"]')).toHaveCount(0);
  await expect(page.locator('input[data-dm="parcel"]')).toHaveCount(0);
  await expect(page.locator("[data-pointopen]")).toHaveCount(0);
  await expect(page.locator('[data-shipf="addr"]')).toHaveCount(0);
  await expect(page.locator('[data-shipf="zip"]')).toHaveCount(0);

  // «отправить мне на почту, а не получателю» — on by default
  const toMe = page.locator("[data-gifttome]");
  await expect(toMe).toBeChecked();
  await toMe.uncheck();

  await page.locator('[data-giftto="email"]').fill(recipientEmail);
  await page.locator('[data-giftto="name"]').fill("Mari Tamm");
  await page.locator('[data-giftto="message"]').fill("Поздравляю!");
  // the buyer's own name still signs the card
  await page.locator('[data-shipf="name"]').fill("E2E Buyer");

  await continueButton(page, 3).click();
  await page.locator('input[data-paym="1"]').check();
  await payButton(page).click();
  await page.waitForURL(/\/api\/payments\/mock\//);
  await page.getByRole("link", { name: "Оплатить" }).click();
  await page.waitForURL(/\/shop2.*\/done\/\?.*s=paid/);
  const number = new URL(page.url()).searchParams.get("n");
  if (!number) throw new Error("payDigitalOrder: no order number (?n=) in the receipt URL");
  return number;
}

/**
 * Gift card: buy one, pay, confirm (via the e2e-only admin lookup route —
 * see src/app/api/e2e/gift-card/route.ts for why that route has to exist)
 * that a real code was issued, then redeem it on a second order and see the
 * discount. Desktop only — see docs/testing.md.
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(!functionalProject(testInfo), "functional spec — desktop and mobile-safari projects only, see docs/testing.md");
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
      const giftOrderNumber = await payDigitalOrder(page, buyerEmail, freshEmail(`to-${lang.code}`));

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

      await openSummary(page); // folded on a phone
      await page.locator("[data-promo]").fill(giftCode);
      await page.locator("[data-applypromo]").click();
      await expect(page.locator("[data-giftoff]")).toBeVisible();
    });
  });
}

/**
 * «Электронная доставка» end to end: a basket of nothing but gift cards pays
 * no delivery, asks who the card is for instead of where the parcel goes, and
 * lands on a receipt that offers the printable card.
 *
 * Russian only. This is a checkout-shape and a file-serving test, not an i18n
 * one — the three languages of the recipient form are covered by the dictionary
 * (`node tools/i18n-gaps.mjs`), the same reasoning as «checkout — pickup» in
 * checkout.spec.ts (docs/testing.md).
 */
test.describe("gift card — digital checkout and the printable card", () => {
  test.use({ extraHTTPHeaders: ipHeaders(63) });

  test("an all-gift-card order skips delivery and hands back a PDF", async ({ page, browser }) => {
    const buyerEmail = freshEmail("digital-buyer");
    const recipientEmail = freshEmail("digital-to");

    await page.goto(shopUrl("", "/gift/"));
    await waitForScreen(page, "gift");
    await page.locator('[data-giftamt="50"]').click();
    await page.locator('[data-addgift="50"]').click();
    await expect(page.getByRole("status")).toBeVisible();

    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");

    // step 2 is «Получатель» — its header says so before it is even opened
    await expect(page.locator('button.costep__head[data-step="2"] .costep__t')).toHaveText("Получатель");

    // the summary has no delivery line to pay: one row saying how it travels
    const rule = page.locator(".cosum__row--rule");
    await expect(rule).toHaveText(/Электронная доставка/);
    await expect(rule).not.toHaveText(/Доставка —/);
    // …and the total is the card's face value, nothing added
    await expect(page.locator(".cosum__row--tot .num")).toHaveText("50 €");

    const number = await payDigitalOrder(page, buyerEmail, recipientEmail);
    await waitForScreen(page, "done");
    await expect(page.locator("h1")).toHaveText("Заказ оплачен");

    // the receipt offers the card as a file
    const link = page.locator("[data-giftpdf]");
    await expect(link).toHaveCount(1);
    await expect(link).toContainText("Скачать подарочную карту (PDF)");
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^\/api\/giftcards\/RMP-[A-Z0-9]{4}-[A-Z0-9]{4}\/pdf\/\?t=[\w-]+$/);

    // and the file really is a PDF, fetched with the page's own request context
    const pdf = await page.request.get(href as string);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    const bytes = await pdf.body();
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(3000);

    // a tampered token opens nothing
    const bad = await page.request.get((href as string).replace(/t=.*$/, "t=notatoken"));
    expect(bad.status()).toBe(404);

    /* The owner's side of the same order: «Электронная доставка» where the
       parcel line used to be, and the card's own PDF next to it. A separate
       context so the customer's cookies stay untouched. */
    const ctx = await browser.newContext({ extraHTTPHeaders: ipHeaders(63) });
    const admin = await ctx.newPage();
    await loginAsAdmin(admin);
    // [data-admtab="orders"] is on the sidebar tab AND the phone bar — see
    // fixtures.ts loginAsAdmin's own comment; :visible + .first() picks one
    await admin.locator('[data-admtab="orders"][aria-current]:visible').first().click();
    const row = admin.locator(`[data-admorder]:has-text("${number}")`).first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(admin.locator(".adm-head__kicker--code")).toContainText(number);
    // .adm-kv is the card's «Покупатель» block as well as its «Доставка» one
    const delivery = admin.locator(".adm-kv").filter({ hasText: "Электронная доставка" });
    await expect(delivery).toHaveCount(1);
    await expect(delivery).toContainText(recipientEmail);
    // …and no delivery row in «Состав»: there is no parcel to charge for
    await expect(admin.locator(".adm-list")).not.toContainText("бесплатно");
    const adminLink = admin.locator("[data-giftpdf]").first();
    await expect(adminLink).toBeVisible();
    await expect(adminLink).toContainText("Карта PDF");
    await ctx.close();
  });
});
