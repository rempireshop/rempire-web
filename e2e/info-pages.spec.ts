import { expect, test } from "@playwright/test";
import { E2E_ADMIN_PASSWORD } from "./env.mjs";
import { eur, ipHeaders, LANGS, type LangCode, shopUrl, tr, waitForScreen } from "./fixtures";

/** Info/legal pages and the blog listing route. Desktop only — see
 *  docs/testing.md — except the «Доставка и оплата» describe at the bottom,
 *  which has one phone-layout test of its own. */

/** public/shop/legal.*.js — the 5 slugs the router (and the prerender tool)
 *  actually recognise. */
const INFO_SLUGS = ["shipping", "returns", "terms", "privacy", "contact"];

test.describe("policy pages and the blog route", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "functional spec — desktop project only, see docs/testing.md");
  });
  test.use({ extraHTTPHeaders: ipHeaders(80) });

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

      /* /info/returns/ carries one paragraph that is not the harvested policy:
         the shop's own «tick it in your account, we write back»
         (returnsAskHTML in app.js, the other half of the tick in «Мои
         заказы»). It has to be there in all three languages, and — because a
         crawler and a cold visit read the static shell — in the prerendered
         page too, which tools/prerender-shop2.mjs builds by lifting that very
         function. Nothing here may promise a return label: Montonio cannot
         produce one (docs/audit/2026-09-07-shipping-returns.md). */
      test("/info/returns/ says how to ask, in this language, live and prerendered", async ({ page, request }) => {
        await page.goto(shopUrl(lang.seg, "/info/returns/"));
        await waitForScreen(page, "info");
        const ask = page.locator("[data-returnsask]");
        await expect(ask).toBeVisible();
        await expect(ask).toContainText(tr("Как попросить возврат", lang.code));
        await expect(ask).toContainText(
          tr("Если заказ уже доставлен, откройте «Кабинет → Мои заказы» и отметьте «Хочу вернуть заказ» — на это есть 30 дней с момента получения.", lang.code));
        await expect(ask).toContainText(
          tr("Мы увидим отметку и напишем вам на почту: расскажем, как отправить посылку обратно, и вернём деньги после проверки.", lang.code));

        const html = await (await request.get(shopUrl(lang.seg, "/info/returns/"))).text();
        expect(html, "the prerendered page is missing the paragraph").toContain("data-returnsask");
        expect(html).toContain(tr("Как попросить возврат", lang.code));
      });
    });
  }

  for (const lang of LANGS) {
    test(`blog listing route — ${lang.code}`, async ({ page }) => {
      // screenBlog() / S.screen === "blog", routed at /shop2[/<lang>]/blog/
      // (app.js router strips the language prefix before matching) and
      // prerendered per next.config.ts's prerenderedRewrites(). Migration
      // 071_blog_samples.sql seeds three published posts, so a fresh database
      // lists them in every language — the route resolving, the list rendering
      // and the seed all at once. The empty-state copy must not be on screen.
      const res = await page.goto(shopUrl(lang.seg, "/blog/"));
      expect(res?.status()).toBe(200);
      await waitForScreen(page, "blog");
      await expect(page.locator("h1")).toHaveText(tr("Блог", lang.code));
      await expect(page.locator(".blog__grid li").first()).toBeVisible();
      expect(await page.locator(".blog__grid li").count()).toBeGreaterThanOrEqual(3);
      await expect(page.getByText(tr("Статей пока нет — загляните позже.", lang.code))).toHaveCount(0);
    });
  }
});

/**
 * «Доставка и оплата» — /info/shipping/ is no longer the numbered policy
 * text but the page a customer reads (deliveryPageHTML in app.js, the same
 * builder tools/prerender-shop2.mjs lifts for the static page): the price
 * table from settings.shipping_rules, the transit times, the checkout's own
 * payment marks, a three-sentence returns summary with the link to the full
 * policy, the contacts — and the old legal text folded underneath as «Полные
 * условия доставки». Desktop checks the content in three languages; the
 * mobile project checks the one thing a phone can get wrong: the wide table
 * has to scroll inside its own strip, never the page.
 *
 * The heading comes from the legal files (public/shop/legal.*.js), not the
 * UI dictionary — hence the literal titles below.
 */
const DELIVERY_TITLES: Record<LangCode, string> = {
  RU: "Доставка и оплата",
  ET: "Tarne ja maksmine",
  EN: "Delivery and payment",
};

test.describe("«Доставка и оплата» — the customer page", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop" && testInfo.project.name !== "mobile",
      "content on desktop, the phone layout on mobile — see docs/testing.md",
    );
  });
  test.use({ extraHTTPHeaders: ipHeaders(81) });

  for (const lang of LANGS) {
    test(`prices from the shipping rules, payment marks and the folded policy — ${lang.code}`, async ({ page, request }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "content is checked once, on desktop");
      // what the checkout bills with — the page must print these very numbers
      const rules = (await (await request.get("/api/overrides/")).json()).settings.shipping_rules;
      const eeParcel = Number(rules.methods.parcel.EE);
      const eeCourier = Number(rules.methods.courier.EE);
      const freeFrom = Number(rules.freeFrom);
      expect(eeParcel).toBeGreaterThan(0);

      await page.goto(shopUrl(lang.seg, "/info/shipping/"));
      await waitForScreen(page, "info");
      await expect(page.locator("h1")).toHaveText(DELIVERY_TITLES[lang.code]);
      expect(await page.locator("h1").count(), "one h1 — the policy's own was demoted").toBe(1);

      // the table: Estonia first, its carriers, and the three prices
      const table = page.locator(".dlv__table");
      await expect(table).toBeVisible();
      await expect(table.locator("thead")).toContainText(tr("Бесплатно от", lang.code));
      const ee = table.locator("tbody tr").first();
      await expect(ee).toContainText(tr("Эстония", lang.code));
      await expect(ee).toContainText("Omniva");
      await expect(ee).toContainText("SmartPosti");
      await expect(ee).toContainText(eur(eeParcel, lang.code));
      await expect(ee).toContainText(eur(eeCourier, lang.code));
      await expect(ee).toContainText(eur(freeFrom, lang.code));
      // pickup at the salon carries the address from settings.content
      await expect(page.locator(".dlv__pickup")).toContainText("Mardi 1");

      // payment: the marks the checkout draws, plus gift card and points
      for (const label of ["Visa", "Mastercard", "Apple Pay", "Google Pay"]) {
        await expect(page.locator(`.dlv__pay svg[aria-label="${label}"]`), `${label} mark`).toBeVisible();
      }
      await expect(page.locator(".dlv__pay li")).toHaveCount(6);

      // returns in three sentences, then the link to the full policy; contacts with the link to the contact page
      await expect(page.locator('.dlv [data-page="returns"]')).toBeVisible();
      await expect(page.locator('.dlv [data-page="contact"]')).toBeVisible();
      await expect(page.locator(".dlv__contact")).toContainText("@");

      // the legal text is folded, not gone — and it is the real policy
      const legal = page.locator("details.dlv__legal");
      await expect(legal).toBeVisible();
      expect(await legal.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
      await legal.locator("summary").click();
      await expect(legal.locator(".legal")).toBeVisible();
      expect((await legal.locator(".legal").innerText()).length).toBeGreaterThan(600);

      // no Russian leaks on the translated pages: every visible string of the
      // page went through the dictionary (tools/i18n-gaps.mjs says 0 gaps)
      if (lang.code !== "RU") {
        const text = await page.locator(".dlv").innerText();
        const cyrillic = text.split("\n").filter((l) => /[А-Яа-яЁё]/.test(l));
        expect(cyrillic, "Russian left on the translated page").toEqual([]);
      }

      // the static page a crawler reads is built by the same function: same
      // table, same price — SPA and prerender agree
      const html = await (await request.get(shopUrl(lang.seg, "/info/shipping/"))).text();
      expect(html).toContain('class="dlv__table"');
      expect(html).toContain(eur(eeParcel, lang.code));
      expect(html).toContain('class="dlv__legal"');
    });
  }

  test("a price the owner changes in the rules is the price the page shows", async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one write is enough — desktop runs it");
    // the admin, through the API: page.request shares the context's cookie jar
    const login = await page.request.post("/api/admin/login/", { data: { password: E2E_ADMIN_PASSWORD } });
    expect(login.ok()).toBe(true);
    const before = (await (await page.request.get("/api/admin/settings/")).json()).settings.shipping_rules ?? null;
    try {
      const patched = JSON.parse(JSON.stringify(before ?? {}));
      patched.methods = patched.methods ?? {};
      patched.methods.parcel = { ...(patched.methods.parcel ?? {}), LV: 6.66 };
      const put = await page.request.put("/api/admin/settings/", { data: { shipping_rules: patched } });
      expect(put.ok()).toBe(true);

      /* Its own browser context: /api/overrides/ answers with s-maxage and a
         page in the admin's context could keep the old rules from its HTTP
         cache — the same reasoning as admin-sections.spec.ts. */
      const ctx = await browser.newContext({ extraHTTPHeaders: ipHeaders(82) });
      const shopper = await ctx.newPage();
      await shopper.goto(shopUrl("", "/info/shipping/"));
      await waitForScreen(shopper, "info");
      const lv = shopper.locator(".dlv__table tbody tr", { hasText: "Латвия" });
      await expect(lv, "the Latvian parcel price is not the one just saved").toContainText("6,66 €");
      await ctx.close();
    } finally {
      await page.request.put("/api/admin/settings/", { data: { shipping_rules: before ?? {} } });
    }
  });

  test("on a phone the table scrolls inside its strip and the page never scrolls sideways", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the phone layout — mobile project only");
    await page.goto(shopUrl("", "/info/shipping/"));
    await waitForScreen(page, "info");
    await expect(page.locator(".dlv__table")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "the page spills sideways on a phone").toBeLessThanOrEqual(1);

    // the table is wider than the phone — and it is the strip that scrolls
    const [scrollW, clientW] = await page.locator(".dlv__scroll").evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(scrollW).toBeGreaterThan(clientW);

    // every section is there, in reading order (textContent, not innerText:
    // the titles are set in capitals by CSS, and the folded policy's own
    // headings are hidden inside the closed <details>)
    const heads = await page.locator(".dlv > h2.dlv__h2").allTextContents();
    expect(heads.map((h) => h.trim())).toEqual(["Способы и цены", "Сроки", "Оплата", "Возврат товара", "Вопросы"]);
    // the summary is a real touch target
    const box = await page.locator("details.dlv__legal summary").boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
