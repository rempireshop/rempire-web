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
import { BUNDLE, eur, functionalProject, ipHeaders, LANGS, PRODUCT, shopUrl, tr, waitForScreen } from "./fixtures";

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
