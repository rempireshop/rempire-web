import { expect, test } from "@playwright/test";
import { ipHeaders, loginAsAdmin } from "./fixtures";

/**
 * «Подними скидку для салонов до 25 %», asked from «Обзор».
 *
 * set_pricing is a PATCH — the panel merges it over `S.pricingLoaded` and PUTs
 * the WHOLE merged object back (demoApply / srvPush in public/shop2/app.js).
 * `S.pricingLoaded` is only ever filled by the three cards that call
 * loadAdminPricing(): «Цены и баллы», «Доставка и оплата», and the goods
 * editor. The assistant is a floating button on every screen, and on «Обзор»
 * — the screen the panel opens on — those numbers have never been read. The
 * merge then ran over the BUILT-IN DEFAULTS, so one confirmed sentence wrote
 * «Партнёры и баллы» off, points back to 5 % and «списать» back to 30 % over
 * whatever Renat had saved. The journal's «Вернуть» restored the same
 * defaults, because `prev` was captured from them too.
 *
 * This drives the real panel against the real settings route and reads the
 * body that actually leaves the browser. The model is stubbed at the network
 * edge (the e2e server runs with no OPENAI_API_KEY); what is under test is
 * the panel.
 */
test.describe("the assistant's «скидка для салонов», asked from «Обзор»", () => {
  test.use({ extraHTTPHeaders: ipHeaders(191) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one viewport is enough — this is the panel's arithmetic, not its layout");
  });

  /* Not the defaults, and not one field of them: every number here differs
     from PRICING_DEFAULT in app.js, so anything the panel invents shows up. */
  const SAVED = {
    partnersOn: true,
    proDiscountPct: 15,
    proMinOrder: 50,
    loyalty: { enabled: true, earnPct: 8, redeemMaxPct: 45, minRedeem: 10 },
  };

  test("keeps every number the owner had saved and changes only the one he asked about", async ({ page }) => {
    test.setTimeout(90_000);
    await page.route("**/api/assistant/**", async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, v: 99, model: "stub" }) });
      }
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          reply: "Ставлю оптовую скидку 25 % — подтвердите, отменить можно в журнале.",
          product_ids: [], tab: "people",
          action: { type: "set_pricing", value: { proDiscountPct: 25 } },
        }),
      });
    });

    await loginAsAdmin(page);
    // the shop's own figures, saved before the panel is asked anything
    const was = await (await page.request.get("/api/admin/settings/")).json();
    const before = was.settings?.pricing ?? null;
    try {
      const wrote = await page.request.put("/api/admin/settings/", { data: { pricing: SAVED } });
      expect(wrote.ok()).toBe(true);
      // …and the panel is reloaded onto «Обзор», which never reads them
      await page.reload();
      await expect(page.locator('[data-admtab="orders"][aria-current]:visible').first()).toBeVisible();

      await page.locator(".adm-fab[data-admai]").click();
      await page.locator("[data-admq]").fill("подними скидку для салонов до 25 %");
      await page.locator("[data-admsend]").click();
      const answer = page.locator("[data-aians]");
      await expect(answer).toContainText("Ставлю оптовую скидку 25 %");

      /* The PUT waits on a GET first — «Применить» reads the saved numbers
         before merging (that is the fix this file holds), and the assistant
         has just asked /api/admin/upload/ whether pictures can go up
         (ensureMedia). Under `next dev` each is a first-hit compile, the
         settings GET behind it took 11.8 s in the run of 24.09.2026 and the
         PUT left 20 ms after the default 10 s. Room for that, not a retry. */
      const put = page.waitForRequest((r) => r.url().includes("/api/admin/settings/") && r.method() === "PUT", { timeout: 30_000 });
      await answer.locator(".adm-propose [data-admapply]").click();
      const sent = JSON.parse((await put).postData() || "{}") as { pricing?: typeof SAVED };

      expect(sent.pricing, "the panel PUT something that was not the pricing settings").toBeTruthy();
      expect(sent.pricing!.proDiscountPct, "the one number the owner asked about").toBe(25);
      expect(sent.pricing!.partnersOn, "«Партнёры и баллы» was switched off by a price change").toBe(true);
      expect(sent.pricing!.proMinOrder).toBe(50);
      expect(sent.pricing!.loyalty).toEqual(SAVED.loyalty);

      // and the shop really holds that, not just the request body
      const now = await (await page.request.get("/api/admin/settings/")).json();
      expect(now.settings.pricing).toMatchObject({ ...SAVED, proDiscountPct: 25 });
    } finally {
      /* The panel first: a PUT it has not sent yet must not land after the
         restore below. On 24.09.2026 it did — SAVED with 25 % stayed in the
         shop, and five tests in two later files (admin-lang-r20,
         admin-sections) failed on numbers this test had left behind. */
      await page.close();
      await page.request.put("/api/admin/settings/", { data: { pricing: before } });
    }
  });
});
