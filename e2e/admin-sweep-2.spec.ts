import { expect, type Page, test } from "@playwright/test";
import {
  adminSection, freshEmail, ipHeaders, loginAsAdmin, payOrder, PRODUCT_2, shopUrl, waitForScreen,
} from "./fixtures";
import { ceilingCost, customerPrice } from "@/lib/shipping/country-prices";

/* What «Заполнить по тарифам Montonio» must write into the Latvian
   parcel-machine box: for the four countries whose checkout lets the shopper
   choose the carrier, the fill takes the DEAREST carrier the shop can post
   with, so one price covers whichever machine is picked, and Nova Post — a
   quote the shop cannot use — is left out. Read from the shop's own tariff
   table, never typed here: the price list is re-cut every season, and a
   number written into a test goes stale silently, which is what happened to
   the one this replaces. */
const LV_PARCEL_FILL = customerPrice(ceilingCost("LV", "parcel")!.price);

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
  const back = page.locator("[data-admsetback]");
  if (await back.count()) await back.first().click();
  await page.locator(`[data-admsetpage="${sub}"]`).click();
  await expect(page.locator("[data-admsetback]")).toBeVisible();
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
    await page.locator('[data-admstatus="refunded"]').click();
    await expect(page.locator(".adm-confirm__t")).toHaveText("Оформить возврат?");
    await expect(page.locator(".adm-confirm__d")).toContainText(number);
    await page.locator("[data-admcancel]").click();
    await expect(page.locator(".adm-confirm")).toHaveCount(0);
    expect(await status()).toBe("paid");
    await page.locator('[data-admstatus="refunded"]').click();
    await page.locator("[data-admapply]").click();
    await expect(page.getByRole("status")).toContainText("Сохранено");
    await expect.poll(status).toBe("refunded");
    await expect(page.locator(".adm-badge--big")).toHaveText("Возврат");

    /* …and «оплачен» on a refunded order is the step back — the card says the
       money and the shelf are left alone, and the payment record proves it. */
    await page.locator('[data-admstatus="paid"]').click();
    await expect(page.locator(".adm-confirm__t")).toHaveText("Отметить оплаченным?");
    await expect(page.locator(".adm-confirm__d")).toContainText("Деньги и склад не трогаем");
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
    await expect(page.locator("#orderlist")).toContainText("Таких заказов нет");
  });
});

test.describe("admin sweep 2 — delivery tariffs", () => {
  test.use({ extraHTTPHeaders: ipHeaders(192) });

  test("the Montonio fill only fills the boxes, and the reset asks first", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one write per action is enough");
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    const rules = async () => (await (await page.request.get("/api/admin/settings/")).json()).settings.shipping_rules ?? null;
    const original = await rules();
    try {
      await openSettings(page, "delivery");
      const lv = page.locator('[data-shiprule="m:parcel:LV"]');
      await expect(lv).toBeVisible();
      const before = JSON.stringify(await rules());

      /* «Заполнить по тарифам Montonio»: the sentence under the button says
         «проверьте цифры и сохраните» — so the shop must not change yet. */
      await page.locator("[data-admshipfill]").click();
      await expect(page.getByRole("status")).toContainText("вписаны");
      await page.locator("[data-closetoast]").click();
      expect(JSON.stringify(await rules()), "the fill changed the shop before «Сохранить»").toBe(before);
      // …but the box did follow the tariff, rounded up to x.x9
      expect(Number((await lv.inputValue()).replace(",", "."))).toBeGreaterThanOrEqual(LV_PARCEL_FILL);

      // «Сохранить» → the card → now the shop follows
      await page.locator("[data-admshipsave]").click();
      await expect(page.locator(".adm-confirm__t")).toHaveText("Изменить тарифы доставки?");
      await page.locator("[data-admapply]").click();
      await expect(page.getByRole("status")).toContainText("Тарифы доставки сохранены");
      await page.locator("[data-closetoast]").click();
      await expect.poll(async () => Number((await rules())?.methods?.parcel?.LV)).toBeGreaterThanOrEqual(LV_PARCEL_FILL);

      /* The reset needs a price to put back, and since 08.09.2026 the fill
         above no longer leaves one: Dim raised the Latvian and Lithuanian
         locker to the 5,59 € the tariff itself computes, so every default cell
         now equals what «Заполнить» would write and the button moves nothing
         on a standard table. The box is therefore put out of step by hand. */
      await lv.fill("3,49");
      await page.locator("[data-admshipsave]").click();
      await page.locator("[data-admapply]").click();
      await expect(page.getByRole("status")).toContainText("Тарифы доставки сохранены");
      await page.locator("[data-closetoast]").click();
      await expect.poll(async () => Number((await rules())?.methods?.parcel?.LV)).toBe(3.49);

      /* «Вернуть значения по умолчанию» — a delivery price too, so it asks; «Отмена» changes nothing. */
      /* The one that HOLDS the reset button — «Самовывоз, перевозчики и
         наценка». Since 07.09.2026 the page has a second fold above it (the
         twenty-one European countries), so `.first()` opened the wrong one. */
      await page.locator("details", { has: page.locator("[data-admshipreset]") })
        .locator("summary").first().click();
      await page.locator("[data-admshipreset]").click();
      await expect(page.locator(".adm-confirm__t")).toHaveText("Вернуть тарифы по умолчанию?");
      await page.locator("[data-admcancel]").click();
      await expect(page.locator(".adm-confirm")).toHaveCount(0);
      expect(Number((await rules())?.methods?.parcel?.LV)).toBe(3.49);
      await page.locator("[data-admshipreset]").click();
      await page.locator("[data-admapply]").click();
      await expect(page.getByRole("status")).toContainText("Тарифы снова стандартные");
      await expect(page.locator(".adm-toast__undo")).toBeVisible();
      // back to the shipped default, which is the tariff price to the cent
      await expect.poll(async () => Number((await rules())?.methods?.parcel?.LV)).toBe(LV_PARCEL_FILL);
    } finally {
      await page.request.put("/api/admin/settings/", { data: { shipping_rules: original ?? {} } });
    }
  });
});

test.describe("admin sweep 2 — settings", () => {
  test.use({ extraHTTPHeaders: ipHeaders(193) });

  test("an untouched banner says «Изменений нет», and a refused write says so instead of «Сохранено ✓»", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one write per action is enough");
    await loginAsAdmin(page);
    await openSettings(page, "home");
    await page.locator("[data-herosave]").click();
    await expect(page.getByRole("status")).toContainText("Изменений нет");
    await expect(page.locator(".adm-confirm")).toHaveCount(0);
    await page.locator("[data-closetoast]").click();

    /* The chatbot switch writes settings in the background. With the server
       refusing, the owner used to see «Чат выключен ✓» and nothing else —
       and find the chat still on from another phone. */
    const chatBefore = (await (await page.request.get("/api/admin/settings/")).json()).settings.chatbot;
    await page.route("**/api/admin/settings/", (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      return route.fulfill({ status: 500, contentType: "application/json", body: '{"ok":false,"error":"server_error"}' });
    });
    await page.locator("[data-admchatbot]").click();
    await expect(page.getByRole("status")).toContainText("Не удалось сохранить на сервере");
    await page.unroute("**/api/admin/settings/");
    expect((await (await page.request.get("/api/admin/settings/")).json()).settings.chatbot).toBe(chatBefore);
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
    await page.locator('[data-partnerf="email"]').fill(freshEmail("sweep2-enter"));
    await page.locator('[data-partnerf="email"]').press("Enter");
    await expect(page.locator(".adm-confirm__t")).toHaveText("Добавить партнёра?");
    await page.locator("[data-admcancel]").click();
    await expect(page.locator(".adm-confirm")).toHaveCount(0);
    // an empty address is refused in place, not sent
    await page.locator('[data-partnerf="email"]').fill("");
    await page.locator('[data-partnerf="email"]').press("Enter");
    await expect(page.locator("[data-partnerform] .adm-err")).toContainText("Проверьте e-mail");
    await page.locator("[data-admpartnercancel]").click();
  });
});
