import { expect, test } from "@playwright/test";
import { eur, ipHeaders, LANGS, PRODUCT, shopUrl, tr, waitForScreen } from "./fixtures";

/** Gallery, size switch → price, add to cart, cart drawer count, reviews.
 *  Desktop only — see docs/testing.md "Why most specs run on desktop only". */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "functional spec — desktop project only, see docs/testing.md");
});
test.use({ extraHTTPHeaders: ipHeaders(30) });

for (const lang of LANGS) {
  test.describe(`product page — ${lang.code}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(shopUrl(lang.seg, `/p/${PRODUCT.id}/`));
      await waitForScreen(page, "product");
    });

    test("gallery: thumbnails switch the main image", async ({ page }) => {
      const thumbs = page.locator(".pdp__thumbs [data-gal]");
      await expect(thumbs).toHaveCount(3); // catalogue2.js ships 3 photos for PRODUCT

      const stage = page.locator(".pdp__stage .pdp__img").first();
      const before = await stage.getAttribute("style");

      await thumbs.nth(1).click();
      await expect(thumbs.nth(1)).toHaveAttribute("aria-current", "true");
      await expect(async () => {
        expect(await stage.getAttribute("style")).not.toBe(before);
      }).toPass({ timeout: 5_000 });
    });

    test("size switch changes the price", async ({ page }) => {
      const price = page.locator("[data-price]");
      const sizeButtons = page.locator(".sizes [data-size]");
      await expect(sizeButtons).toHaveCount(PRODUCT.sizes.length);

      for (let i = 0; i < PRODUCT.sizes.length; i++) {
        await sizeButtons.nth(i).click();
        await expect(sizeButtons.nth(i)).toHaveAttribute("aria-current", "true");
        await expect(price).toHaveText(eur(PRODUCT.prices[i], lang.code));
      }
    });

    test("add to cart updates the cart badge", async ({ page }) => {
      // A fresh browser context per test (Playwright default) means an empty
      // cart at the start — no need to read a "before" count.
      await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
      await expect(page.getByRole("status")).toBeVisible(); // the "Добавлено в корзину ✓" toast
      await expect(page.locator("[data-cartbadge]")).toHaveText("1");

      // Opening the drawer confirms the line is really there, not just the badge.
      await page.locator("[data-cart]").first().click();
      const dialog = page.getByRole("dialog", { name: /Корзина|Ostukorv|Cart/ });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator(`[data-add="${PRODUCT.id}"], .cline`, { hasText: PRODUCT.brand })).toBeVisible();
    });

    test("reviews block: empty state, then the form opens and validates", async ({ page }) => {
      // acc() persists the Reviews accordion's open state in S.revAccOpen and
      // renders `open` from it (app.js) — a native click on <summary> is
      // captured by a "toggle" listener, and data-revopen/sendReview() set it
      // explicitly before their own render(), so the section no longer
      // collapses shut from under the shopper on any of the actions below.
      const acc = page.locator("details.acc", { hasText: /Отзыв|Arvustus|Review/ }).first();
      await acc.locator("summary").click();
      await expect(acc).toHaveAttribute("open", "");

      // A product nobody has reviewed yet in this fresh database.
      await expect(acc.getByText(tr("Отзывов пока нет — станьте первым.", lang.code))).toBeVisible();

      await acc.locator("[data-revopen]").click();
      const submit = acc.locator("[data-revsend]");
      await expect(submit).toBeDisabled();

      await acc.locator('[data-revf="name"]').fill("E2E Reviewer");
      await acc.locator('[role="radio"][data-revstar="5"]').click();
      await acc.locator('[data-revf="text"]').fill("Отличный товар, пользуюсь уже месяц и всё устраивает полностью.");
      await acc.locator('[data-revf="consent"]').check();
      await expect(submit).toBeEnabled();

      await submit.click();
      await expect(
        acc.getByText(tr("Спасибо! Отзыв отправлен — он появится на странице после проверки.", lang.code)),
      ).toBeVisible();
      // Not just the content — the accordion itself is still open, which is
      // the actual bug this test used to have to route around.
      await expect(acc).toHaveAttribute("open", "");
    });
  });
}

/** Regression: pressing «−» on a cart line at qty 1 used to remove the whole
 *  line. The stepper now floors at 1 and disables «−» there — removal only
 *  ever happens through the explicit «Убрать» control. Interaction logic,
 *  not i18n, so one language is enough (docs/testing.md). */
test.describe("cart drawer — quantity stepper", () => {
  test("«−» at qty 1 is disabled and never removes the line", async ({ page }) => {
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();

    await page.locator("[data-cart]").first().click();
    const dialog = page.getByRole("dialog", { name: /Корзина|Ostukorv|Cart/ });
    await expect(dialog).toBeVisible();
    const line = dialog.locator(".cline").first();
    const minus = line.locator('[data-d="-1"]');
    const plus = line.locator('[data-d="1"]');
    const qty = line.locator("[data-qtyval]");
    await expect(qty).toHaveText("1");
    await expect(minus).toHaveAttribute("aria-disabled", "true");

    // force: true — aria-disabled (not the disabled attribute) keeps the
    // button focusable, and CSS (pointer-events: none) is what actually
    // blocks a pointer click; force bypasses Playwright's own actionability
    // wait so this proves the app.js guard itself, the same way a keyboard
    // Enter on the focused button would reach it.
    await minus.click({ force: true });
    await expect(dialog.locator(".cline")).toHaveCount(1);
    await expect(qty).toHaveText("1");

    // Above 1 the control re-enables, and coming back down to 1 disables it
    // again — still one line throughout, never removed by the stepper.
    await plus.click();
    await expect(qty).toHaveText("2");
    await expect(minus).not.toHaveAttribute("aria-disabled", "true");
    await minus.click();
    await expect(qty).toHaveText("1");
    await expect(minus).toHaveAttribute("aria-disabled", "true");
    await expect(dialog.locator(".cline")).toHaveCount(1);

    // Only the explicit control actually removes the line.
    await line.locator("[data-remove]").click();
    await expect(dialog.locator(".cline")).toHaveCount(0);
  });
});
