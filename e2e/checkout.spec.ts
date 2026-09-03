import { expect, type Page, type Route, test } from "@playwright/test";
import { continueButton, freshEmail, ipHeaders, type LangCode, LANGS, PRODUCT, shopUrl, tr, waitForScreen } from "./fixtures";

/** Cart → checkout → mock payment → receipt (paid and failed). Desktop only
 *  — see docs/testing.md "Why most specs run on desktop only". */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "functional spec — desktop project only, see docs/testing.md");
});

/** `eur()`'s inverse (fixtures.ts documents the forward direction). */
function parseEur(text: string, lang: LangCode): number {
  const digits = lang === "EN" ? text.replace("€", "").replace(",", "") : text.replace("€", "").replace(/\s/g, "").replace(",", ".");
  return Number(digits.trim());
}

async function addProductAndGoToCheckout(page: Page, seg: string): Promise<void> {
  await page.goto(shopUrl(seg, `/p/${PRODUCT.id}/`));
  await waitForScreen(page, "product");
  await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto(shopUrl(seg, "/checkout/"));
  await waitForScreen(page, "checkout");
}

async function fillContactStep(page: Page, email: string): Promise<void> {
  await page.locator("[data-email]").fill(email);
  await continueButton(page, 2).click();
}

for (const [i, lang] of LANGS.entries()) {
  test.describe(`checkout — ${lang.code}`, () => {
    test.use({ extraHTTPHeaders: ipHeaders(40 + i) });

    test("delivery methods: pickup, parcel-machine picker, courier address", async ({ page }) => {
      await addProductAndGoToCheckout(page, lang.seg);
      await fillContactStep(page, freshEmail(`dm-${lang.code}`));

      // Country defaults to EE, where all three methods are offered.
      await expect(page.locator("[data-country]")).toHaveValue("EE");

      await page.locator('input[data-dm="pickup"]').check();
      // Pickup needs no address fields at all.
      await expect(page.locator('[data-shipf="addr"]')).toHaveCount(0);

      await page.locator('input[data-dm="parcel"]').check();
      const carrierChip = page.locator("[data-carrier]").first();
      await expect(carrierChip).toBeVisible();
      await carrierChip.click();
      await page.locator("[data-pointopen]").click();
      const sheet = page.getByRole("dialog", { name: tr("Выбор пакомата", lang.code) });
      await expect(sheet).toBeVisible();
      await sheet.locator("[data-pointq]").fill("Tallinn");
      // Live carrier feed with a seeded fallback (src/lib/parcel-points.ts) —
      // generous timeout, but it always resolves to *something*.
      await expect(sheet.locator("[data-pointpick]").first()).toBeVisible({ timeout: 15_000 });
      await sheet.locator("[data-pointpick]").first().click();
      await expect(page.locator("[data-pointopen]")).not.toHaveText(tr("Выберите пакомат", lang.code));

      await page.locator('input[data-dm="courier"]').check();
      await expect(page.locator('[data-shipf="addr"]')).toBeVisible();
      await expect(page.locator('[data-shipf="zip"]')).toBeVisible();
      await expect(page.locator('[data-shipf="city"]')).toBeVisible();
    });

    test("an invalid promo code shows an error", async ({ page }) => {
      await addProductAndGoToCheckout(page, lang.seg);
      await fillContactStep(page, freshEmail(`promo-${lang.code}`));

      await page.locator('[data-promo]').fill("NOSUCHCODE");
      await page.locator("[data-applypromo]").click();
      await expect(page.locator('div.err[role="alert"]')).toBeVisible();
    });

    test("order summary parity, then mock-pay leads to a paid receipt", async ({ page }) => {
      await addProductAndGoToCheckout(page, lang.seg);
      await fillContactStep(page, freshEmail(`pay-${lang.code}`));

      await page.locator('input[data-dm="courier"]').check();
      await page.locator('[data-shipf="name"]').fill("E2E Buyer");
      await page.locator('[data-shipf="addr"]').fill("Testitänav 1");
      await page.locator('[data-shipf="zip"]').fill("10111");
      await page.locator('[data-shipf="city"]').fill("Tallinn");
      await page.locator('[data-shipf="phone"]').fill("+372 5550000");
      await continueButton(page, 3).click();

      // Card — the only payment method with no further sub-choice (bank
      // links show a chip row; card does not).
      await page.locator('input[data-paym="1"]').check();

      const subtotal = await page
        .locator(".cosum__line .cosum__pr")
        .allTextContents()
        .then((vals) => vals.reduce((sum, v) => sum + parseEur(v, lang.code), 0));
      const shippingText = await page.locator(".cosum__row--rule .num").last().textContent();
      const totalText = await page.locator(".cosum__row--tot .num").textContent();
      const shipping = /бесплатно|tasuta|free/i.test(shippingText || "") ? 0 : parseEur(shippingText || "", lang.code);
      const total = parseEur(totalText || "", lang.code);
      expect(Math.round((subtotal + shipping) * 100)).toBe(Math.round(total * 100));

      await page.locator(".co__pay[data-pay]").click();
      // Same-tab navigation to the mock bank (src/app/api/payments/mock/).
      await page.waitForURL(/\/api\/payments\/mock\//);
      await page.getByRole("link", { name: "Оплатить" }).click();

      await page.waitForURL(/\/shop2.*\/done\/\?.*s=paid/);
      await waitForScreen(page, "done");
      await expect(page.locator("h1")).toHaveText(tr("Заказ оплачен", lang.code));
      await expect(page.locator(".done__num")).toContainText(/R-\d+/);
    });

    test("mock-cancel leads to a failed receipt", async ({ page }) => {
      await addProductAndGoToCheckout(page, lang.seg);
      await fillContactStep(page, freshEmail(`fail-${lang.code}`));

      await page.locator('input[data-dm="courier"]').check();
      await page.locator('[data-shipf="name"]').fill("E2E Buyer");
      await page.locator('[data-shipf="addr"]').fill("Testitänav 1");
      await page.locator('[data-shipf="zip"]').fill("10111");
      await page.locator('[data-shipf="city"]').fill("Tallinn");
      await page.locator('[data-shipf="phone"]').fill("+372 5550000");
      await continueButton(page, 3).click();
      await page.locator('input[data-paym="1"]').check();

      await page.locator(".co__pay[data-pay]").click();
      await page.waitForURL(/\/api\/payments\/mock\//);
      await page.getByRole("link", { name: "Отменить" }).click();

      await page.waitForURL(/\/shop2.*\/done\/\?.*s=failed/);
      await waitForScreen(page, "done");
      await expect(page.locator("h1")).toHaveText(tr("Оплата не прошла", lang.code));
    });
  });
}

/** Pickup delivery («Самовывоз») completing a real order end to end — not
 *  per-language: this is a delivery-method regression check (POST
 *  /api/orders used to 400 bad_name for every pickup order, because the
 *  contact block's name field was only ever rendered for parcel/courier —
 *  shipField()/shipRequired() in app.js), not an i18n one, so one language is
 *  enough — same reasoning visual.spec.ts stays ET-only (docs/testing.md). */
test.describe("checkout — pickup", () => {
  test.use({ extraHTTPHeaders: ipHeaders(43) });

  test("pickup completes an order end to end with the mock provider", async ({ page }) => {
    await addProductAndGoToCheckout(page, "");
    await fillContactStep(page, freshEmail("pickup"));

    await page.locator('input[data-dm="pickup"]').check();
    // Still no address fields for pickup — only the always-on contact block.
    await expect(page.locator('[data-shipf="addr"]')).toHaveCount(0);
    await page.locator('[data-shipf="name"]').fill("E2E Pickup");
    await page.locator('[data-shipf="phone"]').fill("+372 5550001");
    await continueButton(page, 3).click();

    await page.locator('input[data-paym="1"]').check();
    await page.locator(".co__pay[data-pay]").click();
    await page.waitForURL(/\/api\/payments\/mock\//);
    await page.getByRole("link", { name: "Оплатить" }).click();

    await page.waitForURL(/\/shop2.*\/done\/\?.*s=paid/);
    await waitForScreen(page, "done");
    await expect(page.locator("h1")).toHaveText(tr("Заказ оплачен", "RU"));
    await expect(page.locator(".done__num")).toContainText(/R-\d+/);
  });
});

/** Regression: the checkout screen's own background probes (shipping rules,
 *  one loadPointsFor() per carrier — 5 for EE, the signed-in account check,
 *  payment methods) used to call the full render() the instant each landed,
 *  tearing out and recreating the e-mail input on step 1 mid-keystroke — a
 *  visible flicker, and on a phone it also dropped the keyboard. app.js now
 *  coalesces render() itself into one rebuild per animation frame and, for
 *  checkout specifically, has those probes patch their own container
 *  ([data-co-delivery]/[data-co-payment]/[data-co-summary]) instead of
 *  calling render() at all — so the contact block is never touched while
 *  they resolve. All four probes are delayed here so they are still in
 *  flight (or only just landing) while the shopper is mid-keystroke on the
 *  very first field, which is exactly the timing that used to flicker.
 *  Not per-language: this is a DOM-stability check, not an i18n one. */
test.describe("checkout — e-mail field stability", () => {
  test.use({ extraHTTPHeaders: ipHeaders(44) });

  test("the e-mail input is never re-created while the checkout probes resolve", async ({ page }) => {
    const delayed = (body: unknown) => async (route: Route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    };
    await page.route("**/api/overrides/**", delayed({ ok: true, settings: {} }));
    await page.route("**/api/shipping/points/**", delayed({ ok: false }));
    await page.route("**/api/account/me/**", delayed({ ok: false }));
    await page.route(
      "**/api/payments/methods/**",
      delayed({ ok: true, banks: [{ name: "E2E Bank", code: "E2E", logoUrl: null }] }),
    );

    await addProductAndGoToCheckout(page, "");

    const email = page.locator("[data-email]");
    await expect(email).toBeVisible();
    const emailHandle = await email.elementHandle();
    if (!emailHandle) throw new Error("checkout: [data-email] has no element handle");

    // Count DOM mutations on the input's own parent from this point on —
    // "after the initial paint" means from here forward, not from navigation.
    await page.evaluate((input) => {
      const w = window as unknown as Record<string, unknown>;
      w.__coMutations = 0;
      const observer = new MutationObserver((records) => {
        w.__coMutations = (w.__coMutations as number) + records.length;
      });
      observer.observe(input.parentElement as Node, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      w.__coObserver = observer; // kept alive for the duration of the test
    }, emailHandle);

    const typed = "flicker-guard@example.com";
    await email.fill(typed);

    // The four mocked probes above all resolve within ~1.5s; wait past that
    // so the assertions below cover the fully-settled state, not mid-flight.
    await page.waitForTimeout(3000);

    expect(await page.evaluate((input) => input.isConnected, emailHandle)).toBe(true);
    expect(await email.inputValue()).toBe(typed);
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__coMutations)).toBe(0);
  });
});
