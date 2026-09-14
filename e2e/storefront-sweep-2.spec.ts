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
 * …and the three Renat found on his own phone on 13.09.2026, at the bottom
 * of this file:
 *
 *  - a set went on offering «В корзину» after its product was taken off sale,
 *    because the set's availability was a snapshot the shop asked for once at
 *    boot — and the list of what is inside never said WHICH part was missing;
 *  - typing in the search screen's own box rebuilt the screen, and the
 *    replacement input took the phone's keyboard down with it;
 *  - «Сбросить» in the filter pane rebuilt the overlay, so the pane replayed
 *    its slide-in as though it had closed and opened again.
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
  loginAsAdmin,
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
    /* The share link a messenger mangled — the bug this test was written for
       (`6933a0c`): the QUERY is what came back mangled, and it used to throw
       URIError out of the router during boot, leaving the prerendered page
       lying under an app that never painted. */
    for (const path of ["/search/?q=%E0", "/et/search/?q=%E0%E0"]) {
      await page.goto(`/shop2${path}`);
      await waitForScreen(page, "search");
      await expect(page.locator("#prerender"), `${path}: the prerendered page stayed under the app`).toHaveCount(0);
      expect(errors, `${path}: uncaught page error`).toEqual([]);
    }

    /* A mangled PATH is not an address at all, and Next refuses to decode one
       into a route parameter: /shop2/p/%E0/ has answered 400 ever since the
       request-time product page existed, and since 07.09.2026 every /shop2/
       path is a route, so they all answer the same way. What matters here is
       that it is a clean refusal with a status — never a 5xx, never a stack.
       (Question 4 in docs/audit/2026-09-07-storefront.md: whether that 400
       should be dressed as the shop's own 404 is Dim's call.) */
    for (const path of ["/p/%E0/", "/b/%E0/", "/set/%E0/"]) {
      const res = await page.request.get(`/shop2${path}`);
      expect(res.status(), path).toBe(400);
    }

    /* …and the router's own safeDecode() still holds for a mangled id the SPA
       reaches by navigating rather than by a cold load, which is the code
       path the fix was actually about. */
    await page.goto(shopUrl("", "/sets/"));
    await waitForScreen(page, "bundles");
    await page.evaluate(() => {
      history.pushState({}, "", "/shop2/set/%E0/");
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    });
    await waitForScreen(page, "bundle");
    expect(errors, "a mangled set id threw out of the router").toEqual([]);
  });
});

test.describe("chat — the language on screen", () => {
  test.use({ extraHTTPHeaders: ipHeaders(196) });
  /* Dim, 07.09.2026: «mobiilis ei kasuta üldse poes assistenti.» The shop's
     chat is not merely hidden on a phone — app.js never fetches chat.js below
     768 px — so there is no FAB here to click. The rule itself is tested from
     the phone side in chatbot.spec.ts («the assistant on a phone»); what this
     test is about, the language the bubble greets in, only exists where the
     bubble does. */
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile" || testInfo.project.name === "mobile-safari",
      "the shop's assistant is not drawn on a phone at all",
    );
  });

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

test.describe("statistics — what a «view» beacon carries", () => {
  test.use({ extraHTTPHeaders: ipHeaders(203) });

  /* Same engine caveat as the receipt beacons above: WebKit hands Playwright
     an intercepted sendBeacon with no body to read. */
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile-safari" || testInfo.project.name === "webkit-local",
      "WebKit does not expose a sendBeacon body to route interception",
    );
  });

  /* The privacy policy promises the statistics keep «страница, язык, страна и
     тип устройства». pathFor() writes the typed phrase into the search
     screen's own address, so the «view» row used to carry `?q=<what somebody
     typed>` — a second copy of the phrase, under the same sid, for the whole
     ninety-day window, in a column no report ever reads (src/lib/analytics.ts
     only counts distinct sids on a view row). The search row itself still
     holds the term: that one is «Искали, но не нашли» and is meant to. */
  test("the search screen's view beacon carries the page, not the phrase", async ({ page }) => {
    const views: string[] = [];
    await page.route("**/api/track/", async (route) => {
      try {
        const beacon = JSON.parse(route.request().postData() || "{}") as { type?: string; path?: string };
        if (beacon.type === "view") views.push(String(beacon.path ?? ""));
      } catch {
        /* an unreadable beacon is not what this test is about */
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });

    await page.goto(shopUrl("", `/search/?q=${encodeURIComponent("шампунь")}`));
    await waitForScreen(page, "search");
    await expect.poll(() => views.length).toBeGreaterThan(0);
    expect(views).toContain("/shop2/search/");
    for (const path of views) {
      expect(path).not.toContain("?");
      expect(path).not.toContain("шампунь");
      expect(path.toLowerCase()).not.toContain("%d1%88"); // …nor percent-encoded
    }
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

    /* «Пакомат SmartPosti» is not the checkout's first carrier chip (that is
       Omniva) — and the account checks no row at all until a preference
       exists — so finding it selected at the till can only mean the
       preference travelled. The block promised «Подставим это при следующем
       заказе» and did nothing at all until 07.09.2026. */
    const row = page.locator(".optlist .opt").filter({ hasText: "Пакомат SmartPosti" }).first();
    await expect(row).toBeVisible();
    /* The machine list is the checkout's own live feed now, not the static
       copy the account used to keep — so the name saved here is one the till
       can find again. Wait for that carrier's feed before reading it. */
    const feed = page.waitForResponse((r) => r.url().includes("/api/shipping/points/") && r.url().includes("carrier=smartpost"));
    await row.locator("input[data-acctm]").check();
    await feed;
    const machines = page.locator("[data-acctmachine]");
    await expect(machines).toBeEnabled();
    await expect.poll(async () => (await machines.locator("option").count())).toBeGreaterThan(1);
    /* The select opens on a placeholder — a machine is chosen, never assumed
       (the alphabetically first one is in Abja-Paluoja) — and since
       12.09.2026 the block saves itself: a parcel row waits for its machine
       and says so under the list, and the pick of the machine is what puts
       the choice on the row (account-settings.spec.ts has the whole flow). */
    const line = page.locator('[data-acctst="ship"]');
    await expect(line).toHaveText("Выберите пакомат — тогда сохраним");
    await machines.selectOption({ index: 1 });
    const machine = (await machines.inputValue()).trim();
    expect(machine.length, "no parcel machine offered in the account").toBeGreaterThan(0);
    await expect(line).toContainText("✓");

    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    await page.locator("[data-email]").fill(email);
    await continueButton(page, 2).click();

    await expect(page.locator('input[data-dm="parcel"]')).toBeChecked();
    await expect(page.locator('[data-carrier="smartpost"]')).toHaveAttribute("aria-current", "true");
    // …and the machine itself, matched by name against the live list
    await expect(page.locator("[data-pointopen]")).toContainText(machine);

    // …and the shopper's own choice still wins over it, in this session
    await page.locator('input[data-dm="pickup"]').check();
    await expect(page.locator('input[data-dm="pickup"]')).toBeChecked();

    // a reload is a new session, so the standing preference is back
    await page.reload();
    await waitForScreen(page, "checkout");
    await page.locator("[data-email]").fill(email);
    await continueButton(page, 2).click();
    await expect(page.locator('[data-carrier="smartpost"]')).toHaveAttribute("aria-current", "true");
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
    await expect(page.locator("button.skip")).toBeInViewport();

    await page.keyboard.press("Enter");
    expect(
      await page.evaluate(() => document.activeElement?.hasAttribute("data-email")),
      "the skip link did not land on the first field of the open step",
    ).toBe(true);

    // …and it follows the step that is open, not a fixed field
    await page.keyboard.type(`kbd-skip-${Date.now()}@example.com`);
    await continueButton(page, 2).click();
    await expect(page.locator('input[data-dm="parcel"]')).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    expect(
      await page.evaluate(() => !!document.activeElement?.closest(".costep.is-open .costep__body")),
      "on step 2 the skip link left the open step",
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

  test("«Хочу получать скидки и поздравление ко дню рождения» reaches POST /api/orders", async ({ page }) => {
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

/* ------------------------------------------------------------------------
   `shop-set-out` — Renat, 13.09.2026, on his phone.

   A set's «нет в наличии» used to come from ONE place: the `stock` field
   /api/bundles/ computes server-side, which app.js asks for once, at boot.
   The live per-product stock rides on the other feed (/api/overrides/) and
   already reaches every product card — so the product's own page said «нет в
   наличии» while the set containing it still offered «В корзину», until the
   whole page was loaded again by hand.

   The set page reads its parts out of the live catalogue now
   (bundleStock()/bundleItemStock() in app.js), so the stale half of the first
   test below is the sharp one: it serves the shop a DELIBERATELY STALE
   /api/bundles/ — the exact body the route answered before the change, which
   is what a browser's stale-while-revalidate window and the edge can both go
   on handing out for a couple of minutes — and the page still has to be
   right.
------------------------------------------------------------------------ */
test.describe("sets — a part taken off sale", () => {
  test.use({ extraHTTPHeaders: ipHeaders(223) });

  /** One of BUNDLE's three parts (tools/bundles.config.mjs). Single volume,
   *  and no other spec needs it in stock — and it is put back in a `finally`
   *  either way, the same rule e2e/sets.spec.ts follows for the shop-wide
   *  switch it flips. */
  const PART = { id: "handmade-soap-666", name: "Чёрное мыло 666" };

  /** The owner's edit, and the public feed carrying it before any shop page
   *  is opened — the same guard, for the same reason, as the switch test in
   *  e2e/sets.spec.ts. */
  async function takePartOffSale(page: import("@playwright/test").Page): Promise<void> {
    expect((await page.request.put("/api/admin/overrides/", { data: { id: PART.id, stock: "out" } })).status()).toBe(200);
    await expect
      .poll(
        async () => {
          const body = await (await page.request.get("/api/overrides/", { headers: { "cache-control": "no-cache" } })).json();
          return body.overrides && body.overrides[PART.id] ? body.overrides[PART.id].stock : null;
        },
        { timeout: 10_000, message: "the overrides feed still has the part in stock" },
      )
      .toBe("out");
  }

  test("the set stops selling itself and names the part that is missing", async ({ page, browser }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);

    /* The snapshot as it was BEFORE the edit — what a browser that has
       already asked for /api/bundles/ is still holding. */
    const staleBundles = await (await page.request.get("/api/bundles/")).text();
    expect(staleBundles).toContain(BUNDLE.id);

    try {
      await takePartOffSale(page);

      for (const stale of [false, true]) {
        const ctx = await browser.newContext({ extraHTTPHeaders: ipHeaders(223) });
        const shop = await ctx.newPage();
        if (stale) {
          await shop.route("**/api/bundles/", (route) =>
            route.fulfill({ status: 200, contentType: "application/json", body: staleBundles }));
        }
        const why = stale ? "with a stale /api/bundles/" : "on a plain visit";

        /* Arrive on the landing and walk to the set the way a shopper does:
           one page load, then a client-side navigation. */
        await shop.goto(shopUrl("", "/sets/"));
        await waitForScreen(shop, "bundles");
        await shop.locator(`[data-go-bundle="${BUNDLE.id}"]`).first().click();
        await waitForScreen(shop, "bundle");

        // nothing on the page sells it: not the wide button, not the sticky bar
        await expect(shop.locator("[data-addbundle]"), why).toHaveCount(0);
        await expect(shop.locator(".pdp__price"), why).toContainText("нет в наличии");
        // the sentence that was always there stays there
        await expect(shop.locator(".pdp"), why).toContainText("Одного из товаров сейчас нет");
        // …and the line of the part that is actually missing says so — that
        // one line, and no other
        await expect(shop.locator("[data-bitemout]"), why).toHaveCount(1);
        const marked = shop.locator(`[data-bitemout="${PART.id}"]`);
        await expect(marked, why).toHaveText("нет в наличии");
        await expect(marked.locator("xpath=.."), why).toContainText(PART.name);

        await ctx.close();
      }
    } finally {
      await page.request.put("/api/admin/overrides/", { data: { id: PART.id, stock: null } });
    }
  });

  test("ET and EN get the same per-line marker out of the dictionary", async ({ page, browser }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    try {
      await takePartOffSale(page);
      for (const lang of LANGS) {
        const ctx = await browser.newContext({ extraHTTPHeaders: ipHeaders(223) });
        const shop = await ctx.newPage();
        await shop.goto(shopUrl(lang.seg, `/set/${BUNDLE.id}/`));
        await waitForScreen(shop, "bundle");
        await expect(shop.locator(`[data-bitemout="${PART.id}"]`), lang.code).toHaveText(tr("нет в наличии", lang.code));
        await ctx.close();
      }
    } finally {
      await page.request.put("/api/admin/overrides/", { data: { id: PART.id, stock: null } });
    }
  });
});

/* ------------------------------------------------------------------------
   `shop-search-phrase` — Renat, 13.09.2026, on his phone: typing «rasvased »
   (the trailing space is the keystroke that did it) put the on-screen
   keyboard away, and so did clearing the box.

   Why: every keystroke in [data-search2] called render(), which rewrites the
   whole body — destroying the very <input> being typed into — and then
   focused the REPLACEMENT node. A browser raises the keyboard for an element
   that took focus from a tap, not for one handed focus by a script after the
   original was removed, so the keyboard folded away.

   A headless browser has no keyboard to lose, so what is pinned here is the
   cause: the input must be the SAME node afterwards (tagged in the page and
   checked for that tag), and it must still hold the focus.
------------------------------------------------------------------------ */
test.describe("search — the box survives its own results", () => {
  test.use({ extraHTTPHeaders: ipHeaders(224) });

  /** Is the box on screen the one we tagged, and is it the focused element? */
  async function boxState(page: import("@playwright/test").Page) {
    return page.evaluate(() => {
      const el = document.querySelector("[data-search2]") as (HTMLInputElement & { __e2eTag?: string }) | null;
      return {
        present: !!el,
        sameNode: el ? el.__e2eTag === "renat" : false,
        focused: !!el && document.activeElement === el,
        value: el ? el.value : null,
      };
    });
  }

  test("typing and clearing keep the very same input focused", async ({ page }) => {
    // the Estonian shop, where he hit it
    await page.goto(shopUrl("/et", "/search/"));
    await waitForScreen(page, "search");
    const box = page.locator("[data-search2]");
    await expect(box).toBeVisible();
    await box.evaluate((el) => { (el as HTMLInputElement & { __e2eTag?: string }).__e2eTag = "renat"; });

    // real keystrokes, trailing space and all
    await box.pressSequentially("rasvased ", { delay: 20 });
    expect(await boxState(page)).toEqual({ present: true, sameNode: true, focused: true, value: "rasvased " });
    // the results underneath really did repaint — the popular-query chips of
    // the empty state are gone
    await expect(page.locator("[data-searchres] [data-q]")).toHaveCount(0);
    // …and the query still rides on the address, as it did before
    await expect(page).toHaveURL(/\/search\/\?q=rasvased/);

    // clearing the field, the other half of the finding
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    expect(await boxState(page)).toEqual({ present: true, sameNode: true, focused: true, value: "" });
    // an empty box is back to the popular queries
    await expect(page.locator("[data-searchres] [data-q]").first()).toBeVisible();
  });
});

/* ------------------------------------------------------------------------
   `shop-category` — Renat, 13.09.2026: «Сбросить» inside the filter pane made
   the pane play its opening animation again, as though it had closed and
   re-opened. The overlay was rebuilt on purpose (`ovlKey = ""`) just to untick
   the boxes, and a rebuilt .drawer replays `animation: slideIn` (styles.css).
------------------------------------------------------------------------ */
test.describe("filters — «Сбросить» clears without re-opening the pane", () => {
  test.use({ extraHTTPHeaders: ipHeaders(225) });

  test("the pane is the same element afterwards, and nothing animates", async ({ page }) => {
    await page.goto(shopUrl("", "/c/hair/"));
    await waitForScreen(page, "catalog");
    await page.locator("[data-filter]").click();

    const pane = page.getByRole("dialog", { name: "Фильтры" });
    await expect(pane).toBeVisible();
    // let the real slide-in finish before anything is measured
    await expect
      .poll(() => pane.evaluate((el) => el.getAnimations().length), { message: "the pane never settled after opening" })
      .toBe(0);
    await pane.evaluate((el) => { (el as HTMLElement & { __e2eTag?: string }).__e2eTag = "renat"; });

    const show = page.locator("[data-showbtn]");
    const whole = (await show.textContent()) ?? "";
    await page.locator("[data-brand]").first().check();
    await page.locator("[data-instock]").check();
    await expect(show).not.toHaveText(whole);

    await page.locator('[data-clearfilter="keep"]').click();

    // the pane did not close, was not rebuilt, and is not animating
    await expect(pane).toBeVisible();
    expect(
      await pane.evaluate((el) => ({
        sameNode: (el as HTMLElement & { __e2eTag?: string }).__e2eTag === "renat",
        animating: el.getAnimations().length,
      })),
    ).toEqual({ sameNode: true, animating: 0 });
    // …and it really did clear: boxes off, the count back to the whole listing
    await expect(page.locator("[data-brand]:checked")).toHaveCount(0);
    await expect(page.locator("[data-instock]")).not.toBeChecked();
    await expect(show).toHaveText(whole);
  });
});
