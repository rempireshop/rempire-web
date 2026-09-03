import { expect, test } from "@playwright/test";
import { ipHeaders, LANGS, shopUrl, tr, waitForScreen } from "./fixtures";

/** Info/legal pages and the blog listing route. Desktop only — see
 *  docs/testing.md. */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "functional spec — desktop project only, see docs/testing.md");
});
test.use({ extraHTTPHeaders: ipHeaders(80) });

/** public/shop/legal.*.js — the 5 slugs the router (and the prerender tool)
 *  actually recognise. */
const INFO_SLUGS = ["shipping", "returns", "terms", "privacy", "contact"];

for (const lang of LANGS) {
  test.describe(`info pages — ${lang.code}`, () => {
    for (const slug of INFO_SLUGS) {
      test(`/info/${slug}/ loads`, async ({ page }) => {
        const res = await page.goto(shopUrl(lang.seg, `/info/${slug}/`));
        expect(res?.status()).toBe(200);
        // The universal screen marker (document.body.dataset.screen, app.js)
        // is deliberately the only content check here: the prerendered SEO
        // shell (#prerender, tools/prerender-shop2.mjs) and app.js's own live
        // render both carry an <h1> once booted, worded differently enough
        // between the two ("Delivery and payment" vs. "Terms of delivery"
        // for /info/shipping/) that asserting on any one of them would be
        // asserting content this task doesn't ask for — "exists (200)" is
        // the ask, and screen-attached is the robust proof of that.
        await waitForScreen(page, "info");
      });
    }
  });
}

for (const lang of LANGS) {
  test(`blog listing route — ${lang.code}`, async ({ page }) => {
    // screenBlog() / S.screen === "blog", routed at /shop2[/<lang>]/blog/
    // (app.js router strips the language prefix before matching) and
    // prerendered per next.config.ts's prerenderedRewrites(). A fresh
    // database has no posts yet, so the empty state is what a passing run
    // actually proves — the route resolving and rendering, not that there is
    // content in it yet.
    const res = await page.goto(shopUrl(lang.seg, "/blog/"));
    expect(res?.status()).toBe(200);
    await waitForScreen(page, "blog");
    await expect(page.locator("h1")).toHaveText(tr("Блог", lang.code));
    await expect(page.getByText(tr("Статей пока нет — загляните позже.", lang.code))).toBeVisible();
  });
}
