/**
 * Storefront QA sweep, part 2 — regressions found by the 06.09.2026 audit
 * (docs/audit/2026-09-06-storefront-qa.md). Each test pins one thing a
 * shopper could actually hit; the crawl and the randomised checkout stay in
 * sweep-storefront.spec.ts / sweep-checkout.spec.ts.
 *
 *  - the cart drawer's stepper priced a set or a gift-card line through
 *    byId(), whose fallback is the first catalogue product — «×2 = 18 €» on a
 *    34,90 € set;
 *  - the filter drawer's «Показать N товаров» was patched in Russian on an
 *    ET/EN catalogue the moment a checkbox was ticked;
 *  - the e-mail and address notes drawn on blur skipped the dictionary, so a
 *    keyboard user tabbing through an Estonian checkout read Russian;
 *  - on the account screen the blur that removes the e-mail error moved
 *    «Получить код» up from under the finger, and the first tap was lost;
 *  - a deep link with a malformed percent-encoding (/shop2/search/?q=%E0,
 *    a mangled share) threw URIError out of the router and left the
 *    prerendered page under the app;
 *  - the chat bubble took its language from the saved preference, not from
 *    the page — a first visit to /shop2/et/ was greeted in Russian — and
 *    printed «9 €» on the English shop that says «€9».
 *
 * Desktop + mobile-safari like the other functional specs; the lost-tap
 * test also runs on the Chromium phone project, because it is about a
 * finger on a 360-px screen.
 */
import { expect, test } from "@playwright/test";
import { BUNDLE, eur, functionalProject, ipHeaders, LANGS, PRODUCT, shopUrl, tr, waitForScreen } from "./fixtures";

test.beforeEach(async ({}, testInfo) => {
  test.skip(
    !functionalProject(testInfo) && testInfo.project.name !== "mobile",
    "functional spec — desktop, mobile and mobile-safari projects, see docs/testing.md",
  );
});

test.describe("cart drawer — set and gift-card lines", () => {
  test.use({ extraHTTPHeaders: ipHeaders(190) });

  test("«+» keeps a set and a gift card priced by their own unit, not the first product's", async ({ page }) => {
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();

    await page.goto(shopUrl("", "/gift/"));
    await waitForScreen(page, "gift");
    await page.locator('[data-giftamt="50"]').click();
    await page.locator('[data-addgift="50"]').click();
    await expect(page.getByRole("status")).toBeVisible();

    await page.goto(shopUrl("", `/set/${BUNDLE.id}/`));
    await waitForScreen(page, "bundle");
    await page.locator(`[data-addbundle="${BUNDLE.id}"]`).first().click();
    await expect(page.getByRole("status")).toBeVisible();

    await page.locator("[data-cart]:visible").first().click();
    const drawer = page.getByRole("dialog", { name: "Корзина" });
    await expect(drawer).toBeVisible();
    const lines = drawer.locator(".cline");
    await expect(lines).toHaveCount(3);

    // one press of «+» on every line — the patched price must follow the line's own unit
    for (let i = 0; i < 3; i++) await lines.nth(i).locator('[data-d="1"]').click();
    await expect(lines.nth(0).locator("[data-linepr]")).toHaveText(eur(PRODUCT.prices[0] * 2, "RU"));
    await expect(lines.nth(1).locator("[data-linepr]")).toHaveText(eur(50 * 2, "RU"));
    await expect(lines.nth(2).locator("[data-linepr]")).toHaveText(eur(BUNDLE.price * 2, "RU"));
    await expect(drawer.locator(".drawer__tot .num")).toHaveText(eur((PRODUCT.prices[0] + 50 + BUNDLE.price) * 2, "RU"));
  });
});

for (const [i, lang] of LANGS.entries()) {
  if (lang.code === "RU") continue;

  test.describe(`translated patches — ${lang.code}`, () => {
    test.use({ extraHTTPHeaders: ipHeaders(191 + i) });

    test("the filter drawer's «Показать N» button follows the dictionary after a tick", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/c/hair/"));
      await waitForScreen(page, "catalog");
      await page.locator("[data-filter]").click();
      const show = page.locator("[data-showbtn]");
      const pattern = lang.code === "ET" ? /^Näita \d+ toodet$/ : /^Show \d+ products$/;
      await expect(show).toHaveText(pattern);
      await page.locator("[data-brand]").first().check();
      await expect(show).toHaveText(pattern);
      await page.locator("[data-instock]").check();
      await expect(show).toHaveText(pattern);
    });

    test("the e-mail and address notes drawn on blur are translated", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, `/p/${PRODUCT.id}/`));
      await waitForScreen(page, "product");
      await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
      await expect(page.getByRole("status")).toBeVisible();
      await page.goto(shopUrl(lang.seg, "/checkout/"));
      await waitForScreen(page, "checkout");

      const email = page.locator("[data-email]");
      await email.fill("bad");
      await page.keyboard.press("Tab");
      await expect(page.locator('.costep__body div.err[role="alert"]')).toHaveText(tr("В адресе не хватает знака @.", lang.code));

      await email.fill(`blur-${lang.code}@example.com`);
      await page.locator('button.btn--wide[data-step="2"]').click();
      await page.locator('input[data-dm="courier"]').check();
      // the first «Далее — оплата» with empty fields switches the step's
      // errors on; from then on every field is re-checked on blur
      await page.locator('button.btn--wide[data-step="3"]').click();
      await page.locator('[data-shipf="phone"]').fill("12");
      await page.keyboard.press("Tab");
      await expect(page.locator('label:has([data-shipf="phone"]) div.err')).toHaveText(
        tr("Проверьте номер — похоже, в нём не хватает цифр.", lang.code),
      );
      await page.locator('[data-shipf="name"]').fill("x");
      await page.locator('[data-shipf="name"]').fill("");
      await page.keyboard.press("Tab");
      await expect(page.locator('label:has([data-shipf="name"]) div.err')).toHaveText(
        tr("Впишите имя и фамилию — их напечатают на посылке.", lang.code),
      );
    });
  });
}

test.describe("account — the first tap after correcting the address", () => {
  test.use({ extraHTTPHeaders: ipHeaders(194) });

  test("«Получить код» is not lost when the error note disappears on blur", async ({ page }) => {
    await page.goto(shopUrl("", "/account/"));
    await waitForScreen(page, "account");
    await page.locator("[data-email]").fill("bad");
    await page.locator("[data-login]").click();
    await expect(page.locator('div.err[role="alert"]')).toBeVisible();

    await page.locator("[data-email]").fill(`first-tap-${Date.now()}@example.com`);
    // one click, as a person taps: mousedown blurs the field, the note goes,
    // and the button must still be under the pointer for mouseup
    await page.locator("[data-login]").click();
    await expect(page.locator("[data-acctcode]")).toBeVisible();
  });
});

test.describe("checkout — a signed-in shopper's address", () => {
  test.use({ extraHTTPHeaders: ipHeaders(197) });

  test("the e-mail box shows the account's address once the profile lands, and what is typed wins", async ({ page }) => {
    const email = `signed-in-${Date.now()}@example.com`;
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

    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();

    // a cold load of the checkout: step 1 paints before /api/account/me/ answers
    const me = page.waitForResponse((r) => r.url().includes("/api/account/me/"));
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    await me;
    await expect(page.locator("[data-email]")).toHaveValue(email);

    // …and an address typed before the profile lands is not overwritten by it
    const other = `typed-${Date.now()}@example.com`;
    const me2 = page.waitForResponse((r) => r.url().includes("/api/account/me/"));
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    await page.locator("[data-email]").fill(other);
    await me2;
    await expect(page.locator("[data-email]")).toHaveValue(other);
    await page.locator('button.btn--wide[data-step="2"]').click();
    await expect(page.locator(".costep__v").first()).toHaveText(other);
  });
});

test.describe("checkout — an all-gift-card order", () => {
  test.use({ extraHTTPHeaders: ipHeaders(198) });

  test("«Далее — оплата» insists on the recipient's address once «send to me» is off", async ({ page }) => {
    await page.goto(shopUrl("", "/gift/"));
    await waitForScreen(page, "gift");
    await page.locator('[data-addgift="50"]').click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    await page.locator("[data-email]").fill(`gift-to-${Date.now()}@example.com`);
    await page.locator('button.btn--wide[data-step="2"]').click();
    await expect(page.locator("[data-gifttome]")).toBeChecked();
    await page.locator("[data-gifttome]").uncheck();
    await page.locator('[data-shipf="name"]').fill("Kati");

    // the same refusal the pay button already had, one step earlier
    await page.locator('button.btn--wide[data-step="3"]').click();
    await expect(page.locator('input[data-paym="1"]')).toHaveCount(0);
    await expect(page.locator('[data-giftto="email"]')).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator('[data-giftto="email"]')).toBeFocused();

    await page.locator('[data-giftto="email"]').fill("mari@example.com");
    await page.locator('button.btn--wide[data-step="3"]').click();
    await expect(page.locator('input[data-paym="1"]')).toBeVisible();
  });
});

test.describe("router — malformed addresses", () => {
  test.use({ extraHTTPHeaders: ipHeaders(195) });

  test("a bad percent-encoding is not a page error and the shop still boots", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const cases: Array<[string, string]> = [
      ["/search/?q=%E0", "search"],
      ["/b/%E0/", "home"],
      ["/set/%E0/", "bundle"],
      ["/et/search/?q=%E0%E0", "search"],
    ];
    for (const [path, screen] of cases) {
      await page.goto(`/shop2${path}`);
      await waitForScreen(page, screen);
      // the static page under the app is dropped once the first render lands
      await expect(page.locator("#prerender"), `${path}: the prerendered page stayed under the app`).toHaveCount(0);
      expect(errors, `${path}: uncaught page error`).toEqual([]);
    }
  });
});

test.describe("chat — the language on screen", () => {
  test.use({ extraHTTPHeaders: ipHeaders(196) });

  test("a first visit to /et/ is greeted in Estonian; the English shop prices like the shop", async ({ page }) => {
    await page.goto(shopUrl("/et", "/"));
    await waitForScreen(page, "home");
    await page.locator(".sbot__fab").click();
    await expect(page.locator("[data-bt]")).toHaveText("Rempire abiline");
    await expect(page.locator(".sbot__msg--bot").first()).toContainText("Tere!");

    await page.goto(shopUrl("/en", "/"));
    await waitForScreen(page, "home");
    await page.locator(".sbot__fab").click();
    await expect(page.locator("[data-bt]")).toHaveText("Rempire assistant");
    await page.locator(".sbot__form input").fill("shampoo");
    await page.locator(".sbot__send").click();
    await expect(page.locator(".sbot__pp").first()).toHaveText(/^(from )?€\d/);
  });
});
