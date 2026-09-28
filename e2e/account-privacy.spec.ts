import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { freshEmail, functionalProject, ipHeaders, payOrder, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

/**
 * «Данные и аккаунт» at the foot of «Кабинет» (Dim, 28.09.2026): «Скачать мои
 * данные» downloads the account's own JSON file, and «Удалить аккаунт» opens
 * the shop's sheet, which refuses while an order is on its way and otherwise
 * asks for the account's own e-mail before the red «Удалить» wakes up.
 * The server half is tests/account-privacy.test.ts, the dialog's logic
 * tests/acct-privacy-ui.test.ts; this is the whole thing in a browser.
 *
 * Same login mechanics as account.spec.ts: E2E_EXPOSE_LOGIN_CODE=1 rides the
 * six-digit code along in the /api/account/code response (docs/testing.md).
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(!functionalProject(testInfo), "functional spec — desktop and mobile-safari projects only, see docs/testing.md");
});

async function signIn(page: Page, email: string, seg = ""): Promise<void> {
  await page.goto(shopUrl(seg, "/account/"));
  await waitForScreen(page, "account");
  await page.locator("[data-email]").fill(email);
  const codeResponse = page.waitForResponse((r) => r.url().includes("/api/account/code/"));
  await page.locator("[data-login]").click();
  const body = (await (await codeResponse).json()) as { code?: string };
  expect(body.code, "the e2e login-code hook did not answer").toMatch(/^\d{6}$/);
  await page.locator("[data-acctcode]").fill(body.code!);
  await page.locator("[data-logincode]").click();
  await expect(page.locator("[data-logout]")).toBeVisible();
}

test.describe("account — my data and deleting the account", () => {
  test.use({ extraHTTPHeaders: ipHeaders(252) });

  test("the export downloads this account's file; a paid order still on its way blocks the deletion", async ({ page }) => {
    const email = freshEmail("acct-privacy-open");
    // one paid order: «оплачен», not delivered — the deletion must wait for it
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    const orderNumber = await payOrder(page, email, "paid");

    await signIn(page, email);
    await expect(page.getByRole("heading", { name: "Данные и аккаунт" })).toBeVisible();

    // «Скачать мои данные» — a plain link; the browser downloads the file with the cookie
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Скачать мои данные" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^rempire-mydata-\d{4}-\d{2}-\d{2}\.json$/);
    const file = JSON.parse(readFileSync(await download.path(), "utf8")) as {
      email: string;
      orders: Array<{ number: string; status: string }>;
    };
    expect(file.email).toBe(email);
    expect(file.orders.map((o) => o.number)).toContain(orderNumber);

    // «Удалить аккаунт» — the sheet says why not yet, and names the order
    const opener = page.getByRole("button", { name: "Удалить аккаунт" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Удалить аккаунт?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Пока заказ не доставлен, удалить аккаунт нельзя");
    await expect(dialog).toContainText(orderNumber);
    await expect(dialog.locator("[data-acctdelmail]")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Понятно" }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();

    // nothing was deleted: the account is still here
    expect((await page.request.get("/api/account/me/")).status()).toBe(200);
  });

  test("the account's own e-mail, typed, wakes the red «Удалить»; deleting lands on the home page, signed out", async ({ page }) => {
    const email = freshEmail("acct-privacy-delete");
    await signIn(page, email);

    const opener = page.getByRole("button", { name: "Удалить аккаунт" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Удалить аккаунт?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Заказы останутся у магазина");
    await expect(dialog).toContainText("«Покупатель»");

    // Escape is «Отмена», and the focus goes back where it came from
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.click();
    await expect(dialog).toBeVisible();

    const box = dialog.locator("[data-acctdelmail]");
    const red = dialog.getByRole("button", { name: "Удалить", exact: true });
    await expect(red).toBeDisabled();
    await box.fill("somebody-else@example.com");
    await expect(red).toBeDisabled();
    // Enter only puts the keyboard away — it never deletes
    await box.fill(email.toUpperCase());
    await box.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(red).toBeEnabled();

    const answer = page.waitForResponse((r) => r.url().includes("/api/account/delete/") && r.request().method() === "POST");
    await red.click();
    expect((await answer).status()).toBe(200);
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("status")).toContainText("Аккаунт удалён");
    await waitForScreen(page, "home");

    // the cookie went with the answer: the account screen asks for an e-mail again
    expect((await page.request.get("/api/account/me/")).status()).toBe(401);
    await page.goto(shopUrl("", "/account/"));
    await waitForScreen(page, "account");
    await expect(page.locator("[data-login]")).toBeVisible();

    // signing in again is a new, empty account
    await signIn(page, email);
    await expect(page.getByText("Заказов пока нет. Всё, что вы закажете с этой почты, появится здесь.")).toBeVisible();
  });
});

test.describe("account — deleting, in Estonian", () => {
  test.use({ extraHTTPHeaders: ipHeaders(253) });

  test("the block and the sheet speak the page's language", async ({ page }) => {
    const email = freshEmail("acct-privacy-et");
    await signIn(page, email, "/et");
    await expect(page.getByRole("heading", { name: "Andmed ja konto" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Laadi oma andmed alla" })).toBeVisible();
    await page.getByRole("button", { name: "Kustuta konto" }).click();
    const dialog = page.getByRole("dialog", { name: "Kustutada konto?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Tellimused jäävad poele alles");
    await expect(dialog.getByRole("button", { name: "Kustuta", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Tühista" }).click();
    await expect(dialog).toBeHidden();
  });
});
