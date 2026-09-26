import { expect, type Page, test } from "@playwright/test";
import {
  adminSection, cardBack, freshEmail, ipHeaders, loginAsAdmin, payOrder, PRODUCT_2, shopUrl, waitForScreen,
} from "./fixtures";
import { carrierPrice } from "@/lib/shipping/country-prices";

/* What the Latvian DPD box charges when it is empty: Montonio's own price for
   that carrier on that route. Read from the shop's own tariff table, never
   typed here — the price list is re-cut every season, and a number written
   into a test goes stale silently, which is what happened to the one this
   replaces. */
const LV_DPD = carrierPrice("dpd", "LV", "parcel")!;

/**
 * The second admin sweep (docs/audit/2026-09-06-admin-qa.md): the corners the
 * first sweep walked past, each one a thing the owner would have hit within a
 * week of real use.
 *
 *   - «Отменить» on the toast after «Отменить заказ» really puts the order
 *     back to paid (it used to say so and leave it cancelled — the PATCH went
 *     through the mark-paid-by-hand branch, which treats paid as a floor);
 *   - «Изменить статус вручную» asks first: a refund is money going back,
 *     «оплачен» by hand is money the shop says it has;
 *   - the delivery tariffs' «Вернуть значения по умолчанию» asks first, and
 *     «Заполнить по тарифам Montonio» fills the boxes without changing what a
 *     shopper is charged until «Сохранить»;
 *   - «Сохранить» on an untouched banner says «Изменений нет»;
 *   - a background write that the server refused says so instead of
 *     «Сохранено ✓»;
 *   - Enter is the button in the panel's small forms and does not double a
 *     login.
 *
 * The order-card test runs on desktop AND mobile — the confirm card is a
 * sheet on a phone, and the phone is the owner's machine; everything else is
 * desktop only, one write per action. Every describe has its own fake IP:
 * admin login is 5/min (docs/testing.md).
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === "tablet" || testInfo.project.name === "mobile-safari", "admin sweep — desktop and mobile projects only");
});

/** A quick, throwaway paid order (the same recipe admin.spec.ts uses). */
async function placeOrder(page: Page, email: string): Promise<string> {
  await page.goto(shopUrl("", `/p/${PRODUCT_2.id}/`));
  await waitForScreen(page, "product");
  await page.locator(`.pdp__add[data-add="${PRODUCT_2.id}"]`).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto(shopUrl("", "/checkout/"));
  await waitForScreen(page, "checkout");
  return payOrder(page, email, "paid");
}

function ordersTab(page: Page) {
  return page.locator('[data-admtab="orders"][aria-current]:visible').first();
}

/** Opens one page of «Настройки» on either viewport (the section sits behind «Ещё» on a phone). */
async function openSettings(page: Page, sub: string): Promise<void> {
  await adminSection(page, "setup");
  const back = cardBack(page, "[data-admsetback]", "Настройки");
  if (await back.count()) await back.click();
  await page.locator(`[data-admsetpage="${sub}"]`).click();
  await expect(cardBack(page, "[data-admsetback]", "Настройки")).toBeVisible();
}

async function openCustomers(page: Page): Promise<void> {
  await adminSection(page, "people");
  await expect(page.locator("h1.adm-h1")).toHaveText("Клиенты");
}

test.describe("admin sweep 2 — the order card", () => {
  test.use({ extraHTTPHeaders: ipHeaders(190) });

  test("«Отменить заказ» is undone for real, and «возврат» / «оплачен» by hand ask first", async ({ page }) => {
    test.setTimeout(120_000);
    const number = await placeOrder(page, freshEmail("sweep2-card"));
    await loginAsAdmin(page);
    await ordersTab(page).click();
    await page.locator(`[data-admorder]:has-text("${number}")`).first().click();
    await expect(page.locator(".adm-head__kicker--code")).toContainText(number);
    const order = async () => (await (await page.request.get(`/api/admin/orders/${number}/`)).json()).order;
    const status = async () => (await order()).status as string;
    const settledAt = (await order()).payment.at as string;
    expect(settledAt).toBeTruthy();

    /* «Отменить заказ» → the card → «Отменить» on the toast. The undo used to
       answer ok and change nothing: the order stayed cancelled while the
       journal line disappeared. */
    await page.locator("[data-admordermore]:visible").first().click();   // 1a: the rare actions are in «⋯»
    await page.locator("[data-admordercancel]").click();
    await expect(page.locator(".adm-confirm__t")).toHaveText("Отменить заказ?");
    await page.locator("[data-admapply]").click();
    await expect(page.getByRole("status")).toContainText(`${number} отменён`);
    await expect.poll(status).toBe("cancelled");
    await page.locator("[data-admtoastundo]").click();
    await expect(page.getByRole("status")).toContainText("Отменено");
    await expect.poll(status, { message: "the toast's «Отменить» did not put the cancelled order back to paid" }).toBe("paid");
    await expect(page.locator(".adm-badge--big")).toHaveText("Оплачен");
    // the payment record is the one the money arrived with, untouched by the round trip
    expect((await order()).payment.at).toBe(settledAt);

    /* «Изменить статус вручную: возврат» — money going back, so it asks; «Отмена» leaves everything. */
    await page.locator("[data-admordermore]:visible").first().click();   // 1a: the rare actions are in «⋯»
    await page.locator('[data-admstatus="refunded"]').click();
    await expect(page.locator(".adm-confirm__t")).toHaveText("Оформить возврат?");
    await expect(page.locator(".adm-confirm__d")).toContainText(number);
    await page.locator("[data-admcancel]").click();
    await expect(page.locator(".adm-confirm")).toHaveCount(0);
    expect(await status()).toBe("paid");
    await page.locator("[data-admordermore]:visible").first().click();   // 1a: the rare actions are in «⋯»
    await page.locator('[data-admstatus="refunded"]').click();
    await page.locator("[data-admapply]").click();
    await expect(page.getByRole("status")).toContainText("Сохранено");
    await expect.poll(status).toBe("refunded");
    await expect(page.locator(".adm-badge--big")).toHaveText("Возврат");

    /* …and «оплачен» on a refunded order is the step back — the card says the
       money is left alone (the payment record proves it) and that the goods
       the refund put back on the shelf are taken off it again. */
    await page.locator("[data-admordermore]:visible").first().click();   // 1a: the rare actions are in «⋯»
    await page.locator('[data-admstatus="paid"]').click();
    await expect(page.locator(".adm-confirm__t")).toHaveText("Отметить оплаченным?");
    await expect(page.locator(".adm-confirm__d")).toContainText("Деньги не трогаем");
    await page.locator("[data-admapply]").click();
    await expect.poll(status).toBe("paid");
    await expect(page.locator(".adm-badge--big")).toHaveText("Оплачен");
    expect((await order()).payment.at).toBe(settledAt);
  });
});

test.describe("admin sweep 2 — the orders list", () => {
  test.use({ extraHTTPHeaders: ipHeaders(191) });

  test("the search box finds an order by the customer's e-mail", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one viewport is enough for a filter");
    const email = freshEmail("sweep2-search");
    const number = await placeOrder(page, email);
    await loginAsAdmin(page);
    await ordersTab(page).click();
    await expect(page.locator("[data-admorderq]")).toHaveAttribute("placeholder", /почта/);
    await page.locator("[data-admorderq]").fill(email);
    await expect(page.locator("#orderlist [data-admorder]")).toHaveCount(1);
    await expect(page.locator("#orderlist")).toContainText(number);
    await page.locator("[data-admorderq]").fill("nobody-" + email);
    /* «Таких заказов нет» is the empty CHIP; a search that found nothing says
       what it looked at instead (17.09.2026, admOrderEmptyHTML in app.js) —
       the four fields listOrders() matches on, so a phone number spelt with
       spaces reads as a second way to spell it and not as a missing order. */
    await expect(page.locator("#orderlist")).toContainText("Ничего не нашли.");
    await expect(page.locator("#orderlist")).toContainText("номеру заказа, имени, телефону и почте");
  });
});

test.describe("admin sweep 2 — delivery tariffs", () => {
  test.use({ extraHTTPHeaders: ipHeaders(192) });

  /* 1a (25.09.2026, q37): every price saves when its box is left, and both
     whole-table buttons act at once — no confirm card, «Вернуть» on the toast
     and in the journal is the way back. */
  test("«Везде взять цены Montonio» empties the boxes at once, and «Вернуть» takes it back", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one write per action is enough");
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    const rules = async () => (await (await page.request.get("/api/admin/settings/")).json()).settings.shipping_rules ?? null;
    const original = await rules();
    try {
      await openSettings(page, "delivery");
      const lv = page.locator('[data-shiprule="c:dpd:LV"]');
      await expect(lv).toBeVisible();

      /* A price of the owner's own, so there is something to clear. 6,49 € is
         well above Montonio's own price for a Latvian DPD locker, so nothing
         holds it back: it saves the moment the box is left. */
      await lv.fill("6,49");
      await lv.press("Tab");
      await expect(page.getByRole("status")).toContainText("Тарифы доставки сохранены", { timeout: 15_000 });
      await expect(page.locator(".adm-confirm")).toHaveCount(0);
      await page.locator("[data-closetoast]").click();
      await expect.poll(async () => Number((await rules())?.carriers?.dpd?.LV)).toBe(6.49);

      /* The line under the box is the way back: it names the price the box
         would charge if it were empty, and one tap empties it — saved. */
      await expect(page.locator('[data-shipclear="c:dpd:LV"]'))
        .toContainText(LV_DPD.toFixed(2).replace(".", ","));
      await page.locator('[data-shipclear="c:dpd:LV"]').click();
      await expect(lv).toHaveValue("");
      await expect.poll(async () => (await rules())?.carriers?.dpd?.LV,
        { timeout: 20_000, message: "«вернуть» under the box did not reach the shop" }).toBeUndefined();
      await page.locator("[data-closetoast]").click();

      // …and «Везде взять цены Montonio» does the same for the whole table, at once
      await lv.fill("6,49");
      await lv.press("Tab");
      await expect.poll(async () => Number((await rules())?.carriers?.dpd?.LV)).toBe(6.49);
      await page.locator("[data-closetoast]").click();
      await page.locator("[data-admshipmontonio]").click();
      await expect(page.getByRole("status")).toContainText("В таблице цены Montonio", { timeout: 15_000 });
      await expect(page.locator(".adm-confirm")).toHaveCount(0);
      await expect(lv).toHaveValue("");
      /* Nothing, not Montonio's number written down. Since r22 (17.09.2026,
         cleanShippingRules() in src/lib/shipping.ts) the row stores the
         owner's own cells and nothing beside them, so a cleared cell is ABSENT
         from it — which is what makes «пустое поле — цена Montonio» survive a
         save. */
      await expect.poll(async () => (await rules())?.carriers?.dpd?.LV).toBeUndefined();

      // «Вернуть» on that toast: his own price is back, in the box and in the shop
      await page.locator(".adm-toast__undo").click();
      await expect.poll(async () => Number((await rules())?.carriers?.dpd?.LV),
        { timeout: 20_000, message: "«Вернуть» did not put the owner's price back" }).toBe(6.49);
      await expect(lv).toHaveValue("6,49");

      /* «Вернуть значения по умолчанию» — delivery prices only (q37), at once,
         with «Вернуть». Back to the shipped default, which since r22 means
         «никаких своих цен» rather than today's price list. */
      await page.locator("[data-admshipreset]").click();
      await expect(page.getByRole("status")).toContainText("Тарифы снова стандартные", { timeout: 15_000 });
      await expect(page.locator(".adm-confirm")).toHaveCount(0);
      await expect(page.locator(".adm-toast__undo")).toBeVisible();
      await expect.poll(async () => (await rules())?.carriers?.dpd?.LV).toBeUndefined();
    } finally {
      await page.request.put("/api/admin/settings/", { data: { shipping_rules: original ?? {} } });
    }
  });
});

test.describe("admin sweep 2 — settings", () => {
  test.use({ extraHTTPHeaders: ipHeaders(193) });

  test("«Главная страница» has nothing to save by hand, and a refused write says so instead of «Сохранено ✓»", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one write per action is enough");
    await loginAsAdmin(page);
    await openSettings(page, "home");
    /* 1a: no save bar and no «Сохранить» — the page saves itself (README § 2) */
    await expect(page.locator("[data-setbar]")).toHaveCount(0);
    await expect(page.locator("[data-herosave]")).toHaveCount(0);
    await expect(page.locator(".adm-confirm")).toHaveCount(0);

    /* The chatbot switch writes settings at once. With the server refusing,
       the owner used to see «Чат выключен ✓» and nothing else — and find the
       chat still on from another phone. Since 1a the toast waits for the 2xx
       and the header says «Не сохранилось» instead. */
    const chatBefore = (await (await page.request.get("/api/admin/settings/")).json()).settings.chatbot;
    try {
      await page.route("**/api/admin/settings/", (route) => {
        if (route.request().method() !== "PUT") return route.continue();
        return route.fulfill({ status: 500, contentType: "application/json", body: '{"ok":false,"error":"server_error"}' });
      });
      await page.locator("[data-admchatbot]").click();
      // the header's own line — the page's on a desktop, the top bar's on a phone
      await expect(page.locator('[role="alert"]:visible', { hasText: "Не сохранилось" }).first()).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: /Чат (включён|выключен) ✓/ }),
        "«✓» before the server said yes").toHaveCount(0);
      await page.unroute("**/api/admin/settings/");
      expect((await (await page.request.get("/api/admin/settings/")).json()).settings.chatbot).toBe(chatBefore);
    } finally {
      await page.unroute("**/api/admin/settings/").catch(() => undefined);
      // a shop that never stored the switch has nothing to put back
      if (chatBefore !== undefined) await page.request.put("/api/admin/settings/", { data: { chatbot: chatBefore } });
    }
  });
});

test.describe("admin sweep 2 — the keyboard", () => {
  test.use({ extraHTTPHeaders: ipHeaders(194) });

  test("Enter is the button in the partner form, and Enter twice is one login", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "a keyboard test");
    // two Enters on the password box, as fast as a key repeat: one request, not two against a 5/min limit
    await page.goto(shopUrl("", "/admin/"));
    const pw = page.locator("[data-admpw]");
    await expect(pw).toBeVisible();
    let logins = 0;
    page.on("request", (r) => { if (r.url().includes("/api/admin/login/") && r.method() === "POST") logins++; });
    await expect.poll(async () => { await pw.fill("e2e-suite-admin-password"); return pw.inputValue(); }).toBe("e2e-suite-admin-password");
    await pw.press("Enter");
    await pw.press("Enter");
    await expect(page.locator('[data-admtab="orders"][aria-current]:visible').first()).toBeVisible();
    expect(logins).toBe(1);

    await openCustomers(page);
    await page.locator("[data-admpartnernew]").click();
    const enterEmail = freshEmail("sweep2-enter");
    await page.locator('[data-partnerf="email"]').fill(enterEmail);
    await page.locator('[data-partnerf="email"]').press("Enter");
    /* Enter is «Добавить партнёра». 1a (q3): no question — the form closes and
       the POST waits ten seconds; «Вернуть» brings the form back as typed. */
    await expect(page.getByRole("status")).toContainText(/Партнёр добавлен · письмо уйдёт через \d+ с/);   // counts down (custHold)
    await expect(page.locator("[data-partnerform]")).toHaveCount(0);
    await page.locator(".adm-toast__undo").click();
    await expect(page.locator('[data-partnerf="email"]')).toHaveValue(enterEmail);
    // an empty address is refused in place, not sent
    await page.locator('[data-partnerf="email"]').fill("");
    await page.locator('[data-partnerf="email"]').press("Enter");
    await expect(page.locator("[data-partnerform] .adm-err")).toContainText("Проверьте e-mail");
    await page.locator("[data-admpartnercancel]").click();
  });
});
