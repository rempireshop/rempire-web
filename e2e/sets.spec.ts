import { expect, test } from "@playwright/test";
import {
  BUNDLE,
  CATEGORY,
  eur,
  freshEmail,
  ipHeaders,
  LANGS,
  loginAsAdmin,
  payOrder,
  PRODUCT,
  shopUrl,
  tr,
  waitForScreen,
} from "./fixtures";

/** Sets: landing, single set page, add to cart, checkout line shows the
 *  components. Desktop only — see docs/testing.md. */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "functional spec — desktop project only, see docs/testing.md");
});

for (const [i, lang] of LANGS.entries()) {
  test.describe(`sets — ${lang.code}`, () => {
    test.use({ extraHTTPHeaders: ipHeaders(70 + i) });

    test("sets page, set page, add to cart, checkout line breaks out components", async ({ page }) => {
      // A plain product first, so the reload below has to restore a *mixed*
      // cart — not just the bundle line on its own.
      await page.goto(shopUrl(lang.seg, `/p/${PRODUCT.id}/`));
      await waitForScreen(page, "product");
      await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
      await expect(page.getByRole("status")).toBeVisible();

      await page.goto(shopUrl(lang.seg, "/sets/"));
      await waitForScreen(page, "bundles");
      // The gift card gained places of its own (footer, home page, cabinet —
      // e2e/home.spec.ts, e2e/account.spec.ts) but was NOT taken off this
      // page: someone already browsing sets is shopping for a present too.
      await expect(page.locator(".gifttile")).toBeVisible();
      const card = page.locator(`[data-go-bundle="${BUNDLE.id}"]`);
      await expect(card).toBeVisible();
      await card.click();

      await waitForScreen(page, "bundle");
      await expect(page).toHaveURL(new RegExp(`/shop2${lang.seg}/set/${BUNDLE.id}/?$`));
      for (const name of BUNDLE.componentNames) {
        await expect(page.locator(".bitems")).toContainText(name);
      }

      // Two add-to-set buttons render on this page (a sticky-bar duplicate,
      // same pattern as the product page's .pdp__add) — .btn--wide is the
      // primary one.
      await page.locator(`button.btn--wide[data-addbundle="${BUNDLE.id}"]`).click();
      // addBundleToCart() (app.js) toasts on BOTH the success path and the
      // "an item ran out" failure path — check the cart badge, not just that
      // a toast of some kind appeared, for a real signal either way. "2":
      // the product line (qty 1) plus the bundle line (always qty 1 on add).
      await expect(page.locator("[data-cartbadge]")).toHaveText("2");

      // A full reload — not client-side navigation — deliberately: this is
      // the regression check for a fixed app.js bug where restoring the cart
      // from localStorage threw on any bundle line (DEMO, which
      // allBundles()/bundleById() read, wasn't assigned until far later in
      // the file than the restore code that called them) and silently
      // emptied the *whole* saved cart, not just the bundle line — so the
      // plain product line disappeared too. Fixed by guarding allBundles()
      // against DEMO not being initialised yet, plus a try/catch around the
      // restore filter so a throw there can never again wipe a saved cart.
      await page.reload();
      await waitForScreen(page, "bundle");
      await expect(page.locator("[data-cartbadge]")).toHaveText("2");

      await page.locator("[data-cart]").first().click();
      await page.locator("[data-checkout]").click();
      await waitForScreen(page, "checkout");
      // The product line survived the reload too, not just the bundle one.
      await expect(page.locator(".cosum")).toContainText(PRODUCT.brand);
      // lineNoteHTML() (app.js) renders the same .cline__parts breakout both
      // in the cart drawer and in the checkout summary — this is the summary
      // instance, inside .cosum.
      const parts = page.locator(".cosum .cline__parts").first();
      await expect(parts).toBeVisible();
      for (const name of BUNDLE.componentNames) {
        await expect(parts).toContainText(name);
      }
    });
  });
}

/* ------------------------------------------------------------------------
   «Наборы на сайте» switched off (Настройки → Магазин, settings.bundles).

   The promise this covers: with the switch off, NOTHING about sets is left
   anywhere in the shop — not the nav entry, not the footer link, not the
   home rail, not the catalogue rail, not «с этим покупают», not the search,
   and not the gift card's breadcrumb (the gift card itself is not a set and
   stays reachable). The two set URLs keep answering — with «Наборы сейчас
   недоступны», never a 404 and never a silent bounce home — because old
   links and bookmarks outlive a switch.

   And the one thing that must NOT disappear: a set already sitting in
   somebody's cart. Hiding the shelf is a shop-window decision; taking a
   basket away from a customer standing at the till is not.

   This test flips a shop-wide switch other spec files depend on, so it puts
   it back in a `finally` — same rule as e2e/admin.spec.ts.
------------------------------------------------------------------------ */
test.describe("sets switched off", () => {
  test.use({ extraHTTPHeaders: ipHeaders(76) });

  test("hides every trace of sets in all three languages and keeps a cart line alive", async ({ page, browser }) => {
    await loginAsAdmin(page);
    await page.locator('[data-admtab="setup"]').click();
    await expect(page.getByText("Главный баннер")).toBeVisible();

    const toggle = page.locator("[data-admbundles]");
    try {
      const put = page.waitForResponse(
        (r) => r.url().includes("/api/admin/settings/") && r.request().method() === "PUT",
      );
      await toggle.click();
      expect((await put).ok()).toBe(true);
      await expect(page.getByRole("status")).toBeVisible();

      for (const lang of LANGS) {
        const ctx = await browser.newContext({ extraHTTPHeaders: ipHeaders(76) });
        const shop = await ctx.newPage();

        // home: no rail, no nav entry, no footer link, no set card anywhere
        await shop.goto(shopUrl(lang.seg, "/"));
        await waitForScreen(shop, "home");
        await expect(shop.locator(".sec--bundles")).toHaveCount(0);
        await expect(shop.locator("[data-nav-bundles]")).toHaveCount(0);
        await expect(shop.locator('[data-go="bundles"]')).toHaveCount(0);
        await expect(shop.locator("[data-go-bundle]")).toHaveCount(0);
        await expect(shop.locator("[data-addbundle]")).toHaveCount(0);
        // …and the word itself is gone from the chrome, in this language
        await expect(shop.locator(".hdr__nav")).not.toContainText(tr("Наборы", lang.code));

        // the catalogue rail
        await shop.goto(shopUrl(lang.seg, `/c/${CATEGORY.id}/`));
        await waitForScreen(shop, "catalog");
        await expect(shop.locator(".sec--bundles")).toHaveCount(0);
        await expect(shop.locator("[data-go-bundle]")).toHaveCount(0);

        // «с этим покупают» on a product page — products only, never a set
        await shop.goto(shopUrl(lang.seg, `/p/${PRODUCT.id}/`));
        await waitForScreen(shop, "product");
        await expect(shop.locator("[data-go-bundle]")).toHaveCount(0);
        await expect(shop.locator("[data-addbundle]")).toHaveCount(0);

        // search: a set's own name finds nothing that is a set
        await shop.goto(shopUrl(lang.seg, "/search/?q=" + encodeURIComponent("набор")));
        await waitForScreen(shop, "search");
        await expect(shop.locator("[data-go-bundle]")).toHaveCount(0);

        // the two set addresses still answer — and say why
        for (const path of ["/sets/", `/set/${BUNDLE.id}/`]) {
          await shop.goto(shopUrl(lang.seg, path));
          await expect(shop.locator("h1")).toContainText(tr("Наборы сейчас недоступны", lang.code));
          await expect(shop.locator("[data-addbundle]")).toHaveCount(0);
          // never a 404 and never a bounce home: the address stays itself
          expect(new URL(shop.url()).pathname).toContain(path.replace(/\/$/, ""));
        }

        // the gift card is NOT a set: still reachable, still in the footer
        await shop.goto(shopUrl(lang.seg, "/gift/"));
        await waitForScreen(shop, "gift");
        await expect(shop.locator("[data-addgift]")).toBeVisible();
        await expect(shop.locator(".crumbs")).not.toContainText(tr("Наборы", lang.code));

        await ctx.close();
      }

      /* A cart saved while sets were still on. app.js persists it under
         "rempire-shop-proto" (LS in app.js), so seeding it here is exactly
         what a returning shopper's browser hands the shop. */
      const ctx = await browser.newContext({ extraHTTPHeaders: ipHeaders(76) });
      await ctx.addInitScript(
        ([key, id, price]) => {
          window.localStorage.setItem(
            key as string,
            JSON.stringify({ cart: [{ type: "bundle", id, qty: 1, price }], lang: "RU" }),
          );
        },
        ["rempire-shop-proto", `bundle:${BUNDLE.id}`, BUNDLE.price] as const,
      );
      const shopper = await ctx.newPage();
      await shopper.goto(shopUrl("", "/"));
      await waitForScreen(shopper, "home");
      // the line is still there, still priced — not silently dropped to 0 €
      await expect(shopper.locator("[data-cartbadge]")).toHaveText("1");
      await shopper.goto(shopUrl("", "/checkout/"));
      await waitForScreen(shopper, "checkout");
      await expect(shopper.locator(".cosum")).toContainText(BUNDLE.titleRu);
      await expect(shopper.locator(".cosum")).toContainText(eur(BUNDLE.price, "RU"));
      // …and it can still be paid for: the shop must not take an order away
      // from somebody who is standing at the till
      const number = await payOrder(shopper, freshEmail("sets-off"), "paid");
      expect(number).toMatch(/^R-\d+$/);
      await ctx.close();
    } finally {
      await page.locator('[data-admtab="setup"]').click();
      const back = page.locator("[data-admbundles]");
      if ((await back.textContent())?.includes("Показать")) {
        /* Waiting for the write, not just the click: the panel applies the
           switch locally and PUTs it in the background, and a test that ends
           on the click has its context torn down with the request still in
           flight — the switch stays off on the server and the NEXT spec file
           finds a shop with no sets in it. */
        const put = page.waitForResponse(
          (r) => r.url().includes("/api/admin/settings/") && r.request().method() === "PUT",
        );
        await back.click();
        expect((await put).ok()).toBe(true);
      }
    }
  });
});
