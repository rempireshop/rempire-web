/**
 * «По счёту — для компаний», end to end (docs/payments.md § «Оплата по счёту»).
 *
 * The shopper's half runs on every project — the company form is step 3 of
 * the checkout, and a phone is where a salon's owner orders from: pick the
 * method, type the company, be refused without a name, place the order with
 * no bank page in between, land on «Заказ оформлен» with «Счёт отправлен на
 * …» and the payment term, and survive a reload of the receipt.
 *
 * The owner's half runs on the Chromium projects (the admin stays
 * Chromium-only, docs/testing.md «Safari»): the order under the «По счёту»
 * chip, the card's state line and the company block, the PDF really being a
 * PDF (fetched with the page's own cookies — the only way to assert on a
 * response the browser would hand to a viewer), the letter with the PDF's
 * name in the e2e mail sink, «Отправить счёт ещё раз» landing a second one,
 * and «Отметить оплаченным» through the confirm card — after which the order
 * is paid, the customer's «Заказ принят» went out, and the card still offers
 * the invoice. On the desktop project the «Счета для компаний» settings card
 * is opened too (the phone reaches «Настройки» through the «Ещё» sheet, which
 * admin-sections.spec.ts already covers).
 */
import { expect, test } from "@playwright/test";
import { continueButton, freshEmail, ipHeaders, loginAsAdmin, payButton, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

const COMPANY = { name: "Salong Näidis OÜ", regCode: "16123456", vatNumber: "EE101234567" };

test.describe("invoice for companies", () => {
  test.use({ extraHTTPHeaders: ipHeaders(200) });

  test("checkout by invoice, then the owner downloads it and marks it paid", async ({ page, browser }, testInfo) => {
    test.setTimeout(120_000);
    const email = freshEmail("invoice-buyer");
    const invoiceEmail = freshEmail("invoice-accountant");

    /* ---- the shop has an IBAN ----
       Since 07.09.2026 an invoice with no IBAN is not merely incomplete, it is
       unsent: src/lib/invoices.ts invoiceSendBlock() refuses the letter,
       because a numbered demand for money with nowhere to pay it is worse than
       no letter at all. The suite starts from the built-in content, where the
       IBAN is blank, so it is set here — merged into whatever content the rest
       of the run has stored, never overwriting it — and the bank name is left
       blank on purpose, so the settings card's «не заполнено» warning is still
       exercised further down. */
    {
      const ctx = await browser.newContext({ extraHTTPHeaders: ipHeaders(200) });
      const admin = await ctx.newPage();
      try {
        await loginAsAdmin(admin);
        const settings = (await (await admin.request.get("/api/admin/settings/")).json()) as {
          settings?: { content?: { company?: Record<string, unknown> } };
        };
        const content = settings.settings?.content ?? {};
        const put = await admin.request.put("/api/admin/settings/", {
          data: { content: { ...content, company: { ...(content.company ?? {}), iban: "EE38 2200 2210 2014 5685" } } },
        });
        expect(put.status()).toBe(200);
      } finally {
        await ctx.close();
      }
    }

    /* ---- the shopper ---- */
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

    // the fourth method: the company form unfolds under the list
    await page.locator('input[data-paym="3"]').check();
    const form = page.locator("[data-invoice]");
    await expect(form).toBeVisible();
    // the invoice e-mail is prefilled from the order's, the legal address from the courier address
    await expect(form.locator('[data-invf="email"]')).toHaveValue(email);
    await expect(form.locator("[data-invsame]")).toBeChecked();
    await expect(form.locator(".hint").first()).toContainText("Testitänav 1");

    // nothing is sent without a company: the step stays open and says which field
    await form.locator('[data-invf="regCode"]').fill(COMPANY.regCode);
    await payButton(page).click();
    await expect(page.locator('[data-invoice] div.err[role="alert"]').first()).toContainText("Укажите название фирмы");
    await expect(page).not.toHaveURL(/\/done\//);

    await page.locator('[data-invf="name"]').fill(COMPANY.name);
    await page.locator('[data-invf="vatNumber"]').fill(COMPANY.vatNumber);
    await page.locator('[data-invf="email"]').fill(invoiceEmail);

    // no bank page: the receipt straight away, with the order number in the address
    const created = page.waitForResponse((r) => r.url().includes("/api/orders/") && r.request().method() === "POST");
    await payButton(page).click();
    const body = (await (await created).json()) as {
      ok: boolean;
      number: string;
      invoice?: { number: string; dueDays: number; email: string; sent: boolean };
    };
    expect(body.ok).toBe(true);
    expect(body.invoice?.number).toMatch(/^A-\d{4}-\d{4}$/);
    expect(body.invoice?.email).toBe(invoiceEmail);
    const number = body.number;

    await waitForScreen(page, "done");
    await expect(page).toHaveURL(new RegExp(`/shop2/done/\\?n=${number}&s=invoice`));
    await expect(page.locator("h1")).toHaveText("Заказ оформлен");
    await expect(page.locator(".done__num")).toContainText(number);
    const done = page.locator("[data-invoicedone]");
    /* The receipt says what really happened. This suite runs with no
       RESEND_API_KEY, so the letter was skipped and `invoice.sent` came back
       false — «Счёт выписан — пришлём его на …», not «Счёт отправлен». On the
       live shop, with the key set, the same screen says «Счёт отправлен на …»
       (the sink below proves the letter was in fact composed and handed over). */
    expect(body.invoice?.sent).toBe(false);
    await expect(done).toContainText("Счёт выписан — пришлём его на");
    await expect(done).toContainText(invoiceEmail);
    await expect(done).toContainText("Оплатите в течение 7 дней — после оплаты отправим заказ.");

    // a reload keeps the receipt (the address is not in the URL, so the wording is the plain one)
    await page.reload();
    await waitForScreen(page, "done");
    await expect(page.locator("h1")).toHaveText("Заказ оформлен");
    await expect(page.locator("[data-invoicedone]")).toContainText("Счёт отправлен на почту.");

    if (testInfo.project.name === "mobile-safari") return;

    /* ---- the owner, in a second context so the shopper's cookies stay untouched ---- */
    const ctx = await browser.newContext({ extraHTTPHeaders: ipHeaders(200) });
    const admin = await ctx.newPage();
    try {
      await loginAsAdmin(admin);
      await admin.locator('[data-admtab="orders"][aria-current]:visible').first().click();
      // the chip counts the invoices waiting for a transfer, and the row leads with «Отметить оплаченным»
      const chip = admin.locator('[data-admfilter="invoice"]');
      await expect(chip).toContainText("По счёту");
      await chip.click();
      const row = admin.locator(`.adm-row:has([data-admorder]:has-text("${number}"))`).first();
      await expect(row).toBeVisible();
      await expect(row.locator(".adm-badge")).toHaveText("Ждёт оплаты по счёту");
      await expect(row.locator("[data-adminvpaid]")).toBeVisible();
      await row.locator("[data-admorder]").first().click();

      await expect(admin.locator(".adm-head__kicker--code")).toContainText(number);
      await expect(admin.locator(".adm-badge--big")).toHaveText("Ждёт оплаты по счёту");
      const invoiceNumber = body.invoice!.number;
      const state = admin.locator("[data-adminvstate]");
      await expect(state).toContainText(`Ожидает оплаты по счёту №${invoiceNumber}`);
      await expect(state).toContainText("· до ");
      // no RESEND_API_KEY in this suite: the card says the letter did not go out, and why
      await expect(state).toContainText("Письмо со счётом не ушло (no_api_key)");
      const company = admin.locator("[data-admcompany]");
      await expect(company).toContainText(COMPANY.name);
      await expect(company).toContainText(`рег. ${COMPANY.regCode}`);
      await expect(company).toContainText(`KMKR ${COMPANY.vatNumber}`);
      await expect(company).toContainText("Testitänav 1");
      await expect(company).toContainText(invoiceEmail);

      // «Скачать счёт» really is a PDF
      const link = admin.locator("[data-adminvpdf]");
      await expect(link).toHaveAttribute("data-adminvpdf", invoiceNumber);
      const href = await link.getAttribute("href");
      const orderId = (await status(admin, number)).id;
      expect(href).toBe(`/api/admin/orders/${encodeURIComponent(orderId)}/invoice/`);
      const pdf = await admin.request.get(href as string);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()["content-type"]).toContain("application/pdf");
      expect(pdf.headers()["content-disposition"]).toContain(`rempire-invoice-${invoiceNumber}.pdf`);
      const bytes = await pdf.body();
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(bytes.length).toBeGreaterThan(3000);

      // the letter went to the accountant's address with the PDF named after the number (the e2e mail sink)
      const sink = async (template: string, to: string) =>
        (await (await admin.request.get(`/api/e2e/mail/?template=${template}&to=${encodeURIComponent(to)}`)).json()).mails as Array<{
          subject: string;
          attachments: string[];
        }>;
      const first = await sink("invoice", invoiceEmail);
      expect(first).toHaveLength(1);
      expect(first[0].subject).toContain(invoiceNumber);
      expect(first[0].attachments).toEqual([`rempire-invoice-${invoiceNumber}.pdf`]);
      // …and no «Заказ принят» yet: nothing is paid
      expect(await sink("order-confirmed", email)).toHaveLength(0);

      // «Отправить счёт ещё раз» — a second letter, the toast honest about the missing mail key
      await admin.locator(".adm-ordacts [data-adminvresend]").click();
      await expect(admin.getByRole("status")).toContainText("письмо не ушло");
      await expect.poll(async () => (await sink("invoice", invoiceEmail)).length).toBe(2);
      await admin.locator("[data-closetoast]").click();

      // «Отметить оплаченным» asks first, then settles the order like a bank's ticket would
      await admin.locator(".adm-ordacts [data-adminvpaid]").click();
      await expect(admin.locator(".adm-confirm__t")).toHaveText("Отметить оплаченным?");
      await expect(admin.locator(".adm-confirm__d")).toContainText(invoiceNumber);
      await admin.locator("[data-admapply]").click();
      await expect(admin.getByRole("status")).toContainText(`${number} оплачен по счёту`);
      await expect(admin.locator(".adm-badge--big")).toHaveText("Оплачен");
      await expect.poll(async () => (await status(admin, number)).status).toBe("paid");
      const paid = await status(admin, number);
      expect(paid.payment).toMatchObject({ provider: "invoice", status: "paid", ref: invoiceNumber, method: "invoice" });
      expect(typeof paid.invoice?.paidAt).toBe("string");
      // the customer's «Заказ принят» went out on the paid transition, once
      await expect.poll(async () => (await sink("order-confirmed", email)).length).toBe(1);
      // the card now reads as a paid order — the label step is next — and the invoice is still there to download
      await expect(admin.locator("[data-adminvstate]")).toContainText(`Оплачен по счёту №${invoiceNumber}`);
      await expect(admin.locator("[data-adminvpdf]")).toBeVisible();
      await expect(admin.locator(".adm-ordacts [data-adminvpaid]")).toHaveCount(0);
      await expect(admin.locator(".adm-ordacts [data-admlabel]")).toBeVisible();

      // the journal has the line
      if (testInfo.project.name === "desktop") {
        await admin.locator('[data-admtab="setup"][aria-current]:visible').first().click();
        await admin.locator('[data-admsetpage="journal"]').click();
        await expect(admin.locator(".adm-jrow", { hasText: `Заказ ${number}: оплачен по счёту ${invoiceNumber}` })).toHaveCount(1);
        // …and «О компании» carries the invoice settings card, warning that the bank details are blank
        await admin.locator("[data-admsetback]").click();
        await admin.locator('[data-admsetpage="company"]').click();
        const card = admin.locator("[data-adminvsettings]");
        await expect(card).toBeVisible();
        // the IBAN is filled in (above), the bank name is not — so the softer
        // «не заполнено» list is shown and the hard «Без IBAN» block is not
        await expect(card).toContainText("В блоке «Реквизиты» выше не заполнено:");
        await expect(card).not.toContainText("Без IBAN счёт не уходит вообще.");
        await expect(card.locator('[data-invsetf="prefix"]')).toHaveValue("A-");
        await expect(card.locator('[data-invsetf="dueDays"]')).toHaveValue("7");
        // the two dunning intervals Dim asked for: remind on day −2, cancel on day +7
        await expect(card.locator('[data-invsetf="remindBeforeDays"]')).toHaveValue("2");
        await expect(card.locator('[data-invsetf="cancelAfterDays"]')).toHaveValue("7");
        /* …and they are settings, not constants: typing one and saving really
           writes settings.invoice. Read back from the settings route rather
           than from the re-rendered card — the panel refills the card from
           /api/overrides/, which is a cached public response, and this test is
           about the value being stored, not about when the cache expires. */
        await card.locator('[data-invsetf="remindBeforeDays"]').fill("3");
        // «Сохранить» is the page's save bar since r12 — it names the card while it differs
        await expect(admin.locator("[data-setnote]")).toContainText("Счета для компаний");
        await admin.locator("[data-adminvsave]").click();
        await expect(admin.getByRole("status")).toContainText("Счета для компаний: сохранено ✓");
        await admin.locator("[data-closetoast]").click();
        const saved = (await (await admin.request.get("/api/admin/settings/")).json()) as {
          settings: { invoice: { prefix: string; dueDays: number; remindBeforeDays: number; cancelAfterDays: number } };
        };
        expect(saved.settings.invoice).toMatchObject({ prefix: "A-", dueDays: 7, remindBeforeDays: 3, cancelAfterDays: 7 });
        // the journal records the interval that moved, and only that one
        await admin.locator("[data-admsetback]").click();
        await admin.locator('[data-admsetpage="journal"]').click();
        await expect(admin.locator(".adm-jrow", { hasText: "Счета для компаний: напоминание за 3 дн. до срока" })).toHaveCount(1);
        await expect(admin.locator(".adm-jrow", { hasText: "автоотмена" })).toHaveCount(0);
        // put the default back — the whole run shares one database
        await admin.request.put("/api/admin/settings/", {
          data: { invoice: { prefix: "A-", dueDays: 7, remindBeforeDays: 2, cancelAfterDays: 7 } },
        });
      }
    } finally {
      await ctx.close();
    }
  });
});

type AdminOrder = { id: string; status: string; payment: Record<string, unknown> | null; invoice: { paidAt?: string | null } | null };

/** The order as the admin API sees it — by number, so the spec never has to know the uuid up front. */
async function status(admin: import("@playwright/test").Page, number: string): Promise<AdminOrder> {
  const res = await admin.request.get(`/api/admin/orders/${number}/`);
  return ((await res.json()) as { order: AdminOrder }).order;
}
