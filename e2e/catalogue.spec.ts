import { expect, test } from "@playwright/test";
import { CATEGORY, eur, ipHeaders, LANGS, PRODUCT, shopUrl, tr, waitForScreen } from "./fixtures";

/** Category nav, brand page, search, infinite scroll, and the size picker
 *  that lives inside every product card.
 *
 *  The desktop-only guard used to be one file-level `beforeEach`. It is a
 *  per-describe call now because one block in this file — "card size picker —
 *  layout" — is the exception the rule allows for: a native `<select>` is as
 *  wide as its widest option and a card is a 150px grid track on a phone, so
 *  that one test has to run at 375px too (docs/testing.md "Why most specs run
 *  on desktop only"). Everything else here is business logic that does not
 *  change with viewport width and still opts in to desktop only. */
function desktopOnly(): void {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "functional spec — desktop project only, see docs/testing.md");
  });
}
test.use({ extraHTTPHeaders: ipHeaders(20) });

/** A single-size, in-stock product sitting in the same /c/hair/ listing as
 *  PRODUCT — the control case for "no picker where there is nothing to pick".
 *  Its price is deliberately not asserted anywhere: the admin sweeps may edit
 *  a randomly sampled product's price, and this test only cares about the
 *  absence of a control. */
const SINGLE_SIZE_PRODUCT = "touchable";

for (const lang of LANGS) {
  test.describe(`catalogue — ${lang.code}`, () => {
    desktopOnly();

    test("category navigation lists products", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");

      await page.locator(`[data-go-cat="${CATEGORY.id}"]`).first().click();
      await waitForScreen(page, "catalog");
      await expect(page).toHaveURL(new RegExp(`/shop2${lang.seg}/c/${CATEGORY.id}/?$`));

      await expect(page.locator("#catgrid .card").first()).toBeVisible();
      // "N товаров" / "N toodet" / "N products" — assert the number only,
      // the surrounding word is a UI_RX-templated string (app.js), not a
      // fixed dictionary key, so a regex on the digits is the robust check.
      await expect(page.locator("[data-count]")).toHaveText(/\d+/);
    });

    test("brand page shows only that brand's products", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");

      await page.locator(`.brandstrip__it[data-go-brand="${PRODUCT.brand}"]`).click();
      await waitForScreen(page, "catalog");
      // A brand with a logo (BRAND_LOGOS, brandMark() in app.js) renders
      // `<span role="img" aria-label="…">` — a CSS background-image, not a
      // real <img>/alt — instead of plain text; System 4 is one of those.
      // getByRole('img', {name}) reads the computed accessible name (works
      // for both that case and the plain-text one other brands use), where
      // .textContent() would see an empty string and getByAltText() would
      // never match at all (there is no `alt` attribute here to read).
      await expect(page.getByText(PRODUCT.brand).or(page.getByRole("img", { name: PRODUCT.brand })).first()).toBeVisible();
      await expect(page.locator("#catgrid .card").first()).toBeVisible();
    });

    test("search finds results and shows an empty state for gibberish", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");

      // Brand names are not translated (Latin, no Cyrillic — translateTree()
      // skips them), so one query string works in all three languages.
      await page.locator("[data-search]").fill("System");
      await waitForScreen(page, "search");
      await expect(page).toHaveURL(/\/search\/\?q=System/);
      await expect(page.locator(".grid .card").first()).toBeVisible();

      await page.locator("[data-search2]").fill("zzzznonexistentquery12345");
      await expect(page.locator(".empty, .muted", { hasText: "zzzznonexistentquery12345" })).toBeVisible();
    });

    test("infinite scroll appends more products", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/c/hair/")); // hair has the most SKUs — guarantees >12
      await waitForScreen(page, "catalog");

      const cards = page.locator("#catgrid .card");
      const before = await cards.count();
      expect(before).toBeGreaterThan(0);

      const sentinel = page.locator("#sentinel");
      if ((await sentinel.count()) === 0) {
        test.skip(true, "fewer than 12 products in this category — nothing to page in");
      }
      await sentinel.scrollIntoViewIfNeeded();
      // The observer debounces on a 320ms timer (app.js) before appending.
      await expect(async () => {
        expect(await cards.count()).toBeGreaterThan(before);
      }).toPass({ timeout: 5_000 });
    });
  });

  /* The size picker inside a product card (cardSizeHTML/cardPriceText in
   * app.js). «В корзину» on a card used to add the smallest size silently;
   * the card now carries a native <select>, the price follows it and the add
   * button puts THAT size in the cart at qty 1. Trilingual because the
   * control's only label is an aria-label that goes through the dictionary,
   * and because the price format itself is language-dependent. */
  test.describe(`card size picker — ${lang.code}`, () => {
    desktopOnly();

    /** PRODUCT's card in the /c/hair/ grid. Re-queried rather than held in a
     *  variable: patchCatalog() and render() both replace the element. */
    const cardFor = (page: import("@playwright/test").Page, id: string) =>
      page.locator(".card", { has: page.locator(`[data-go-product="${id}"]`) }).first();
    /** Opens the card's size listbox and picks option `i`; the foot row is
     *  rebuilt in place, so everything is re-queried afterwards. */
    const pick = async (page: import("@playwright/test").Page, id: string, i: number) => {
      await cardFor(page, id).locator("[data-cardsizeopen]").click();
      await cardFor(page, id).locator(`[data-cardsizepick="${id}:${i}"]`).click();
      await expect(cardFor(page, id).locator(".card__pop")).toHaveCount(0);
    };

    test("the price follows the chosen size, and the cart line gets that size", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/c/hair/"));
      await waitForScreen(page, "catalog");

      const card = cardFor(page, PRODUCT.id);
      const picker = card.locator("[data-cardsizeopen]");
      // The trigger's label — «Объём» / «Maht» / «Size» — and the listbox behind it.
      await expect(picker).toHaveAttribute("aria-label", tr("Объём", lang.code));
      await picker.click();
      await expect(card.locator("[data-cardsizepick]")).toHaveCount(PRODUCT.sizes.length);
      await page.keyboard.press("Escape");
      await expect(card.locator(".card__pop")).toHaveCount(0);

      // Untouched, the card shows the smallest size's exact price. It used to
      // read «от 9 €», which is the wrong thing to say next to a control that
      // already has a size selected in it.
      const price = card.locator("[data-cardpr]");
      await expect(price).toHaveText(eur(PRODUCT.prices[0], lang.code));

      for (let i = PRODUCT.sizes.length - 1; i >= 0; i--) {
        await pick(page, PRODUCT.id, i);
        await expect(price).toHaveText(eur(PRODUCT.prices[i], lang.code));
      }

      // The real point: the cart, not just the card.
      const last = PRODUCT.sizes.length - 1;
      await pick(page, PRODUCT.id, last);
      await card.locator(`[data-add="${PRODUCT.id}"]`).click();
      await expect(page.getByRole("status")).toBeVisible();
      await expect(page.locator("[data-cartbadge]")).toHaveText("1");

      await page.locator("[data-cart]").first().click();
      const dialog = page.getByRole("dialog", { name: /Корзина|Ostukorv|Cart/ });
      await expect(dialog).toBeVisible();
      const line = dialog.locator(".cline").first();
      // The volume: the number is the same in all three languages («500 мл» →
      // «500 ml»), the unit is not — so assert the digits.
      await expect(line.locator(".cline__nm")).toContainText(PRODUCT.sizes[last].replace(/\D+/g, ""));
      // …at the chosen size's price and qty 1, not the smallest size's 9 €.
      await expect(line.locator("[data-linepr]")).toHaveText(eur(PRODUCT.prices[last], lang.code));
      await expect(line.locator("[data-qtyval]")).toHaveText("1");
    });

    test("the choice survives leaving the list and coming back", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/c/hair/"));
      await waitForScreen(page, "catalog");

      await pick(page, PRODUCT.id, 1);
      await expect(cardFor(page, PRODUCT.id).locator("[data-cardpr]")).toHaveText(eur(PRODUCT.prices[1], lang.code));

      // A real navigation and back: the grid is rebuilt from nothing, so this
      // only passes because the choice lives in S.cardSize (app.js) rather
      // than in the markup that was just thrown away.
      await cardFor(page, PRODUCT.id).locator(`[data-go-product="${PRODUCT.id}"]`).click();
      await waitForScreen(page, "product");
      await page.goBack();
      await waitForScreen(page, "catalog");

      await expect(cardFor(page, PRODUCT.id).locator(".card__sizelbl")).toContainText(PRODUCT.sizes[1].replace(/\D+/g, ""));
      await expect(cardFor(page, PRODUCT.id).locator("[data-cardpr]")).toHaveText(eur(PRODUCT.prices[1], lang.code));
    });

    test("no picker on a single-size product; every card list has one", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/c/hair/"));
      await waitForScreen(page, "catalog");
      const single = cardFor(page, SINGLE_SIZE_PRODUCT);
      await expect(single).toBeVisible();
      await expect(single.locator("[data-cardsizeopen]")).toHaveCount(0);

      // cardHTML() is shared, so the picker reaches every list built from it —
      // the home rails and the search results, not only the catalogue grid.
      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");
      expect(await page.locator(".sec .grid [data-cardsizeopen]").count()).toBeGreaterThan(0);

      await page.locator("[data-search]").fill("System");
      await waitForScreen(page, "search");
      expect(await page.locator(".grid [data-cardsizeopen]").count()).toBeGreaterThan(0);
    });
  });
}

/* The one viewport-sensitive thing about this picker, and the reason the
 * desktop-only guard moved into the describes above: a native <select> is as
 * wide as its widest option («white / XXL»), and a card is a 150px grid track
 * on a 375px phone — an overflowing control there gives the whole page a
 * sideways scroll. Geometry, not text, so one language is enough
 * (docs/testing.md). Run it with `--project=mobile` as well as desktop. */
test.describe("card size picker — layout", () => {
  // /c/merch/ is the worst case on purpose: a t-shirt's variants are one flat
  // «colour / size» list («white / XXL»), by far the widest option text in the
  // catalogue. /c/hair/ is the ordinary case («500 мл»).
  for (const cat of ["hair", "merch"]) {
    test(`every picker fits inside its card in /c/${cat}/ and adds no sideways scroll`, async ({ page }) => {
      await page.goto(shopUrl("", `/c/${cat}/`));
      await waitForScreen(page, "catalog");
      await expect(page.locator("#catgrid .card").first()).toBeVisible();

      const report = await page.evaluate(() => {
        const escaped: string[] = [];
        const pickers = document.querySelectorAll<HTMLElement>("[data-cardfoot]");
        pickers.forEach((sel) => {
          const card = sel.closest(".card");
          if (!card) {
            escaped.push(`${sel.dataset.cardfoot}: no .card around the foot row`);
            return;
          }
          const s = sel.getBoundingClientRect();
          const c = card.getBoundingClientRect();
          // 1px of slack for sub-pixel layout rounding; the row must not wrap
          // either (its height would then be two lines).
          if (s.right > c.right + 1 || s.left < c.left - 1 || sel.scrollWidth > sel.clientWidth + 1 || s.height > 40) {
            escaped.push(
              `${sel.dataset.cardfoot}: foot ${Math.round(s.left)}…${Math.round(s.right)} h${Math.round(s.height)} sw${sel.scrollWidth}` +
                ` vs card ${Math.round(c.left)}…${Math.round(c.right)}`,
            );
          }
        });
        return {
          escaped,
          count: pickers.length,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        };
      });

      expect(report.count, "no size pickers rendered — the check would be vacuous").toBeGreaterThan(0);
      expect(report.escaped, "size picker(s) hanging out of their card").toEqual([]);
      expect(report.scrollWidth, "the catalogue must not scroll sideways").toBeLessThanOrEqual(report.clientWidth + 1);
    });
  }
});
