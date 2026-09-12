import { expect, test } from "@playwright/test";
import { E2E_ADMIN_PASSWORD } from "./env.mjs";
import {
  continueButton,
  freshEmail,
  functionalProject,
  ipHeaders,
  LANGS,
  payButton,
  payOrder,
  PRODUCT,
  shopUrl,
  tr,
  waitForScreen,
} from "./fixtures";

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
  test.skip(!functionalProject(testInfo), "functional spec — desktop and mobile-safari projects only, see docs/testing.md");
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

      // 4) Profile: each field saves itself when it is left (no Save button
      //    since 12.09.2026 — account-settings.spec.ts) and says so under itself.
      const name = page.locator('[data-acctf="name"]');
      await name.fill("E2E Тестов");
      await name.blur();
      await expect(page.locator('[data-acctst="name"]')).toContainText("✓");
      const phone = page.locator('[data-acctf="phone"]');
      await phone.fill("+372 5550001");
      await phone.blur();
      await expect(page.locator('[data-acctst="phone"]')).toContainText("✓");

      // 5) Logout returns to the signed-out (email-entry) screen.
      await page.locator("[data-logout]").click();
      await expect(page.locator("[data-login]")).toBeVisible();
      await expect(page.locator("[data-logout]")).toHaveCount(0);
    });
  });
}

/**
 * «Хочу вернуть заказ» — the tick, all the way through.
 *
 * This is the whole of what the shop can honestly do about a return (Montonio
 * hands out no return codes and has no return endpoint — src/lib/returns.ts),
 * so the one thing that must be true is that the tick is not decoration: it
 * reaches the server, it reaches Renat the same way a new review does, and the
 * order card says a return was asked for and when.
 *
 * The hand-over is made through the admin API rather than by pressing
 * «Доставлен» in the panel — that button has its own coverage in
 * admin-back.spec.ts, and what is under test here starts at the tick.
 */
test.describe("account — «Хочу вернуть заказ»", () => {
  test.use({ extraHTTPHeaders: ipHeaders(55) });

  test("the tick on a delivered order reaches the server and shows on the order card", async ({ page }) => {
    test.setTimeout(180_000);
    const email = freshEmail("acct-return");

    // 1) A paid order under this address.
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    const number = await payOrder(page, email, "paid");

    // 2) …that the owner has handed over. page.request shares the context's
    //    cookie jar, so the admin cookie set here is the one the panel uses at
    //    the end of this test as well.
    const login = await page.request.post("/api/admin/login/", { data: { password: E2E_ADMIN_PASSWORD } });
    expect(login.ok()).toBe(true);
    const marked = await page.request.patch(`/api/admin/orders/${number}/`, { data: { status: "delivered" } });
    expect(marked.ok(), "the order could not be marked delivered").toBe(true);

    // 3) The customer signs in and finds the tick on that order.
    await page.goto(shopUrl("", "/account/"));
    await waitForScreen(page, "account");
    await page.locator("[data-email]").fill(email);
    const codeResponse = page.waitForResponse((r) => r.url().includes("/api/account/code/"));
    await page.locator("[data-login]").click();
    const codeBody = (await (await codeResponse).json()) as { ok: boolean; code?: string };
    await page.locator("[data-acctcode]").fill(codeBody.code!);
    await page.locator("[data-logincode]").click();
    await expect(page.locator("[data-logout]")).toBeVisible();

    const row = page.locator(".rowcard", { hasText: number });
    await expect(row).toBeVisible();
    await expect(row.getByText("доставлен")).toBeVisible();
    const tick = row.locator("[data-acctreturn]");
    await expect(tick, "no «Хочу вернуть заказ» on a delivered order").toBeVisible();
    /* click(), not check(): ticking the box redraws the row on the spot (the
       request is in flight, then the answer replaces the tick with the date),
       so the element check() would look at afterwards is already gone. */
    await tick.click();

    // 4) The row says the shop has it — and says a person will write back.
    await expect(row.getByText("Возврат запрошен")).toBeVisible();
    await expect(row.getByText("Мы получили заявку и напишем вам на почту.")).toBeVisible();
    // …and it is not offered a second time
    await expect(row.locator("[data-acctreturn]")).toHaveCount(0);

    // 5) The server really has it: the order the panel reads carries the tick.
    const list = (await (await page.request.get(`/api/admin/orders/?q=${number}`)).json()) as {
      orders: Array<{ number: string; status: string; shipping: { returnRequest?: { at?: string } } }>;
    };
    const stored = list.orders.find((o) => o.number === number);
    expect(stored?.status).toBe("delivered");
    expect(stored?.shipping.returnRequest?.at, "the tick never reached the order").toBeTruthy();

    // 6) And Renat is told the way the shop always tells him: a row in
    //    «Сделать сегодня» on «Обзор», which leads to the order's own card.
    await page.goto(shopUrl("", "/admin/"));
    const queueRow = page.locator('.adm-row--click[data-admfilter="shipped"]');
    await expect(queueRow, "«Обзор» never listed the return request").toBeVisible();
    await expect(queueRow).toContainText("заявка на возврат");
    await queueRow.click();

    await page.locator(`[data-admorder]:has-text("${number}")`).first().click();
    const card = page.locator("[data-admreturn]");
    await expect(card, "the order card says nothing about the return").toBeVisible();
    await expect(card).toContainText("Покупатель просит вернуть заказ");
    // the date it was asked on, as the panel prints dates
    await expect(card.locator(".adm-mono")).toHaveText(/^\d{2}\.\d{2}\.\d{4}$/);
    // and the one thing the shop cannot do, said out loud
    await expect(card).toContainText("этикетку возврата магазин выдать не может");
  });
});

/**
 * «Скачать счёт (PDF)» — the invoice, back from the account.
 *
 * The owner's finding (10.09.2026): «I see my orders and statuses, but I do
 * not see any of the invoices or other files that were sent by e-mail — I
 * should be able to download them from my account instead of digging through
 * my mail.» So: a customer signs in, checks out «По счёту» under the same
 * address (the company form is step 3, driven the way invoice.spec.ts drives
 * it), and the order's row in «Мои заказы» carries the link the letter used
 * to be the only home of — on the same line a gift card's link takes. The
 * link is followed with the page's own cookies, the only way to assert on a
 * response the browser would hand to a viewer, and then without any cookie,
 * which must be refused: the link is not a bearer link.
 */
test.describe("account — «Скачать счёт (PDF)»", () => {
  test.use({ extraHTTPHeaders: ipHeaders(57) });

  test("an invoice order placed signed in shows the link, and the link is the PDF", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const email = freshEmail("acct-invoice");

    // 1) Sign in first — this order is placed by a customer, not by a guest.
    await page.goto(shopUrl("", "/account/"));
    await waitForScreen(page, "account");
    await page.locator("[data-email]").fill(email);
    const codeResponse = page.waitForResponse((r) => r.url().includes("/api/account/code/"));
    await page.locator("[data-login]").click();
    const codeBody = (await (await codeResponse).json()) as { ok: boolean; code?: string };
    await page.locator("[data-acctcode]").fill(codeBody.code!);
    await page.locator("[data-logincode]").click();
    await expect(page.locator("[data-logout]")).toBeVisible();

    // 2) Checkout «По счёту» under the same address.
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    await page.locator("[data-email]").fill(email);
    await continueButton(page, 2).click();
    await page.locator('input[data-dm="courier"]').check();
    await page.locator('[data-shipf="name"]').fill("Mari Tamm");
    await page.locator('[data-shipf="addr"]').fill("Testitänav 1");
    await page.locator('[data-shipf="zip"]').fill("10111");
    await page.locator('[data-shipf="city"]').fill("Tallinn");
    await page.locator('[data-shipf="phone"]').fill("+372 5550000");
    await continueButton(page, 3).click();
    await page.locator('input[data-paym="3"]').check();
    await expect(page.locator("[data-invoice]")).toBeVisible();
    await page.locator('[data-invf="name"]').fill("Salong Näidis OÜ");
    await page.locator('[data-invf="regCode"]').fill("16123456");
    const created = page.waitForResponse((r) => r.url().includes("/api/orders/") && r.request().method() === "POST");
    await payButton(page).click();
    const body = (await (await created).json()) as { ok: boolean; number: string; invoice?: { number: string } };
    expect(body.ok).toBe(true);
    expect(body.invoice?.number).toMatch(/^A-\d{4}-\d{4}$/);
    const invoiceNumber = body.invoice!.number;
    await waitForScreen(page, "done");

    // 3) Back in the account: the row has the link next to its status, named by the invoice number.
    await page.goto(shopUrl("", "/account/"));
    await waitForScreen(page, "account");
    await expect(page.locator("[data-logout]")).toBeVisible();
    const row = page.locator(".rowcard", { hasText: body.number });
    await expect(row).toBeVisible();
    await expect(row.getByText("принят")).toBeVisible();
    const link = row.locator("[data-invpdf]");
    await expect(link, "no «Скачать счёт (PDF)» on an invoice order").toBeVisible();
    await expect(link).toHaveAttribute("data-invpdf", invoiceNumber);
    await expect(link).toContainText("Скачать счёт (PDF)");
    await expect(link).toContainText(invoiceNumber);
    const href = await link.getAttribute("href");
    expect(href).toBe(`/api/account/orders/${encodeURIComponent(body.number)}/invoice/`);
    // the one link on this order: a card order carries none, and this order bought no card
    await expect(row.locator("[data-giftpdf]")).toHaveCount(0);

    // 4) Following it — with the page's own cookies — really is the PDF, named after the invoice.
    const pdf = await page.request.get(href as string);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    expect(pdf.headers()["content-disposition"]).toContain(`rempire-invoice-${invoiceNumber}.pdf`);
    const bytes = await pdf.body();
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(3000);

    // 5) …and the same address with no cookie gets nothing: the link cannot be forwarded.
    const stranger = await browser.newContext({ extraHTTPHeaders: ipHeaders(57) });
    try {
      const refused = await stranger.request.get(href as string);
      expect(refused.status()).toBe(401);
      expect(refused.headers()["content-type"]).not.toContain("application/pdf");
    } finally {
      await stranger.close();
    }
  });
});
