import { expect, test, type Page } from "@playwright/test";
import { continueButton, freshEmail, functionalProject, ipHeaders, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

/**
 * The account's settings, all the way to the checkout — the two things Renat
 * found missing at his own checkout on 10.09.2026 (signed in, subscribed, a
 * default delivery set): «Хочу получать новости и скидки» unticked and no
 * delivery preselected — and the save bar that replaced the «Сохранить»
 * button he could not find between the birthday and the delivery block.
 *
 * Same login mechanics as account.spec.ts: E2E_EXPOSE_LOGIN_CODE=1 rides the
 * six-digit code along in the /api/account/code response (docs/testing.md),
 * and the spec types it where a person would.
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(!functionalProject(testInfo), "functional spec — desktop and mobile-safari projects only, see docs/testing.md");
});

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(shopUrl("", "/account/"));
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

type Profile = {
  birthday: string | null;
  marketing: boolean;
  shipPref: null | { country: string; method: string; carrier: string; machine: string };
};

/** What the server holds for the signed-in address — page.request shares the context's cookie jar. */
async function profile(page: Page): Promise<Profile> {
  const res = await page.request.get("/api/account/me/");
  expect(res.ok(), "GET /api/account/me/ refused the signed-in shopper").toBe(true);
  return ((await res.json()) as { customer: Profile }).customer;
}

test.describe("account — the settings reach the checkout", () => {
  test.use({ extraHTTPHeaders: ipHeaders(56) });

  test("newsletter consent and the default delivery are what the checkout starts on", async ({ page }) => {
    const email = freshEmail("acct-settings");
    await signIn(page, email);
    const save = page.locator("[data-save]");
    const note = page.locator("[data-acctnote]");
    // a fresh account: nothing differs from the server, the bar is quiet
    await expect(save).toHaveClass(/btn--ghost/);
    await expect(save).toBeDisabled();

    // the newsletter tick and a parcel machine — both through the one Save
    await page.locator("[data-acctmk]").check();
    await expect(save).not.toHaveClass(/btn--ghost/);
    await expect(save).toBeEnabled();
    await expect(note).toHaveText("Изменения не сохранены");

    const row = page.locator(".optlist .opt").filter({ hasText: "Пакомат Omniva" }).first();
    const feed = page.waitForResponse((r) => r.url().includes("/api/shipping/points/") && r.url().includes("carrier=omniva"));
    await row.locator("input[data-acctm]").check();
    await feed;
    const machines = page.locator("[data-acctmachine]");
    await expect(machines).toBeEnabled();
    await expect.poll(async () => (await machines.locator("option").count())).toBeGreaterThan(1);
    // index 0 is the placeholder: a machine is chosen, never assumed
    await machines.selectOption({ index: 1 });
    const machine = (await machines.inputValue()).trim();
    expect(machine.length, "no parcel machine offered in the account").toBeGreaterThan(0);

    await save.click();
    await expect(save).toContainText("Сохранено ✓");
    await expect(save).toHaveClass(/btn--ghost/);
    await expect(note).toHaveText("");

    // the server really holds both
    const stored = await profile(page);
    expect(stored.marketing).toBe(true);
    expect(stored.shipPref).toEqual({ country: "EE", method: "parcel", carrier: "omniva", machine });

    // …and the checkout starts on them
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    await expect(page.locator("[data-news]"), "the account's consent never reached the checkout's box").toBeChecked();
    await page.locator("[data-email]").fill(email);
    await continueButton(page, 2).click();
    await expect(page.locator('input[data-dm="parcel"]')).toBeChecked();
    await expect(page.locator('[data-carrier="omniva"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator("[data-pointopen]")).toContainText(machine);

    // the shopper's own hand still wins over the stored default, in this session
    await page.locator('input[data-dm="courier"]').check();
    await expect(page.locator('input[data-dm="courier"]')).toBeChecked();
  });
});

test.describe("account — the save bar", () => {
  test.use({ extraHTTPHeaders: ipHeaders(57) });

  test("a changed birthday lights the bar, Save stores it, the bar goes quiet", async ({ page }) => {
    const email = freshEmail("acct-savebar");
    await signIn(page, email);
    const save = page.locator("[data-save]");
    const note = page.locator("[data-acctnote]");
    const birthday = page.locator('[data-acctf="birthday"]');
    await expect(save).toHaveClass(/btn--ghost/);
    await expect(save).toBeDisabled();
    await expect(note).toHaveText("");

    await birthday.fill("1990-04-17");
    await expect(save).not.toHaveClass(/btn--ghost/);
    await expect(save).toBeEnabled();
    await expect(save).toHaveText("Сохранить");
    await expect(note).toHaveText("Изменения не сохранены");
    // …and the bar is on screen without scrolling, wherever the field is
    await expect(save).toBeInViewport();

    await save.click();
    await expect(save).toContainText("Сохранено ✓");
    await expect(save).toHaveClass(/btn--ghost/);
    await expect(save).toBeDisabled();
    await expect(note).toHaveText("");
    expect((await profile(page)).birthday).toBe("1990-04-17");

    // the same value back is not a change; another one is
    await birthday.fill("1990-04-17");
    await expect(save).toHaveClass(/btn--ghost/);
    await birthday.fill("1991-05-18");
    await expect(save).not.toHaveClass(/btn--ghost/);

    // a reload shows what is stored, with nothing to save
    await page.reload();
    await waitForScreen(page, "account");
    await expect(page.locator('[data-acctf="birthday"]')).toHaveValue("1990-04-17");
    await expect(page.locator("[data-save]")).toHaveClass(/btn--ghost/);
  });
});
