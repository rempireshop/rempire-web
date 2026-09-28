import { expect, test } from "@playwright/test";
import { E2E_ADMIN_PASSWORD } from "./env.mjs";
import { freshEmail, functionalProject, ipHeaders, payOrder, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

/**
 * «Мой кабинет → Мои заказы», the three things Dim asked for on 28.09.2026:
 *
 *   · «Подробнее о заказе» opens the row in place — a real button, its
 *     aria-expanded saying which way it is, the focus staying on it, the
 *     keyboard working it — and the opened row shows the order as paid;
 *   · «Скачать чек (PDF)» on a paid order is the receipt of THAT order, and
 *     is refused without the account's cookie (the link is not a bearer link);
 *   · once the order is «Отправлен», the parcel line names how it travels.
 *
 * The order is placed the way account.spec.ts places one (courier, card,
 * the mock bank's «Оплатить»), then the customer signs in with the code the
 * suite exposes (E2E_EXPOSE_LOGIN_CODE — see that spec's own comment).
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(!functionalProject(testInfo), "functional spec — desktop and mobile-safari projects only, see docs/testing.md");
});

test.describe("account — the order row opens, and the receipt is the order's", () => {
  test.use({ extraHTTPHeaders: ipHeaders(61) });

  test("opens in place, closes from the keyboard, and hands over the receipt PDF", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const email = freshEmail("acct-details");

    // 1) A paid order under this address.
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    const number = await payOrder(page, email, "paid");

    // 2) Sign in.
    await page.goto(shopUrl("", "/account/"));
    await waitForScreen(page, "account");
    await page.locator("[data-email]").fill(email);
    const codeResponse = page.waitForResponse((r) => r.url().includes("/api/account/code/"));
    await page.locator("[data-login]").click();
    const codeBody = (await (await codeResponse).json()) as { ok: boolean; code?: string };
    await page.locator("[data-acctcode]").fill(codeBody.code!);
    await page.locator("[data-logincode]").click();
    await expect(page.locator("[data-logout]")).toBeVisible();

    // 3) The closed row is what it always was, plus the button — and none of the details yet.
    const row = page.locator(".rowcard", { hasText: number });
    await expect(row).toBeVisible();
    await expect(row.getByText("оплачен")).toBeVisible();
    const more = row.locator(`[data-acctorder="${number}"]`);
    await expect(more).toHaveText("Подробнее о заказе");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    const panelId = (await more.getAttribute("aria-controls"))!;
    const panel = page.locator(`#${panelId}`);
    await expect(panel).toBeHidden();
    await expect(panel.locator("*")).toHaveCount(0);

    // 4) Opening it: in place, the focus stays on the button, the order as paid.
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(more).toBeFocused();
    await expect(panel).toBeVisible();
    await expect(panel.locator(".cosum__line")).toHaveCount(1);
    await expect(panel.locator(".cosum__row--tot")).toContainText("Итого");
    await expect(panel.getByText("Курьер", { exact: true })).toBeVisible();
    await expect(panel.getByText("Банковская карта", { exact: true })).toBeVisible();
    // the order's own total, the one the closed row prints beside the date
    const total = (await panel.locator(".cosum__row--tot .num").textContent())!.trim();
    await expect(row.locator(".muted").first()).toContainText(total);

    // 5) The keyboard closes it again — a real <button>, Enter is a click.
    await page.keyboard.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
    await page.keyboard.press(" ");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press(" ");
    await expect(more).toHaveAttribute("aria-expanded", "false");

    // 6) «Скачать чек (PDF)»: the link, in the page's language…
    const receipt = row.locator(`[data-receiptpdf="${number}"]`);
    await expect(receipt).toHaveText("Скачать чек (PDF)");
    const href = (await receipt.getAttribute("href"))!;
    expect(href).toBe(`/api/account/orders/${encodeURIComponent(number)}/receipt/?lang=ru`);
    // …which, followed with the page's own cookies, is the PDF named after the order…
    const pdf = await page.request.get(href);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    expect(pdf.headers()["content-disposition"]).toContain(`rempire-receipt-${number}.pdf`);
    expect(pdf.headers()["cache-control"]).toContain("no-store");
    const bytes = await pdf.body();
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(3000);
    // …and without them gets nothing: forwarding the link hands nobody the file.
    const stranger = await browser.newContext({ extraHTTPHeaders: ipHeaders(61) });
    try {
      const refused = await stranger.request.get(href);
      expect(refused.status()).toBe(401);
      expect(refused.headers()["content-type"]).not.toContain("application/pdf");
    } finally {
      await stranger.close();
    }

    // 7) Once the owner marks it «Отправлен», the parcel line names how it travels.
    const login = await page.request.post("/api/admin/login/", { data: { password: E2E_ADMIN_PASSWORD } });
    expect(login.ok()).toBe(true);
    const shipped = await page.request.patch(`/api/admin/orders/${number}/`, { data: { status: "shipped" } });
    expect(shipped.ok(), "the order could not be marked shipped").toBe(true);
    await page.goto(shopUrl("", "/account/"));
    await waitForScreen(page, "account");
    const shippedRow = page.locator(".rowcard", { hasText: number });
    await expect(shippedRow.getByText("отправлен", { exact: true })).toBeVisible();
    const parcel = shippedRow.locator(".rowcard__parcel");
    await expect(parcel).toContainText("Курьер");
    await expect(parcel).toContainText("Tallinn");
    // the receipt stays on a shipped order
    await expect(shippedRow.locator(`[data-receiptpdf="${number}"]`)).toBeVisible();

    // 8) A tap on the row's own blank opens it too — the number is not a link.
    await shippedRow.locator(".rowcard__id").click();
    await expect(shippedRow.locator(`[data-acctorder="${number}"]`)).toHaveAttribute("aria-expanded", "true");
  });
});
