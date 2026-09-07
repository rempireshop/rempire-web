import { expect, test } from "@playwright/test";
import { functionalProject, ipHeaders, LANGS, shopUrl, tr, waitForScreen } from "./fixtures";

/**
 * Home: hero, rails, sets rail, the gift-card block, the blog label, the
 * footer company line, language switch.
 * Desktop only — see docs/testing.md "Why most specs run on desktop only".
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(!functionalProject(testInfo), "functional spec — desktop and mobile-safari projects only, see docs/testing.md");
});
test.use({ extraHTTPHeaders: ipHeaders(10) });

for (const lang of LANGS) {
  test.describe(`home — ${lang.code}`, () => {
    test("hero, rails and the sets rail render", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");

      // Hero: at least one slide, marked active via data-on="1".
      const hero = page.locator(".hero");
      await expect(hero).toBeVisible();
      await expect(page.locator('.hero__slide[data-on="1"]').first()).toBeVisible();

      // Two product rails ("Популярные товары", "Новые товары"), cards inside.
      const railTitles = page.locator(".sec__title");
      await expect(railTitles.first()).toBeVisible();
      expect(await railTitles.count()).toBeGreaterThanOrEqual(2);
      await expect(page.locator(".card").first()).toBeVisible();

      // Sets rail — on by default (DEMO.bundles defaults true, app.js), a
      // dedicated section distinct from the plain product rails.
      const setsRail = page.locator(".sec--bundles");
      await expect(setsRail).toBeVisible();
      await expect(setsRail.locator('[data-go="bundles"]')).toBeVisible();
    });

    test("footer shows the company line", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");

      // Footer sections are closed <details> — open every one so content
      // becomes visible, without depending on any translated summary text.
      const summaries = page.locator(".ftr .ftr__acc summary");
      const n = await summaries.count();
      for (let i = 0; i < n; i++) await summaries.nth(i).click();

      // Company data (legalName/regCode/vatNumber/address) is plain Latin —
      // translateTree() skips it, so it is byte-identical in all 3 languages
      // (docs/testing.md — no dictionary lookup needed for this assertion).
      const footer = page.locator(".ftr");
      await expect(footer.getByText("Rempire Store OÜ").first()).toBeVisible();
      await expect(footer.getByText("12216136")).toBeVisible();
      await expect(footer.getByText("EE102723858")).toBeVisible();
      await expect(footer.getByText("Mardi 1, 10145 Tallinn").first()).toBeVisible();

      // Bottom signature line: "© 2026 " is a literal string, not a computed
      // year, so it is stable to assert on exactly.
      await expect(page.locator(".ftr__sig")).toContainText("© 2026 Rempire Store OÜ");
    });

    /* The gift card used to be reachable from «Наборы» and nowhere else —
     * the last place someone shopping for a present looks. It now has three
     * homes; two of them are on this screen. The home block deliberately does
     * NOT hang off the sets rail: it is its own <section class="sec--gift">,
     * so switching sets off (admin → Магазин) cannot take it with them.
     *
     * Dim, 07.09.2026: the third home moved from the footer to the top
     * navigation, beside «Наборы» — the footer group that repeated the
     * navigation is gone, so [data-nav-gift] is what this now checks. */
    test("the gift card is reachable from the home page and from the navigation", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");

      const tile = page.locator(".sec--gift .gifttile");
      await expect(tile).toBeVisible();
      await expect(tile.getByRole("heading")).toHaveText(tr("Подарочная карта", lang.code));
      // Its own section, not a child of the sets rail.
      await expect(page.locator(".sec--bundles .gifttile")).toHaveCount(0);

      // …and the navigation entry, which is not a copy of a footer link any
      // more — the footer must not have one at all.
      const summaries = page.locator(".ftr .ftr__acc summary");
      const n = await summaries.count();
      for (let i = 0; i < n; i++) await summaries.nth(i).click();
      await expect(page.locator('.ftr [data-go="gift"]')).toHaveCount(0);

      const navGift = page.locator("[data-nav-gift]");
      await expect(navGift).toHaveText(tr("Подарочная карта", lang.code));
      await navGift.click();
      await waitForScreen(page, "gift");
      await expect(page).toHaveURL(new RegExp(`/shop2${lang.seg}/gift/`));
      await expect(navGift).toHaveAttribute("aria-current", "true");

      // …and the home block's own button reaches the same screen.
      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");
      await page.locator('.sec--gift [data-go="gift"]').click();
      await waitForScreen(page, "gift");
    });

    /* «Ajaveeb» was the wrong word, and so was the bare «Blog»: the Estonian
     * label for the section is «Blogi» (Dim, 07.09.2026), which is how the
     * shop's own sentences already decline it — «Blogi pole ajutiselt
     * saadaval», «Tagasi Blogisse». It is the nav, the footer, the
     * breadcrumbs and the page title alike: one dictionary entry in app.js
     * drives all of them, tools/prerender-shop2.mjs lifts that same table for
     * the static pages, and src/lib/seo-head.mjs carries it for the
     * request-time blog page. */
    test("the blog is labelled with the right word for the language", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");

      const navBlog = page.locator("[data-nav-blog]");
      await expect(navBlog).toHaveText(tr("Блог", lang.code));
      // the footer's copy of this link went with the «Покупателю» group
      await expect(page.locator('.ftr [data-go="blog"]')).toHaveCount(0);

      await navBlog.click();
      await waitForScreen(page, "blog");
      await expect(page.locator("h1.display")).toHaveText(tr("Блог", lang.code));
      await expect(page.locator(".crumbs")).toContainText(tr("Блог", lang.code));

      // The old word must not survive anywhere on the screen.
      await expect(page.locator("body")).not.toContainText("Ajaveeb");
      await expect(page.locator("body")).not.toContainText("ajaveeb");
    });
  });
}

test.describe("language switch", () => {
  test("changes the URL prefix and visible text", async ({ page }) => {
    await page.goto(shopUrl("", "/"));
    await waitForScreen(page, "home");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");

    const allProductsLink = page.locator('[data-go-cat="all"]').first();
    await expect(allProductsLink).toHaveText("Все товары");

    await page.locator("[data-langtoggle]").click();
    await page.getByRole("option", { name: "Eesti" }).click();

    // history.replaceState, not a real navigation — expect() polls page.url().
    await expect(page).toHaveURL(/\/shop2\/et\/?$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "et");
    await expect(page.locator('[data-go-cat="all"]').first()).toHaveText("Kõik tooted");

    await page.locator("[data-langtoggle]").click();
    await page.getByRole("option", { name: "English" }).click();
    await expect(page).toHaveURL(/\/shop2\/en\/?$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator('[data-go-cat="all"]').first()).toHaveText("All products");

    // Back to Русский.
    await page.locator("[data-langtoggle]").click();
    await page.getByRole("option", { name: "Русский" }).click();
    await expect(page).toHaveURL(/\/shop2\/?$/);
    await expect(page.locator('[data-go-cat="all"]').first()).toHaveText("Все товары");
  });

  test("a language-prefixed URL loads directly in that language", async ({ page }) => {
    await page.goto(shopUrl("/et", "/"));
    await waitForScreen(page, "home");
    await expect(page.locator("html")).toHaveAttribute("lang", "et");
    await expect(page.locator('[data-go-cat="all"]').first()).toHaveText("Kõik tooted");
  });
});

/* The navigation gained an entry (the gift card, beside «Наборы»), and the
   strip is the one row in the shop chrome that is allowed to scroll sideways
   — but only itself. At 360 px, the narrowest phone the shop is held to, the
   PAGE must still not scroll sideways, every entry must stay reachable by
   scrolling the strip, and the new one must be a real 44-px target.
   Checked in all three languages: «Подарочная карта» is the longest of the
   three labels and the Estonian «Kinkekaart» the shortest. */
test.describe("the navigation on a 360-px phone", () => {
  test.use({ extraHTTPHeaders: ipHeaders(11) });

  for (const lang of LANGS) {
    test(`the strip scrolls, the page does not — ${lang.code}`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 780 });
      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");

      const pageOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(pageOverflow, "the home page scrolls sideways at 360 px").toBeLessThanOrEqual(1);

      const nav = page.locator(".hdr__nav");
      const overflow = await nav.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow, "the nav strip does not scroll — it should, it is longer than the phone")
        .toBeGreaterThan(0);

      const gift = page.locator("[data-nav-gift]");
      await expect(gift).toHaveText(tr("Подарочная карта", lang.code));
      const box = await gift.boundingBox();
      expect(box, "the gift-card entry has no box").not.toBeNull();
      expect(box!.height, "the gift-card entry is under the 44-px touch target").toBeGreaterThanOrEqual(44);

      // reachable by scrolling the strip, and it goes where it says
      await gift.scrollIntoViewIfNeeded();
      await gift.click();
      await waitForScreen(page, "gift");
      await expect(page).toHaveURL(new RegExp(`/shop2${lang.seg}/gift/`));
    });
  }
});
