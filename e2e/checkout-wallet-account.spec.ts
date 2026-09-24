import { expect, test } from "@playwright/test";
import { continueButton, freshEmail, functionalProject, ipHeaders, payButton, payOrder, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

/**
 * «Купить через G Pay» for a signed-in customer whose details are complete
 * (Dim, 23.09.2026, option «A»): the checkout opens straight on «Оплата»,
 * with contact and delivery folded above it — and signed out it opens on
 * step 1 exactly as before. Nothing new is drawn anywhere; only the step the
 * checkout starts on changes (coFirstOpenStep() in public/shop2/app.js).
 *
 * The complete details come from the shop itself: one paid courier order
 * under the address (payOrder fills name, address and phone), then a
 * sign-in with the code the e2e server exposes — the same path account.spec
 * takes.
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(!functionalProject(testInfo), "functional spec — desktop and mobile-safari projects only, see docs/testing.md");
});

test.describe("checkout — wallet button from a filled-in account", () => {
  test.use({ extraHTTPHeaders: ipHeaders(71) });

  test("signed in and complete → «Оплата» at once; signed out → step 1", async ({ page }) => {
    const email = freshEmail("wallet-acct");

    // 1) One paid courier order: the checkout now knows name, address, phone.
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    await payOrder(page, email, "paid");

    // 2) Sign in with the code the e2e server hands back.
    await page.goto(shopUrl("", "/account/"));
    await waitForScreen(page, "account");
    await page.locator("[data-email]").fill(email);
    const codeResponse = page.waitForResponse((r) => r.url().includes("/api/account/code/"));
    await page.locator("[data-login]").click();
    const code = ((await (await codeResponse).json()) as { code?: string }).code;
    expect(code).toMatch(/^\d{6}$/);
    await page.locator("[data-acctcode]").fill(code!);
    await page.locator("[data-logincode]").click();
    await expect(page.locator("[data-logout]")).toBeVisible();

    // 2a) Complete the account: name and phone save as each field is left,
    //     and the default delivery is the shop's own pickup — a choice that
    //     needs no machine and no address (row 0 in Estonia).
    const name = page.locator('[data-acctf="name"]');
    await name.fill("E2E Wallet");
    await name.blur();
    await expect(page.locator('[data-acctst="name"]')).toContainText("✓");
    const phone = page.locator('[data-acctf="phone"]');
    await phone.fill("+372 5550002");
    await phone.blur();
    await expect(page.locator('[data-acctst="phone"]')).toContainText("✓");
    const saved = page.waitForResponse((r) => r.url().includes("/api/account/me/") && r.request().method() === "PATCH");
    await page.locator('input[data-acctm="0"]').check();
    expect((await saved).ok()).toBe(true);

    // 3) The wallet button: «Оплата» is open, the two steps above are folded.
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.btn--express[data-buynow="${PRODUCT.id}"]`).click();
    await waitForScreen(page, "checkout");
    await expect(payButton(page)).toBeVisible();
    await expect(payButton(page)).toContainText("€");
    await expect(continueButton(page, 2)).toHaveCount(0);
    await expect(continueButton(page, 3)).toHaveCount(0);
    // folded, not gone: the delivery step's head is still there to reopen
    await expect(page.locator('.costep__head[data-step="2"]')).toBeVisible();

    // 4) Signed out, the same button opens step 1, as it always did.
    await page.goto(shopUrl("", "/account/"));
    await waitForScreen(page, "account");
    await page.locator("[data-logout]").click();
    await expect(page.locator("[data-login]")).toBeVisible();
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.btn--express[data-buynow="${PRODUCT.id}"]`).click();
    await waitForScreen(page, "checkout");
    await expect(continueButton(page, 2)).toBeVisible();
    // …and nothing of the signed-out account is left in it (24.09.2026)
    await expect(page.locator("[data-email]")).toHaveValue("");
  });
});
