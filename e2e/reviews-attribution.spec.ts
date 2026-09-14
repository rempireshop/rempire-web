import { expect, test } from "@playwright/test";
import { adminSection, freshEmail, ipHeaders, loginAsAdmin, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

/**
 * Whose review is whose — the two screens that now say so.
 *
 * Renat, 14.09.2026: «Reviews do not seem to be connected to clients anymore
 * — I can see reviews but those do not seem to be to any client.» He is
 * reading «Клиенты → Отзывы», and he was right about that screen: it showed a
 * name, a date and a language for every review alike, so a review the shop
 * can prove an owner for looked exactly like one it cannot. The fix is not a
 * new matching rule — matching a review to a person by their NAME is what
 * leaked two of Dim's own mailboxes into each other on 13.09 — it is telling
 * the truth on both ends of the thing:
 *
 *   the shop   the review form says whether this review will have an owner,
 *              and shows the signed-in shopper the address it will carry;
 *   the panel  the queue's grey line carries that address, or «без аккаунта»
 *              when the review belongs to nobody.
 *
 * Both reviews below are filed against PRODUCT and left `pending`, so the
 * storefront is unchanged for every other spec (e2e/product.spec.ts wants
 * that block empty).
 */
test.describe("reviews — who they belong to", () => {
  /* Two reviews land from one address per run. POST /api/reviews/ allows
     three an hour, so one octet per project is enough; 246/247 are free
     (admin-orders-r16 holds 241–244). */
  test.use({
    extraHTTPHeaders: async ({}, use, testInfo) => {
      await use(ipHeaders(246 + (testInfo.project.name === "mobile" ? 1 : 0) + testInfo.repeatEachIndex * 2));
    },
  });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop" && testInfo.project.name !== "mobile",
      "the shop half is engine-independent and the panel is Chromium-only — desktop and the 375-px phone are the two that matter",
    );
  });

  test("the form names the account it will file under, and the queue says which reviews have one", async ({ context, page }) => {
    test.setTimeout(120_000);

    const email = freshEmail("revattr");
    const mine = `Мой отзыв из кабинета, двадцать знаков и больше ${Date.now()}.`;
    const guest = `Отзыв без входа, тоже длиннее двадцати знаков ${Date.now()}.`;

    /* ---- signed out: the form invites, it does not warn -------------------
       A guest's review is welcome; what the shop must not do is tell them
       their words are about to be filed under nobody. */
    const shopper = await context.newPage();
    try {
      await shopper.goto(shopUrl("", `/p/${PRODUCT.id}/`));
      await waitForScreen(shopper, "product");
      const acc = shopper.locator("details.acc", { hasText: "Отзыв" }).first();
      await acc.locator("summary").click();
      await acc.locator("[data-revopen]").click();
      await expect(acc.locator(".revadd__who")).toHaveText(
        "Войдите в кабинет — и отзыв сохраним за вашим аккаунтом.",
      );

      // that guest review, filed the way a guest files one: no session on it
      const filedGuest = await shopper.request.post("/api/reviews/", {
        data: { product: PRODUCT.id, rating: 4, name: "Гость", text: guest, lang: "RU", consent: true },
      });
      expect(filedGuest.ok(), "the guest review could not be filed").toBe(true);

      /* ---- signed in: the address, in its own element --------------------
         translateTree() rewrites whole text nodes, so the sentence and the
         mailbox cannot share one — hence the <span> this reads. */
      await shopper.goto(shopUrl("", "/account/"));
      await waitForScreen(shopper, "account");
      await shopper.locator("[data-email]").fill(email);
      const codeRes = shopper.waitForResponse((r) => r.url().includes("/api/account/code/"));
      await shopper.locator("[data-login]").click();
      const code = (await (await codeRes).json()).code as string;
      expect(code, "the e2e login-code hook did not answer").toMatch(/^\d{6}$/);
      await shopper.locator("[data-acctcode]").fill(code);
      await shopper.locator("[data-logincode]").click();
      await expect(shopper.locator("[data-logout]")).toBeVisible();

      await shopper.goto(shopUrl("", `/p/${PRODUCT.id}/`));
      await waitForScreen(shopper, "product");
      const acc2 = shopper.locator("details.acc", { hasText: "Отзыв" }).first();
      await acc2.locator("summary").click();
      await acc2.locator("[data-revopen]").click();
      const who = acc2.locator(".revadd__who");
      await expect(who).toContainText("Отзыв сохраним за вашим аккаунтом");
      await expect(who.locator(".num"), "the address is not in its own element").toHaveText(email);

      // …and filed through the form itself, so the session is what stamps it
      await acc2.locator('[data-revf="name"]').fill("Не то имя, что в кабинете");
      await acc2.locator('[role="radio"][data-revstar="5"]').click();
      await acc2.locator('[data-revf="text"]').fill(mine);
      await acc2.locator('[data-revf="consent"]').check();
      await acc2.locator("[data-revsend]").click();
      await expect(acc2.getByText("Спасибо! Отзыв отправлен — он появится на странице после проверки.")).toBeVisible();
    } finally {
      await shopper.close();
    }

    /* ---- the queue: one line, two different answers --------------------- */
    await loginAsAdmin(page);
    await adminSection(page, "people", "reviews");

    const mineRow = page.locator(".adm-row", { hasText: mine }).first();
    await expect(mineRow, "the signed-in review is not in «Новые»").toBeVisible();
    await expect(mineRow.locator(".adm-row__sub")).toContainText(email);

    const guestRow = page.locator(".adm-row", { hasText: guest }).first();
    await expect(guestRow, "the guest review is not in «Новые»").toBeVisible();
    await expect(guestRow.locator(".adm-row__sub")).toContainText("без аккаунта");
    await expect(
      guestRow.locator(".adm-row__sub"),
      "a review with no account still showed an address",
    ).not.toContainText("@");

    /* The panel is phone-first: nothing on this row may push the page
       sideways, whatever the address on it is. */
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the review queue scrolls sideways").toBeLessThanOrEqual(1);
  });
});
