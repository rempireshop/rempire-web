import { expect, type Page, test } from "@playwright/test";
import { freshEmail, ipHeaders, loginAsAdmin, PRODUCT_2, shopUrl } from "./fixtures";

/**
 * The shop, open in another tab of the owner's browser, shows a panel change
 * without being reloaded.
 *
 * Dim, 26.09.2026 (/test people-reviews, people-points, people-remove-partner
 * — «works but takes time»). Every request in those flows answers in tens of
 * milliseconds; the time was in the copies the shop kept — a product's reviews
 * for as long as its tab stayed open, the profile until the tab was brought
 * back to the front. Measured the same day on this suite's server, same
 * browser, shop tab not reloaded: a published review never appeared (48 s
 * with reloads), the salon price stayed for good. Now the panel tells the
 * shop's tabs when a change has landed (shopPoke in public/shop2/app.js):
 * ~0.2 s for both.
 *
 * Two pages in one context: one browser, its localStorage shared, the admin
 * and the customer signed in side by side — the way the owner tests.
 */
test.describe("admin → the shop's open tab, without a reload", () => {
  test.use({ extraHTTPHeaders: ipHeaders(239) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one viewport: this is about the tabs, not the layout");
  });

  /** A signed-in customer in this context, by the suite's own code hook. */
  async function signIn(page: Page, email: string): Promise<void> {
    const code = (await (await page.request.post("/api/account/code/", { data: { email, lang: "ru" } })).json()).code;
    expect(code, "E2E_EXPOSE_LOGIN_CODE is off on this server").toBeTruthy();
    expect((await page.request.post("/api/account/login/", { data: { email, code, lang: "ru" } })).ok()).toBe(true);
  }

  test("a review published in the panel appears on the product page already open", async ({ context, page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    const shop = await context.newPage();
    await shop.goto(shopUrl("", `/p/${PRODUCT_2.id}/`));
    await expect(shop.locator(".revs__none, .rev--db").first()).toBeAttached({ timeout: 20_000 });

    const name = `Poke ${Date.now() % 1_000_000}`;
    const posted = await page.request.post("/api/reviews/", {
      data: { product: PRODUCT_2.id, name, rating: 5, text: "Проверка: отзыв виден в открытой вкладке", lang: "ru", consent: true },
    });
    expect(posted.ok()).toBe(true);

    await page.locator('[data-admtab="people"][aria-current]:visible').first().click();
    await page.locator('[data-admtab="reviews"]').first().click();
    const row = page.locator(".adm-rev", { hasText: name }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.locator(".adm-rev__pub").click();

    // the shop tab was never reloaded
    await expect(shop.locator(".rev--db", { hasText: name }), "the open product page kept its old reviews").toBeAttached({ timeout: 5_000 });

    // …and hidden again, it leaves the same page
    await page.locator('[data-admrevfilter="approved"]').click();
    const pub = page.locator(".adm-rev", { hasText: name }).first();
    await expect(pub).toBeVisible({ timeout: 20_000 });
    await pub.locator(".adm-rev__hide").click();
    await expect(shop.locator(".rev--db", { hasText: name })).toHaveCount(0, { timeout: 5_000 });
  });

  test("«Розница» on the card takes the salon price off the product page already open", async ({ context, page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    const saved = (await (await page.request.get("/api/admin/settings/")).json()).settings.pricing ?? null;
    const email = freshEmail("poke-partner");
    try {
      await page.request.put("/api/admin/settings/", {
        data: { pricing: { ...(saved || {}), partnersOn: true, proDiscountPct: 20, proMinOrder: 0 } },
      });
      await signIn(page, email);
      const list = (await (await page.request.get("/api/admin/customers/")).json()).customers as Array<{ id: string; email: string }>;
      const id = list.find((c) => c.email === email)!.id;

      // the retail price first, as this shopper sees it before the switch
      const shop = await context.newPage();
      await shop.goto(shopUrl("", `/p/${PRODUCT_2.id}/`));
      const price = shop.locator("[data-price]").first();
      await expect(price).toHaveText(/\d/, { timeout: 15_000 });
      const retail = ((await price.textContent()) || "").trim();

      expect((await page.request.patch(`/api/admin/customers/${id}/`, { data: { tier: "pro" } })).ok()).toBe(true);
      await shop.reload();
      await expect(price, "the partner's salon price never showed").not.toHaveText(retail, { timeout: 15_000 });

      await page.reload();
      await page.locator('[data-admtab="people"][aria-current]:visible').first().click();
      await page.locator("[data-admcustq]").first().fill(email);
      await page.locator(`[data-admcustopen="${id}"]`).first().click();
      await page.locator('[data-admcusttierset="retail"]').click();

      await expect(price, "the open shop tab kept the salon price").toHaveText(retail, { timeout: 5_000 });
    } finally {
      await page.request.put("/api/admin/settings/", { data: { pricing: saved ?? {} } });
    }
  });
});
