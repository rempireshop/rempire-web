import { expect, test } from "@playwright/test";
import {
  adminSection, freshEmail, ipHeaders, loginAsAdmin, payOrder, PRODUCT, shopUrl, waitForScreen,
} from "./fixtures";

/**
 * «Клиенты» → a customer's card: what he bought, what he wrote, and the way
 * back.
 *
 * Dim, 10.09.2026, two findings on one screen. §6: «the card says the
 * customer made 2 orders and spent X, but shows no orders, no analytics,
 * nothing else» — so GET /api/admin/customers/<id> now carries the orders
 * under that e-mail, four facts drawn from them and the customer's reviews,
 * and the card draws all three (app.js admCustFactsHTML, admCustOrdersHTML,
 * admCustReviewsHTML). §7: on a card, the «Отзывы» sub-tab threw him out to
 * the moderation queue when he expected this customer's reviews — the two
 * sub-tabs are not drawn on a card any more; the card is its own page with
 * «← Все клиенты», and its reviews live on it, with «Опубликовать» right
 * there (the queue's own reversible edit).
 *
 * The one thing this file is strict about beyond the sections: an order
 * opened from the card opens the ordinary order card over it, and both its
 * «← К клиенту» and the browser's Back land on THIS customer again — never
 * on «Заказы» (app.js: the data-admorder handler keeps the tab, admLayers
 * closes the order first).
 */
test.describe("admin — the customer card", () => {
  /* One address per project (and per repeat), not one for the file:
     POST /api/reviews/ allows three an hour from one address, and this file
     files one on every run. 226+ is free — nothing else in the suite goes
     above 220 + a few repeats (admin-back.spec.ts). */
  test.use({
    extraHTTPHeaders: async ({}, use, testInfo) => {
      await use(ipHeaders(226 + (testInfo.project.name === "mobile" ? 5 : 0) + testInfo.repeatEachIndex));
    },
  });

  test("orders, facts and reviews are on the card; an order opens over it and Back returns to it", async ({ page }) => {
    test.setTimeout(180_000);

    // ---- a paid order under a fresh address — the checkout signs it «E2E Buyer»
    const email = freshEmail("custcard");
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    const number = await payOrder(page, email, "paid");

    await loginAsAdmin(page);

    // ---- a customer row for that address: a guest checkout leaves none, so
    // the panel's own create-by-e-mail makes one — retail, which sends no letter
    const made = await page.request.post("/api/admin/customers/", { data: { email, tier: "retail" } });
    expect(made.ok(), "POST /api/admin/customers/ refused the retail row").toBe(true);

    // ---- a review, signed the way the checkout was signed — pending
    const reviewText = `Отличный шампунь, беру уже не первый раз ${Date.now()}.`;
    const filed = await page.request.post("/api/reviews/", {
      data: { product: PRODUCT.id, rating: 5, name: "E2E Buyer", text: reviewText, lang: "RU", consent: true },
    });
    expect(filed.ok(), "the review could not be filed").toBe(true);

    let reviewId = "";
    try {
      // ---- the list: the queue's tab is there, one tap away ----------------
      await adminSection(page, "people");
      await expect(page.locator('.adm-tab[data-admtab="reviews"]'), "the «Отзывы» tab is missing from the list").toBeVisible();
      await page.locator("[data-admcustq]").fill(email);
      await page.locator("[data-admcustopen]").first().click();
      await expect(page.locator("[data-admcustclose]")).toBeVisible();

      // ---- the card is its own page: no sub-tabs on it --------------------
      await expect(page.locator('.adm-tab[data-admtab="reviews"]'), "the «Отзывы» sub-tab is still on the card").toHaveCount(0);
      await expect(page.locator('.adm-tab[data-admtab="people"]'), "the «Все клиенты» sub-tab is still on the card").toHaveCount(0);

      // ---- the order, with the same chip the orders list draws ------------
      const orderRow = page.locator(`[data-admorder]:has-text("${number}")`).first();
      await expect(orderRow, "the paid order is not on the card").toBeVisible();
      await expect(orderRow.locator(".adm-badge")).toHaveText("Оплачен");

      // ---- the facts: plain rows, no chart --------------------------------
      await expect(page.getByText("Первый заказ")).toBeVisible();
      await expect(page.getByText("Средний чек")).toBeVisible();
      const brands = page.locator(".adm-row", { hasText: "Любимые бренды" });
      await expect(brands).toBeVisible();
      await expect(brands).toContainText(PRODUCT.brand);

      // ---- the review, matched by the name it was signed with -------------
      await expect(page.getByText("Отзывы клиента")).toBeVisible();
      const reviewRow = page.locator(".adm-row", { hasText: reviewText }).first();
      await expect(reviewRow, "the review signed with the checkout's name is not on the card").toBeVisible();
      await expect(reviewRow.locator(".adm-badge")).toHaveText("Новый");

      // ---- the order card opens over the customer's; Back returns to that
      // customer, not to «Заказы» -------------------------------------------
      await orderRow.click();
      await expect(page.locator('[data-admorder=""]')).toBeVisible();
      await expect(page.locator('[data-admorder=""]'), "the order card's way back does not name the customer").toContainText("К клиенту");
      await expect(page.locator("[data-admcustclose]")).toHaveCount(0);
      await page.goBack();
      await expect(page.locator('body[data-screen="admin"]'), "Back left the admin altogether").toBeAttached();
      await expect(page.locator('[data-admorder=""]'), "Back did not close the order card").toHaveCount(0);
      await expect(page.locator("[data-admcustclose]"), "Back did not return to the customer card").toBeVisible();
      await expect(page.locator(`[data-admorder]:has-text("${number}")`).first(), "the customer's orders are gone after Back").toBeVisible();
      await expect(page.locator("[data-admorderq]"), "Back landed on the orders list instead of the customer").toHaveCount(0);

      // …and the same through the card's own «← К клиенту»
      await page.locator(`[data-admorder]:has-text("${number}")`).first().click();
      await expect(page.locator('[data-admorder=""]')).toBeVisible();
      await page.locator('[data-admorder=""]').click();
      await expect(page.locator("[data-admcustclose]"), "«← К клиенту» did not return to the customer card").toBeVisible();

      // ---- «Опубликовать» from the card: the queue's own reversible edit,
      // without leaving the card ---------------------------------------------
      const row = page.locator(".adm-row", { hasText: reviewText }).first();
      await row.locator('[data-admcustrev$=":approved"]').click();
      await expect(page.getByRole("status")).toContainText("Отзыв опубликован");
      await expect(page.locator(".adm-toast__undo"), "no «Отменить» on the toast").toBeVisible();
      await expect(page.locator("[data-admcustclose]"), "publishing left the card").toBeVisible();
      await expect(row.locator(".adm-badge")).toHaveText("Опубликован");
      await expect.poll(async () => {
        const res = await page.request.get("/api/admin/reviews/?status=approved");
        const hit = ((await res.json()).reviews as Array<{ id: string; text: string }>).find((r) => r.text === reviewText);
        if (hit) reviewId = hit.id;
        return !!hit;
      }, { timeout: 10_000, message: "«Опубликовать» never reached the server" }).toBe(true);

      // ---- Back closes the card; the list and its «Отзывы» tab are back ----
      await page.goBack();
      await expect(page.locator('body[data-screen="admin"]'), "Back left the admin altogether").toBeAttached();
      await expect(page.locator("[data-admcustclose]"), "Back did not close the customer card").toHaveCount(0);
      await expect(page.locator("[data-admcustq]"), "the customers list did not come back").toBeVisible();
      await expect(page.locator('.adm-tab[data-admtab="reviews"]')).toBeVisible();
    } finally {
      /* A published review on PRODUCT changes what the storefront shows, and
         e2e/product.spec.ts expects that product's reviews block to start
         empty. Whatever happened above, the review is taken down again. */
      if (reviewId) await page.request.patch("/api/admin/reviews/", { data: { id: reviewId, status: "rejected" } });
    }
  });
});
