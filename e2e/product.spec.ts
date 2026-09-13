import { expect, test } from "@playwright/test";
import { BUNDLE, eur, functionalProject, ipHeaders, LANGS, PRODUCT, shopUrl, tr, waitForScreen } from "./fixtures";

/** Gallery, size switch → price, add to cart, cart drawer count, reviews.
 *  Desktop only — see docs/testing.md "Why most specs run on desktop only". */
test.beforeEach(async ({}, testInfo) => {
  test.skip(!functionalProject(testInfo), "functional spec — desktop and mobile-safari projects only, see docs/testing.md");
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
      // refocus('[data-revf="name"]') in app.js only lands when the field sits
      // inside a still-open <details>; a collapsed one made it a silent no-op.
      await expect(acc.locator('[data-revf="name"]')).toBeFocused();
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
    // Enter on the focused button would reach it. That same bypass skips the
    // stability wait too, and the drawer is still sliding in at this point —
    // a forced click dispatched mid-animation landed on «+» one run in four.
    // Hovering «+» first waits for the row to stop moving (hover keeps the
    // actionability checks) without pressing anything.
    await plus.hover();
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

  /* Ренат, 13.09.2026: «Cannot put more than 9 items to the cart.» Seven
     literal `Math.min(9, …)` in app.js — one per way a quantity can change —
     and nothing ever chose nine: the order route's own limit is 99. A salon
     buying ten of a shampoo could not. */
  test("the stepper goes past nine, all the way to the order route's own limit", async ({ page }) => {
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();

    await page.locator("[data-cart]").first().click();
    const dialog = page.getByRole("dialog", { name: /Корзина|Ostukorv|Cart/ });
    const line = dialog.locator(".cline").first();
    const plus = line.locator('[data-d="1"]');
    const qty = line.locator("[data-qtyval]");

    for (let i = 1; i < 10; i++) await plus.click();
    await expect(qty).toHaveText("10");
    // the badge counts the goods, not the lines
    await expect(page.locator("[data-cartbadge]")).toHaveText("10");

    // …and it does stop somewhere: 99, the number src/lib/orders.ts refuses
    // above. A basket the shop will not price is worse than a stepper that ends.
    for (let i = 10; i < 105; i++) await plus.click();
    await expect(qty).toHaveText("99");
  });
});

/* Ренат, 13.09.2026: «the "remove" button is sometimes behind the "+" and
   sometimes on second row — this should remain same for all and be inline if
   possible (seems to be)».
 *
 * Both happened, and neither was decided by the kind of line: the stepper and
 * «Убрать» sat loose in `.cline__mid`, a plain block, so they shared one
 * anonymous line box and wrapped — or collided with the price column — purely
 * on how much width the name and the price left them. `.cline__acts` is that
 * row made explicit. Measured rather than eyeballed, on the narrow viewport
 * where it actually broke, with a product, a set and a gift card in the same
 * basket so "the same for all" is what is asserted.
 */
test.describe("cart drawer — every line lays its controls out the same way", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("stepper and «Убрать» stay inline on a product, a set and a gift card", async ({ page }) => {
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();

    // a set and a gift card, so all three kinds of line are in one basket
    await page.goto(shopUrl("", "/sets/"));
    await waitForScreen(page, "bundles");
    await page.locator(`[data-addbundle="${BUNDLE.id}"]`).first().click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/gift/"));
    await waitForScreen(page, "gift");
    await page.locator('[data-giftamt="25"]').click();
    await page.locator('[data-giftf="name"]').fill("Mari");
    await page.locator('[data-addgift="25"]').click();
    await expect(page.getByRole("status")).toBeVisible();

    await page.locator("[data-cart]").first().click();
    const dialog = page.getByRole("dialog", { name: /Корзина|Ostukorv|Cart/ });
    await expect(dialog).toBeVisible();
    const lines = dialog.locator(".cline");
    expect(await lines.count()).toBeGreaterThanOrEqual(3);

    /* The drawer really is the narrow one. Without this the whole test would
       quietly pass at the project's own 1280px, where it never broke — and the
       viewport is what this test is about. `min(390px, 92vw)` = 345 at 375. */
    const drawerWidth = await dialog.evaluate((el) => Math.round(el.getBoundingClientRect().width));
    expect(drawerWidth, "the viewport override did not take — this is not a phone").toBeLessThanOrEqual(345);

    const rows = await lines.evaluateAll((els) =>
      els.map((el) => {
        const acts = el.querySelector(".cline__acts") as HTMLElement;
        const step = el.querySelector(".stepper") as HTMLElement;
        const rm = el.querySelector(".cline__rm") as HTMLElement;
        const a = acts.getBoundingClientRect();
        const s = step.getBoundingClientRect();
        const r = rm.getBoundingClientRect();
        return {
          // one line box: the acts row is no taller than the tallest control
          wrapped: Math.round(a.height) > Math.round(Math.max(s.height, r.height)) + 1,
          // «Убрать» is to the RIGHT of «+», never on top of it
          overlaps: r.left < s.right - 1,
          // the same vertical centre, whatever the line is
          centre: Math.round(s.top + s.height / 2) - Math.round(r.top + r.height / 2),
          // …and neither escapes the drawer
          escapes: Math.round(r.right) > Math.round(el.getBoundingClientRect().right) + 1,
        };
      }),
    );
    for (const [i, row] of rows.entries()) {
      expect(row.wrapped, `line ${i}: «Убрать» wrapped to a second row`).toBe(false);
      expect(row.overlaps, `line ${i}: «Убрать» sits on top of the «+»`).toBe(false);
      expect(Math.abs(row.centre), `line ${i}: the controls are not on one baseline`).toBeLessThanOrEqual(1);
      expect(row.escapes, `line ${i}: the controls run out of the line`).toBe(false);
    }

    // no sideways scrolling on a 375px phone, which is where it used to break
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the cart drawer scrolls sideways at 375px").toBeLessThanOrEqual(0);

    // …and the same on the narrowest phone anyone still carries
    await page.setViewportSize({ width: 320, height: 568 });
    const narrow = await lines.evaluateAll((els) =>
      els.map((el) => {
        const step = (el.querySelector(".stepper") as HTMLElement).getBoundingClientRect();
        const rm = (el.querySelector(".cline__rm") as HTMLElement).getBoundingClientRect();
        return { overlaps: rm.left < step.right - 1, escapes: Math.round(rm.right) > Math.round(el.getBoundingClientRect().right) + 1 };
      }),
    );
    for (const [i, row] of narrow.entries()) {
      expect(row.overlaps, `line ${i} at 320px: «Убрать» sits on top of the «+»`).toBe(false);
      expect(row.escapes, `line ${i} at 320px: the controls run out of the line`).toBe(false);
    }
  });
});
