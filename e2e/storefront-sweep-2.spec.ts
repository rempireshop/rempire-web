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
 *    printed «9 €» on the English shop that says «€9»;
 *  - the receipt sent one «purchase» beacon per render() instead of one per
 *    order — the two boot answers alone made it three;
 *  - «Доставка по умолчанию» in the account priced the shopper's standing
 *    choice off the frozen demo tariff, promising a courier at 9 € where the
 *    checkout charged 10,84 €;
 *  - «Бренды» is the one shopper page with no prerendered head, so its ET and
 *    EN versions carried the Russian description of the home page.
 *
 * Desktop + mobile-safari like the other functional specs; the lost-tap
 * test also runs on the Chromium phone project, because it is about a
 * finger on a 360-px screen.
 */
import { expect, test } from "@playwright/test";
import {
  BUNDLE,
  continueButton,
  eur,
  freshEmail,
  functionalProject,
  ipHeaders,
  LANGS,
  payOrder,
  PRODUCT,
  shopUrl,
  tr,
  waitForScreen,
} from "./fixtures";

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

test.describe("receipt — the purchase beacon", () => {
  test.use({ extraHTTPHeaders: ipHeaders(199) });

  /* track() sends through navigator.sendBeacon, and WebKit hands Playwright
     an intercepted beacon with no body at all — postData() and
     postDataBuffer() are both null, so there is nothing to read the event
     type out of (verified, not assumed). What is under test is app.js's own
     bookkeeping, which no engine changes; the Chromium projects carry it. */
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile-safari" || testInfo.project.name === "webkit-local",
      "WebKit does not expose a sendBeacon body to route interception",
    );
  });

  test("one «purchase» per paid order, however many times the receipt repaints", async ({ page }) => {
    const beacons: Array<{ type: string; value?: number }> = [];
    await page.route("**/api/track/", async (route) => {
      try {
        beacons.push(JSON.parse(route.request().postData() || "{}"));
      } catch {
        beacons.push({ type: "unparsed" });
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });

    /* The bank's own redirect back. Two boot answers land a full render()
       each within a moment of it, and doneState() used to recompute — and
       re-send — on every one of them. Both waiters are armed before the
       navigation: either answer can beat the first paint. */
    const boot = Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/bundles/")),
      page.waitForResponse((r) => r.url().includes("/api/overrides/")),
    ]);
    await page.goto("/shop2/done/?n=R-100042&s=paid&t=41.90");
    await waitForScreen(page, "done");
    await expect(page.locator(".done__num")).toHaveText("Заказ R-100042");
    await boot;
    /* Both answers end in a render() that is coalesced into the next frame,
       so wait for two of them before counting — the receipt is chromeless
       (renderImpl's `chromeless`), so those two are the whole exposure: there
       is no header on this screen for the shopper to repaint it from. */
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
    );
    await expect(page.locator(".done__num")).toHaveText("Заказ R-100042");

    const purchases = beacons.filter((b) => b.type === "purchase");
    expect(purchases, `«purchase» sent ${purchases.length}×: ${JSON.stringify(beacons)}`).toHaveLength(1);
    expect(purchases[0].value).toBe(41.9);
  });

  test("a failed payment is not a purchase", async ({ page }) => {
    const types: string[] = [];
    await page.route("**/api/track/", async (route) => {
      try {
        types.push(JSON.parse(route.request().postData() || "{}").type);
      } catch {
        types.push("unparsed");
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });
    const boot = page.waitForResponse((r) => r.url().includes("/api/bundles/"));
    await page.goto("/shop2/done/?n=R-100043&s=failed");
    await waitForScreen(page, "done");
    await expect(page.locator(".done__tick--bad")).toBeVisible();
    await boot;
    expect(types).not.toContain("purchase");
  });
});

test.describe("account — «Доставка по умолчанию»", () => {
  test.use({ extraHTTPHeaders: ipHeaders(200) });

  /** The euro figure beside an option row, whichever screen drew it. */
  async function priceOf(page: import("@playwright/test").Page, label: string): Promise<string> {
    const row = page.locator(".optlist .opt").filter({ hasText: label }).first();
    await expect(row, `no «${label}» row`).toBeVisible();
    return (await row.locator(".opt__price").innerText()).trim();
  }

  test("the standing choice is priced by the rules the checkout bills on", async ({ page }) => {
    const email = `acct-ship-${Date.now()}@example.com`;
    await page.goto(shopUrl("", "/account/"));
    await waitForScreen(page, "account");
    await page.locator("[data-email]").fill(email);
    const codeResponse = page.waitForResponse((r) => r.url().includes("/api/account/code/"));
    await page.locator("[data-login]").click();
    const res = await codeResponse;
    const body = (await res.json()) as { code?: string; error?: string };
    expect(body.code, `POST /api/account/code/ → ${res.status()} ${JSON.stringify(body)}`).toMatch(/^\d{6}$/);
    await page.locator("[data-acctcode]").fill(body.code!);
    await page.locator("[data-logincode]").click();
    await expect(page.locator("[data-logout]")).toBeVisible();

    // the account's own list: the labels are the old ones, the prices must not be
    const acctParcel = await priceOf(page, "Пакомат Omniva");
    const acctCourier = await priceOf(page, "Курьер до двери");
    const acctPickup = await priceOf(page, "Самовывоз");

    // …against the same three at the till, on a basket below the free-shipping floor
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    await page.locator("[data-email]").fill(email);
    await page.locator('button.btn--wide[data-step="2"]').click();
    await expect(page.locator('input[data-dm="parcel"]')).toBeVisible();

    expect(acctParcel, "the account quotes another parcel price than the checkout").toBe(
      await priceOf(page, "Пакомат"),
    );
    expect(acctCourier, "the account quotes another courier price than the checkout").toBe(
      await priceOf(page, "Курьер до двери"),
    );
    expect(acctPickup).toBe(await priceOf(page, "Самовывоз"));
    expect(acctCourier).not.toBe(acctParcel);   // both really read, neither a stray «Бесплатно»
  });
});

for (const lang of LANGS) {
  if (lang.code === "RU") continue;

  test.describe(`«Бренды» — the head of the one page with no prerender (${lang.code})`, () => {
    test.use({ extraHTTPHeaders: ipHeaders(201 + LANGS.indexOf(lang)) });

    test("title and description are the page's own language, not the Russian shell's", async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/brands/"));
      await waitForScreen(page, "brands");
      const head = await page.evaluate(() => ({
        title: document.title,
        desc: document.querySelector('meta[name="description"]')?.getAttribute("content") || "",
        intro: (document.querySelector(".sec__intro")?.textContent || "").trim(),
        htmlLang: document.documentElement.lang,
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") || "",
      }));
      expect(head.htmlLang).toBe(lang.htmlLang);
      expect(head.canonical, "the canonical still points at the shell it was served from").toContain(
        `/shop2${lang.seg}/brands/`,
      );
      expect(head.title, `Cyrillic left in the ${lang.code} tab title: ${head.title}`).not.toMatch(/[Ѐ-ӿ]/);
      expect(head.desc, `Cyrillic left in the ${lang.code} description: ${head.desc}`).not.toMatch(/[Ѐ-ӿ]/);
      // the description IS the sentence the page opens with — one string, one translation
      expect(head.desc.slice(0, 60)).toBe(head.intro.slice(0, 60));
    });
  });
}

test.describe("checkout — a keyboard shopper", () => {
  test.use({ extraHTTPHeaders: ipHeaders(204) });

  test("moving between the steps never drops focus on <body>", async ({ page }) => {
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");

    /** Where focus landed: on <body> is the failure this pins. */
    const focus = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return {
          tag: el ? el.tagName : "none",
          inOpenStep: !!(el && el.closest(".costep.is-open")),
        };
      });

    /* Reaching the e-mail box from the top of the page: a keyboard shopper
       starts at the address bar, not inside the form. */
    let tabs = 0;
    for (; tabs < 40; tabs++) {
      if (await page.evaluate(() => document.activeElement?.hasAttribute("data-email") === true)) break;
      await page.keyboard.press("Tab");
    }
    expect(tabs, "the e-mail box is not reachable with Tab").toBeLessThan(40);
    await page.keyboard.type(`kbd-${Date.now()}@example.com`);

    // …and every step move keeps focus inside the step that just opened
    await page.locator('button.btn--wide[data-step="2"]').click();
    await expect(page.locator('input[data-dm="parcel"]')).toBeVisible();
    expect(await focus(), "«Далее — доставка» dropped focus").toMatchObject({ inOpenStep: true });

    await page.locator('input[data-dm="pickup"]').check();
    await page.locator('[data-shipf="name"]').fill("Kbd Shopper");
    await page.locator('[data-shipf="phone"]').fill("+372 5550001");
    await page.locator('button.btn--wide[data-step="3"]').click();
    await expect(page.locator('input[data-paym="1"]')).toBeVisible();
    expect(await focus(), "«Далее — оплата» dropped focus").toMatchObject({ inOpenStep: true });

    // going back to change something is a step move too
    await page.locator('.costep__head[data-step="1"]').click();
    await expect(page.locator("[data-email]")).toBeVisible();
    expect(await focus(), "reopening step 1 dropped focus").toMatchObject({ inOpenStep: true });

    // and a refusal still puts the shopper on the field it is about
    await page.locator("[data-email]").fill("nope");
    await page.locator('button.btn--wide[data-step="2"]').click();
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-invalid"))).toBe("true");
  });
});

/* =========================================================================
   07.09.2026 — the eleven things Dim decided after the 06.09 sweep
   (docs/audit/2026-09-07-storefront.md). One describe per decision, in the
   order he answered them.
   ========================================================================= */

test.describe("404 — an address the shop has no page for", () => {
  test.use({ extraHTTPHeaders: ipHeaders(205) });

  for (const lang of LANGS) {
    test(`«${lang.code}» — 404 from the server, the 404 screen from the script, the address kept`, async ({ page }) => {
      const path = shopUrl(lang.seg, "/no-such-page-07092026/");
      const res = await page.goto(path);
      /* The status is the half a crawler reads. It used to be 200 with the
         home page under it — a soft 404, which is what Google de-indexes. */
      expect(res?.status(), "an unknown shop path must answer 404").toBe(404);

      await waitForScreen(page, "notfound");
      // …and the script agrees, on the address the shopper actually asked for
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(page.locator("h1")).toHaveText(tr("Страница не найдена", lang.code));
      expect(await page.title()).toBe(`${tr("Страница не найдена", lang.code)} — REMPIRE`);
      expect(
        await page.evaluate(() => document.querySelector('meta[name="robots"]')?.getAttribute("content")),
        "a page that does not exist must not be indexable",
      ).toBe("noindex, nofollow");
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(lang.htmlLang);

      // the two ways out are real
      await page.locator('.nf__acts [data-go-cat="all"]').click();
      await waitForScreen(page, "catalog");
    });
  }

  test("the screens that live only in the browser still answer 200", async ({ page }) => {
    for (const path of ["/brands/", "/search/", "/account/", "/sets/", "/gift/"]) {
      const res = await page.request.get(shopUrl("", path));
      expect(res.status(), `${path} must not have become a 404`).toBe(200);
    }
    // …and a category or a brand that does not exist is a 404 like anything else
    for (const path of ["/c/not-a-category/", "/b/not-a-brand/", "/info/not-a-page/"]) {
      const res = await page.request.get(shopUrl("", path));
      expect(res.status(), `${path} should not resolve`).toBe(404);
    }
  });
});

test.describe("checkout — an empty basket", () => {
  test.use({ extraHTTPHeaders: ipHeaders(206) });

  for (const lang of LANGS) {
    test(`«${lang.code}» — the address follows the screen home`, async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/checkout/"));
      await waitForScreen(page, "home");
      /* It drew the home page and left /checkout/ in the address bar, so a
         reload, the tab title and the canonical all described a page the
         shopper was not on. */
      expect(new URL(page.url()).pathname).toBe(shopUrl(lang.seg, "/"));
      expect(await page.evaluate(() =>
        document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
      )).toMatch(new RegExp(`${shopUrl(lang.seg, "/")}$`));
    });
  }
});

test.describe("the gift tile names what is on sale", () => {
  test.use({ extraHTTPHeaders: ipHeaders(207) });

  for (const lang of LANGS) {
    test(`«${lang.code}» — the tile and the /gift/ buttons are one list`, async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/gift/"));
      await waitForScreen(page, "gift");
      const offered = (await page.locator(".gamts .gamt").allInnerTexts()).map((t) => t.trim());
      expect(offered.length, "the gift page offers no amount at all").toBeGreaterThan(0);

      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");
      const tile = (await page.locator(".gifttile .num").first().innerText()).trim();
      /* The tile used to say «25, 50 или 100 €» in fixed text whatever the
         owner had switched on. It is the setting's own list now — the same
         amounts the buttons carry, in the same order, formatted for this
         language (eur()). */
      const wanted = offered.map((a) => eur(Number(a.replace(/[^\d]/g, "")), lang.code)).join(", ");
      expect(tile).toBe(wanted);
    });
  }
});

test.describe("account — the default delivery reaches the checkout", () => {
  test.use({ extraHTTPHeaders: ipHeaders(208) });

  test("a parcel machine chosen in the account is the one the checkout starts on", async ({ page }) => {
    const email = freshEmail("acct-pref");
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

    /* «Пакомат DPD» is deliberately not the checkout's own first choice, so
       finding it selected there can only mean the preference travelled.
       The block promised «Подставим это при следующем заказе» and did
       nothing at all until 07.09.2026. */
    const dpd = page.locator(".optlist .opt").filter({ hasText: "Пакомат DPD" }).first();
    await expect(dpd).toBeVisible();
    await dpd.locator("input[data-acctm]").check();
    await expect(page.locator("[data-acctmachine]")).toBeVisible();

    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    await page.locator("[data-email]").fill(email);
    await continueButton(page, 2).click();

    await expect(page.locator('input[data-dm="parcel"]')).toBeChecked();
    await expect(page.locator('[data-carrier="dpd"]')).toHaveAttribute("aria-current", "true");

    // …and the shopper's own choice still wins over it
    await page.locator('input[data-dm="pickup"]').check();
    await expect(page.locator('input[data-dm="pickup"]')).toBeChecked();
    await page.reload();
    await waitForScreen(page, "checkout");
    await page.locator("[data-email]").fill(email);
    await continueButton(page, 2).click();
    // a reload is a new session, so the preference is back — that is the promise
    await expect(page.locator('input[data-dm="parcel"]')).toBeChecked();
  });
});

test.describe("checkout — the skip link", () => {
  test.use({ extraHTTPHeaders: ipHeaders(209) });

  test("one Tab reaches it and it lands in the open step", async ({ page }) => {
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");

    /* Seven Tab presses used to separate the top of the page from the e-mail
       box (QA sweep 06.09, question 6). The link is the first thing in the
       page's tab order and is off-screen until it takes focus. */
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.className)).toContain("skip");
    // it is genuinely visible once focused — a skip link nobody can see is not one
    await expect(page.locator("a.skip")).toBeInViewport();

    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => document.activeElement?.hasAttribute("data-email")),
      "the skip link did not land next to the first field of the open step",
    ).toBe(true);
  });
});

test.describe("account — a fresh error clears the standing toast", () => {
  test.use({ extraHTTPHeaders: ipHeaders(210) });

  test("«Код отправлен ✓» does not sit under «Код не подошёл»", async ({ page }) => {
    await page.goto(shopUrl("", "/account/"));
    await waitForScreen(page, "account");
    await page.locator("[data-email]").fill(freshEmail("toast"));
    const codeResponse = page.waitForResponse((r) => r.url().includes("/api/account/code/"));
    await page.locator("[data-login]").click();
    await codeResponse;

    // the success toast is up…
    const toast = page.getByRole("status");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Код отправлен");

    // …and a wrong code must replace it, not appear underneath it
    await page.locator("[data-acctcode]").fill("000000");
    await page.locator("[data-logincode]").click();
    await expect(page.locator('.err[role="alert"]')).toBeVisible();
    await expect(toast, "two contradicting messages on screen at once").toHaveCount(0);
  });
});

test.describe("the Estonian blog is «Blogi»", () => {
  test.use({ extraHTTPHeaders: ipHeaders(211) });

  /* home.spec.ts already walks the nav, the footer, the crumbs and the <h1>
     through tr("Блог", …); what it does not read is the tab, which is
     setHead()'s own string and the one a shopper sees in their history. */
  test("the tab and the breadcrumb say «Blogi» too", async ({ page }) => {
    await page.goto(shopUrl("/et", "/blog/"));
    await waitForScreen(page, "blog");
    expect(await page.title()).toBe("Blogi — REMPIRE");
    await expect(page.locator("[data-nav-blog]")).toHaveText("Blogi");
    // the old label must not survive anywhere on the page
    expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/\bBlog\b(?!i)/);
  });
});

test.describe("«Бренды» — a page of its own, before any script runs", () => {
  test.use({ extraHTTPHeaders: ipHeaders(212) });

  for (const lang of LANGS) {
    test(`«${lang.code}» — the served HTML is the brands page, not the Russian shell`, async ({ page }) => {
      /* The crawler's view: the bytes off the wire, no JavaScript. Until
         07.09.2026 this was the home page's head at every prefix, with a
         canonical pointing at /shop2/. */
      const res = await page.request.get(shopUrl(lang.seg, "/brands/"));
      expect(res.status()).toBe(200);
      const html = await res.text();
      const pick = (re: RegExp) => (html.match(re) || [])[1] || "";

      expect(pick(/<html lang="([^"]*)"/)).toBe(lang.htmlLang);
      expect(pick(/<title>([^<]*)<\/title>/)).toContain(
        lang.code === "RU" ? "Бренды" : lang.code === "ET" ? "Brändid" : "Brands",
      );
      expect(pick(/<link rel="canonical" href="([^"]*)"/)).toContain(shopUrl(lang.seg, "/brands/"));
      const desc = pick(/<meta name="description" content="([^"]*)"/);
      expect(desc, "the brands page still carries the home page's description").not.toContain(
        "уход за волосами и бородой, стайлинг",
      );
      // every brand is a real link out of it — the second crawlable path to the 26
      expect((html.match(/href="\/shop2[^"]*\/b\/[^"]+\/"/g) || []).length).toBeGreaterThan(20);

      // …and it is in the sitemap now that it is a page
      const sm = await page.request.get("/sitemap-1.xml");
      expect((await sm.text()).includes(`${shopUrl(lang.seg, "/brands/")}<`)).toBe(true);
    });
  }
});

test.describe("the newsletter tick travels with the order", () => {
  test.use({ extraHTTPHeaders: ipHeaders(213) });

  test("«Хочу получать новости и скидки» reaches POST /api/orders", async ({ page }) => {
    const email = freshEmail("news");
    let sent: Record<string, unknown> | null = null;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/orders")) {
        try {
          sent = JSON.parse(req.postData() || "{}");
        } catch {
          sent = { unparsed: true };
        }
      }
    });

    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");

    await page.locator("[data-email]").fill(email);
    /* The box was collected into S.newsletter and read by nothing — a shopper
       ticked a consent box and the shop recorded nothing at all. */
    await page.locator("[data-news]").check();
    await payOrder(page, email, "paid");

    expect(sent, "no order was posted").not.toBeNull();
    expect((sent as unknown as { newsletter?: boolean }).newsletter).toBe(true);
  });
});

test.describe("the consent banner", () => {
  // a visitor who has never answered it — the suite's own storageState says
  // otherwise for every other test (playwright.config.ts)
  test.use({ extraHTTPHeaders: ipHeaders(214), storageState: { cookies: [], origins: [] } });

  for (const lang of LANGS) {
    test(`«${lang.code}» — a first visit is asked, in its own language`, async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/"));
      await waitForScreen(page, "home");
      const box = page.locator(".cbanner__box");
      await expect(box).toBeVisible();
      await expect(box).toContainText(
        lang.code === "RU" ? "Что мы храним" : lang.code === "ET" ? "Mida me salvestame" : "What we store",
      );
      await expect(page.locator('[data-consent="all"]')).toBeVisible();
      await expect(page.locator('[data-consent="need"]')).toBeVisible();
    });
  }

  test("«Только необходимое» stops the visit statistics and is remembered", async ({ page }) => {
    const beacons: string[] = [];
    await page.route("**/api/track/", async (route) => {
      beacons.push(route.request().url());
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });

    await page.goto(shopUrl("", "/"));
    await waitForScreen(page, "home");
    /* Nothing is measured before the shopper has answered — the whole point
       of asking. */
    expect(beacons, "a beacon went out before the visitor answered").toHaveLength(0);

    await page.locator('[data-consent="need"]').click();
    await expect(page.locator(".cbanner__box")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("rempire-consent"))).toContain('"analytics":false');

    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    // the choice survives the navigation, and the beacon stays silent
    await expect(page.locator(".cbanner__box")).toHaveCount(0);
    expect(beacons, "statistics were sent after the visitor declined").toHaveLength(0);
  });

  test("«Принять всё» starts them, and the footer link opens the choice again", async ({ page }) => {
    const beacons: string[] = [];
    await page.route("**/api/track/", async (route) => {
      beacons.push(route.request().url());
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });
    await page.goto(shopUrl("", "/"));
    await waitForScreen(page, "home");
    await page.locator('[data-consent="all"]').click();
    await expect(page.locator(".cbanner__box")).toHaveCount(0);

    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await expect.poll(() => beacons.length, { message: "no statistics after «Принять всё»" }).toBeGreaterThan(0);

    /* A choice made once has to be changeable — «Данные и cookie» in the
       footer is the way back to it. The footer is rebuilt by every render
       (the hero rotates), so this clicks it in the page rather than fighting
       Playwright's stability check for a node that is replaced under it. */
    await page.evaluate(() => (document.querySelector("[data-cookies]") as HTMLElement | null)?.click());
    await expect(page.locator(".cbanner__box")).toBeVisible();
  });

  test("it is never drawn over the checkout or the receipt", async ({ page }) => {
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await expect(page.locator(".cbanner__box")).toBeVisible();
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();

    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    // a shopper mid-payment is the last person who should be reading this,
    // and on a phone the bar would sit over «Оплатить»
    await expect(page.locator(".cbanner__box")).toHaveCount(0);

    await page.goto("/shop2/done/?n=R-100099&s=paid&t=9.00");
    await waitForScreen(page, "done");
    await expect(page.locator(".cbanner__box")).toHaveCount(0);
  });
});
