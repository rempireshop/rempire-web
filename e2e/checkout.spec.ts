import { expect, type Page, type Route, test } from "@playwright/test";
import {
  continueButton,
  freshEmail,
  functionalProject,
  ipHeaders,
  type LangCode,
  LANGS,
  openSummary,
  payButton,
  PRODUCT,
  shopUrl,
  tr,
  waitForScreen,
} from "./fixtures";

/** Cart → checkout → mock payment → receipt (paid and failed). Desktop only
 *  — see docs/testing.md "Why most specs run on desktop only". */
test.beforeEach(async ({}, testInfo) => {
  test.skip(!functionalProject(testInfo), "functional spec — desktop and mobile-safari projects only, see docs/testing.md");
});

/** `eur()`'s inverse (fixtures.ts documents the forward direction). */
function parseEur(text: string, lang: LangCode): number {
  const digits = lang === "EN" ? text.replace("€", "").replace(",", "") : text.replace("€", "").replace(/\s/g, "").replace(",", ".");
  return Number(digits.trim());
}

async function addProductAndGoToCheckout(page: Page, seg: string): Promise<void> {
  await page.goto(shopUrl(seg, `/p/${PRODUCT.id}/`));
  await waitForScreen(page, "product");
  await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto(shopUrl(seg, "/checkout/"));
  await waitForScreen(page, "checkout");
}

async function fillContactStep(page: Page, email: string): Promise<void> {
  await page.locator("[data-email]").fill(email);
  await continueButton(page, 2).click();
}

for (const [i, lang] of LANGS.entries()) {
  test.describe(`checkout — ${lang.code}`, () => {
    test.use({ extraHTTPHeaders: ipHeaders(40 + i) });

    test("delivery methods: pickup, parcel-machine picker, courier address", async ({ page }) => {
      await addProductAndGoToCheckout(page, lang.seg);
      await fillContactStep(page, freshEmail(`dm-${lang.code}`));

      // Country defaults to EE, where all three methods are offered.
      await expect(page.locator("[data-country]")).toHaveValue("EE");

      await page.locator('input[data-dm="pickup"]').check();
      // Pickup needs no address fields at all.
      await expect(page.locator('[data-shipf="addr"]')).toHaveCount(0);

      await page.locator('input[data-dm="parcel"]').check();
      /* Since 22.09.2026 the cards follow Montonio's order, and in Estonia that
         puts DPD first — a carrier an e2e run has no points for, so its card is
         struck off the moment its feed answers empty. Wait for every feed to
         land ("0" in flight) so the first card is one that stays. */
      await expect
        .poll(async () => page.locator("[data-co-delivery]").getAttribute("data-points-loading").catch(() => null),
          { timeout: 25_000, message: "parcel-point feeds never settled" })
        .not.toMatch(/^[1-9]/);
      const carrierChip = page.locator("[data-carrier]").first();
      await expect(carrierChip).toBeVisible();
      await carrierChip.click();
      await page.locator("[data-pointopen]").click();
      const sheet = page.getByRole("dialog", { name: tr("Выбор пакомата", lang.code) });
      await expect(sheet).toBeVisible();
      await sheet.locator("[data-pointq]").fill("Tallinn");
      // Live carrier feed with a seeded fallback (src/lib/parcel-points.ts) —
      // generous timeout, but it always resolves to *something*.
      await expect(sheet.locator("[data-pointpick]").first()).toBeVisible({ timeout: 15_000 });
      await sheet.locator("[data-pointpick]").first().click();
      await expect(page.locator("[data-pointopen]")).not.toHaveText(tr("Выберите пакомат", lang.code));

      await page.locator('input[data-dm="courier"]').check();
      await expect(page.locator('[data-shipf="addr"]')).toBeVisible();
      await expect(page.locator('[data-shipf="zip"]')).toBeVisible();
      await expect(page.locator('[data-shipf="city"]')).toBeVisible();
    });

    test("an invalid promo code shows an error", async ({ page }) => {
      await addProductAndGoToCheckout(page, lang.seg);
      await fillContactStep(page, freshEmail(`promo-${lang.code}`));

      // the promo field lives inside the summary, which a phone keeps folded
      await openSummary(page);
      await page.locator('[data-promo]').fill("NOSUCHCODE");
      await page.locator("[data-applypromo]").click();
      await expect(page.locator('div.err[role="alert"]')).toBeVisible();
    });

    test("order summary parity, then mock-pay leads to a paid receipt", async ({ page }) => {
      await addProductAndGoToCheckout(page, lang.seg);
      await fillContactStep(page, freshEmail(`pay-${lang.code}`));

      await page.locator('input[data-dm="courier"]').check();
      await page.locator('[data-shipf="name"]').fill("E2E Buyer");
      await page.locator('[data-shipf="addr"]').fill("Testitänav 1");
      await page.locator('[data-shipf="zip"]').fill("10111");
      await page.locator('[data-shipf="city"]').fill("Tallinn");
      await page.locator('[data-shipf="phone"]').fill("+372 5550000");
      await continueButton(page, 3).click();

      // Card — the only payment method with no further sub-choice (bank
      // links show a chip row; card does not).
      await page.locator('input[data-paym="1"]').check();

      await openSummary(page);
      const subtotal = await page
        .locator(".cosum__line .cosum__pr")
        .allTextContents()
        .then((vals) => vals.reduce((sum, v) => sum + parseEur(v, lang.code), 0));
      const shippingText = await page.locator(".cosum__row--rule .num").last().textContent();
      const totalText = await page.locator(".cosum__row--tot .num").textContent();
      const shipping = /бесплатно|tasuta|free/i.test(shippingText || "") ? 0 : parseEur(shippingText || "", lang.code);
      const total = parseEur(totalText || "", lang.code);
      expect(Math.round((subtotal + shipping) * 100)).toBe(Math.round(total * 100));

      await payButton(page).click();
      // Same-tab navigation to the mock bank (src/app/api/payments/mock/).
      await page.waitForURL(/\/api\/payments\/mock\//);
      await page.getByRole("link", { name: "Оплатить" }).click();

      await page.waitForURL(/\/shop2.*\/done\/\?.*s=paid/);
      await waitForScreen(page, "done");
      await expect(page.locator("h1")).toHaveText(tr("Заказ оплачен", lang.code));
      await expect(page.locator(".done__num")).toContainText(/R-\d+/);
    });

    /* Ренат, 13.09.2026: «I chose card payment and cancelled — it brought me
       back to page that "payment is being processed", cart is empty and I do
       not have option to pay again.»

       Cancelling at a bank is not a failed payment: Montonio's order token
       still says PENDING, so the shop landed on «Платёж обрабатывается» — a
       screen with one button, and it went home. This walks exactly that, in
       all three languages: the receipt has to say the order is not paid, offer
       «Оплатить ещё раз», and have the basket back. */
    test("cancelling at the bank leaves an unpaid order that can still be paid", async ({ page }) => {
      await addProductAndGoToCheckout(page, lang.seg);
      await fillContactStep(page, freshEmail(`cancel-${lang.code}`));

      await page.locator('input[data-dm="courier"]').check();
      await page.locator('[data-shipf="name"]').fill("E2E Buyer");
      await page.locator('[data-shipf="addr"]').fill("Testitänav 1");
      await page.locator('[data-shipf="zip"]').fill("10111");
      await page.locator('[data-shipf="city"]').fill("Tallinn");
      await page.locator('[data-shipf="phone"]').fill("+372 5550000");
      await continueButton(page, 3).click();
      await page.locator('input[data-paym="1"]').check();

      await payButton(page).click();
      await page.waitForURL(/\/api\/payments\/mock\//);
      await page.getByRole("link", { name: "Отменить" }).click();

      await page.waitForURL(/\/shop2.*\/done\/\?.*s=pending/);
      await waitForScreen(page, "done");
      await expect(page.locator("h1")).toHaveText(tr("Заказ не оплачен", lang.code));
      // the order travels on the receipt, so there is something to press
      expect(new URL(page.url()).searchParams.get("o")).toMatch(/^[0-9a-f-]{36}$/);
      await expect(page.locator("[data-payagain]")).toBeVisible();
      // …and the basket the order was made from is back
      await expect(page.locator("[data-cartbadge]")).toHaveText("1");
    });

    test("a payment the bank refuses leads to a failed receipt", async ({ page }) => {
      await addProductAndGoToCheckout(page, lang.seg);
      await fillContactStep(page, freshEmail(`fail-${lang.code}`));

      await page.locator('input[data-dm="courier"]').check();
      await page.locator('[data-shipf="name"]').fill("E2E Buyer");
      await page.locator('[data-shipf="addr"]').fill("Testitänav 1");
      await page.locator('[data-shipf="zip"]').fill("10111");
      await page.locator('[data-shipf="city"]').fill("Tallinn");
      await page.locator('[data-shipf="phone"]').fill("+372 5550000");
      await continueButton(page, 3).click();
      await page.locator('input[data-paym="1"]').check();

      await payButton(page).click();
      await page.waitForURL(/\/api\/payments\/mock\//);
      await page.getByRole("link", { name: "Банк отклонил платёж" }).click();

      await page.waitForURL(/\/shop2.*\/done\/\?.*s=failed/);
      await waitForScreen(page, "done");
      await expect(page.locator("h1")).toHaveText(tr("Оплата не прошла", lang.code));
    });
  });
}

/** Pickup delivery («Самовывоз») completing a real order end to end — not
 *  per-language: this is a delivery-method regression check (POST
 *  /api/orders used to 400 bad_name for every pickup order, because the
 *  contact block's name field was only ever rendered for parcel/courier —
 *  shipField()/shipRequired() in app.js), not an i18n one, so one language is
 *  enough — same reasoning visual.spec.ts stays ET-only (docs/testing.md). */
test.describe("checkout — pickup", () => {
  test.use({ extraHTTPHeaders: ipHeaders(43) });

  test("pickup completes an order end to end with the mock provider", async ({ page }) => {
    await addProductAndGoToCheckout(page, "");
    await fillContactStep(page, freshEmail("pickup"));

    await page.locator('input[data-dm="pickup"]').check();
    // Still no address fields for pickup — only the always-on contact block.
    await expect(page.locator('[data-shipf="addr"]')).toHaveCount(0);
    await page.locator('[data-shipf="name"]').fill("E2E Pickup");
    await page.locator('[data-shipf="phone"]').fill("+372 5550001");
    await continueButton(page, 3).click();

    await page.locator('input[data-paym="1"]').check();
    await payButton(page).click();
    await page.waitForURL(/\/api\/payments\/mock\//);
    await page.getByRole("link", { name: "Оплатить" }).click();

    await page.waitForURL(/\/shop2.*\/done\/\?.*s=paid/);
    await waitForScreen(page, "done");
    await expect(page.locator("h1")).toHaveText(tr("Заказ оплачен", "RU"));
    await expect(page.locator(".done__num")).toContainText(/R-\d+/);
  });
});

/** Regression: the checkout screen's own background probes (shipping rules,
 *  one loadPointsFor() per carrier — 4 for EE since Nova Post left it on
 *  22.09.2026, the signed-in account check,
 *  payment methods) used to call the full render() the instant each landed,
 *  tearing out and recreating the e-mail input on step 1 mid-keystroke — a
 *  visible flicker, and on a phone it also dropped the keyboard. app.js now
 *  coalesces render() itself into one rebuild per animation frame and, for
 *  checkout specifically, has those probes patch their own container
 *  ([data-co-delivery]/[data-co-payment]/[data-co-summary]) instead of
 *  calling render() at all — so the contact block is never touched while
 *  they resolve. All four probes are delayed here so they are still in
 *  flight (or only just landing) while the shopper is mid-keystroke on the
 *  very first field, which is exactly the timing that used to flicker.
 *  Not per-language: this is a DOM-stability check, not an i18n one. */
test.describe("checkout — e-mail field stability", () => {
  test.use({ extraHTTPHeaders: ipHeaders(44) });

  test("the e-mail input is never re-created while the checkout probes resolve", async ({ page }) => {
    const delayed = (body: unknown) => async (route: Route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    };
    await page.route("**/api/overrides/**", delayed({ ok: true, settings: {} }));
    await page.route("**/api/shipping/points/**", delayed({ ok: false }));
    await page.route("**/api/account/me/**", delayed({ ok: false }));
    await page.route(
      "**/api/payments/methods/**",
      delayed({ ok: true, banks: [{ name: "E2E Bank", code: "E2E", logoUrl: null }] }),
    );

    await addProductAndGoToCheckout(page, "");

    const email = page.locator("[data-email]");
    await expect(email).toBeVisible();
    const emailHandle = await email.elementHandle();
    if (!emailHandle) throw new Error("checkout: [data-email] has no element handle");

    // Count DOM mutations on the input's own parent from this point on —
    // "after the initial paint" means from here forward, not from navigation.
    await page.evaluate((input) => {
      const w = window as unknown as Record<string, unknown>;
      w.__coMutations = 0;
      const observer = new MutationObserver((records) => {
        w.__coMutations = (w.__coMutations as number) + records.length;
      });
      observer.observe(input.parentElement as Node, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      w.__coObserver = observer; // kept alive for the duration of the test
    }, emailHandle);

    const typed = "flicker-guard@example.com";
    await email.fill(typed);

    // The four mocked probes above all resolve within ~1.5s; wait past that
    // so the assertions below cover the fully-settled state, not mid-flight.
    await page.waitForTimeout(3000);

    expect(await page.evaluate((input) => input.isConnected, emailHandle)).toBe(true);
    expect(await email.inputValue()).toBe(typed);
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__coMutations)).toBe(0);
  });
});

/* Renat, 14.09.2026: «when I go — logged in — to checkout it loads my e-mail
   and data again within 1 seconds, this needs to be instant (!!!)».
 *
 * That second is the round trip to /api/account/me, and two rounds of work
 * have already taken everything else out of it: boot.js asks in the head,
 * before the twelve scripts at the foot of the page, and the route itself is
 * one database phase. What is left is the flight time — the functions run in
 * a US region, so from Estonia an uncached call costs ~175 ms however little
 * work it does. No client or server change can make that instant.
 *
 * So step 1 stops waiting for it. The server that hands out the shell has
 * already read the session cookie; it writes the address — and nothing else —
 * into a JSON tag in the head (src/lib/notfound-page.ts), and app.js adopts
 * it beside #blogdata, before the first paint. Step 2's name, phone, street
 * and index are not built until «Далее» is pressed, by which time the profile
 * is long back, so the e-mail is the whole of what a signed-in shopper can
 * see too early.
 *
 * The profile request is BLOCKED here, not delayed: the only way the box can
 * carry the address is the document itself. */
test.describe("checkout — a signed-in e-mail is in the box at first paint", () => {
  test.use({ extraHTTPHeaders: ipHeaders(45) });

  test("the e-mail is painted from the page, with /api/account/me blocked", async ({ page }) => {
    const email = freshEmail("boot-email");

    await page.goto(shopUrl("", "/account/"));
    await waitForScreen(page, "account");
    // Nobody is signed in yet, so the page carries no address at all — the
    // tag exists only for a request that brought a valid session cookie.
    await expect(page.locator("#acctdata")).toHaveCount(0);

    // Sign in. The code is read off the network, exactly as account.spec.ts
    // does it (E2E_EXPOSE_LOGIN_CODE, docs/testing.md).
    await page.locator("[data-email]").fill(email);
    const codeResponse = page.waitForResponse((r) => r.url().includes("/api/account/code/"));
    await page.locator("[data-login]").click();
    const codeBody = (await (await codeResponse).json()) as { ok: boolean; code?: string };
    expect(codeBody.code).toMatch(/^\d{6}$/);
    await page.locator("[data-acctcode]").fill(codeBody.code!);
    await page.locator("[data-logincode]").click();
    await expect(page.locator("[data-logout]")).toBeVisible();

    // From here the profile never answers — boot.js's request and app.js's
    // alike. Whatever ends up in the box came from the document.
    await page.route("**/api/account/me/**", (route) => route.abort());

    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();

    const response = await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");

    /* The privacy half of the bargain, and the reason the address is put in
       the page rather than saved on the device: a page that carries one must
       never be stored — not by the edge, not by this browser's disk cache,
       not in the back/forward cache. A shared computer must not serve the
       previous person's e-mail out of a cache. */
    expect(response?.headers()["cache-control"]).toBe("no-store");

    // The tag the server wrote: the address, and nothing else in it.
    expect(JSON.parse((await page.locator("#acctdata").textContent()) || "null")).toEqual({ email });

    const box = page.locator("[data-email]");
    await expect(box).toHaveValue(email);
    /* `defaultValue` is the value *attribute* app.js rendered. The late
       prefill in acctLoad() assigns the property instead (it must not rebuild
       the field), so an address that arrived with the profile would leave
       this empty. Reading it full is what "at first paint" means. */
    expect(await box.evaluate((el) => (el as HTMLInputElement).defaultValue)).toBe(email);
  });
});

test.describe("checkout — the step says when it is finished", () => {
  test.use({ extraHTTPHeaders: ipHeaders(46) });

  /* Dim, 07.09.2026, after paying with a gift card: «after I entered where
     items should be shipped, maybe the button for "checkout" should make a
     short animation … for the user to understand where to click». Typing in
     an address field deliberately does not re-render the step — a rebuild
     would take the caret with it — so filling the last field changed nothing
     on screen. It now pulses «Далее — оплата», once, on the way out of the
     field that completed the step. */
  test("«Далее — оплата» pulses once, and only when the address is complete", async ({ page }) => {
    // the first hit on /checkout/ compiles the route on a cold dev server
    test.setTimeout(90_000);
    await addProductAndGoToCheckout(page, "");
    await fillContactStep(page, freshEmail("nudge"));

    await page.locator('input[data-dm="courier"]').check();
    const next = continueButton(page, 3);
    await expect(next, "the button is drawn before the address is filled").toBeVisible();
    await expect(next, "an empty address must not be told it is finished").not.toHaveClass(/btn--nudge/);

    await page.locator('[data-shipf="name"]').fill("E2E Buyer");
    await page.locator('[data-shipf="addr"]').fill("Testitänav 1");
    await page.locator('[data-shipf="zip"]').fill("10111");
    await page.locator('[data-shipf="city"]').fill("Tallinn");
    // the phone is required for a courier too — shipMissing() lists five
    await page.locator('[data-shipf="phone"]').fill("+372 5000000");
    // the class arrives on the way OUT of the last field, not on the keystroke
    await page.locator('[data-shipf="phone"]').blur();

    await expect(next, "the finished step never pointed at the way on").toHaveClass(/btn--nudge/);
  });
});

test.describe("checkout — the carrier's own mark", () => {
  test.use({ extraHTTPHeaders: ipHeaders(47) });

  /* Dim, 08.09.2026: «есть ли у Montonio логотипы пакоматов? Сейчас там просто
     цвета» — put the brand mark next to the name, the way the bank list at the
     payment step already does it, so the shopper recognises here the sign he
     will walk up to at the machine. There is no Montonio in an e2e run
     (GET /api/shipping/carriers/ answers 503 and the chips keep their colour
     dots, which is the no-keys half of the feature), so the list is stubbed —
     one carrier with a mark that loads and one with a mark that does not,
     because the second is the half Dim asked about by name. */
  test("draws the mark beside the name, and keeps the name when the mark 404s", async ({ page }) => {
    // the first hit on /checkout/ compiles the route on a cold dev server
    test.setTimeout(90_000);
    await page.route("**/api/shipping/carriers/**", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          carriers: [
            // a file this server really serves, so the <img> loads
            { code: "omniva", name: "Omniva", logoUrl: "/og-shop.png" },
            { code: "smartpost", name: "SmartPosti", logoUrl: "/no-such-carrier-mark.svg" },
          ],
        }),
      }),
    );

    await addProductAndGoToCheckout(page, "");
    await fillContactStep(page, freshEmail("carrier-mark"));
    await page.locator('input[data-dm="parcel"]').check();
    /* The block is rewritten every time a carrier feed lands; "0" means it has
       stopped moving, so the assertions below are about the final chips. */
    await expect
      .poll(async () => page.locator("[data-co-delivery]").getAttribute("data-points-loading").catch(() => null),
        { timeout: 25_000, message: "parcel-point feeds never settled" })
      .not.toMatch(/^[1-9]/);

    const omniva = page.locator('[data-carrier="omniva"]');
    await expect(omniva.locator("img.carrier__logo")).toBeVisible();
    // the mark AND the name — the chip that has one drops the colour dot
    await expect(omniva).toHaveClass(/carrier--logo/);
    await expect(omniva).toContainText("Omniva");

    /* …and the picked chip does not eat the mark it was given.

       Renat, 14.09.2026: «logos which are having black text and when you click
       on them then the button is fully black, for example "unisend"». The pick
       filled the chip with --ink, and half of Montonio's marks are black
       artwork on nothing — and the first carrier is picked before the shopper
       has touched anything, so the delivery step opened with a black hole in
       it. It is marked the way the bank tiles one step later already are
       (styles.css, .bank[aria-current="true"] and the copy of it under
       .carrier[aria-current="true"]): an ink ring over the chip's own light
       ground.

       Measured rather than matched against a colour name, so any treatment a
       black mark survives passes — and composited down the ancestors, because
       --hover is 5% ink and an alpha channel read on its own would read as
       black as the fill it replaced.

       Omniva is the first card here only because the feeds have settled:
       since 22.09.2026 Estonia's cards are in Montonio's order — DPD, Omniva,
       Unisend, SmartPosti — and an e2e run has no DPD or Unisend points, so
       both are struck off and Omniva is what is left at the top. */
    await expect(omniva, "the first carrier is no longer picked on arrival").toHaveAttribute("aria-current", "true");
    const lum = await omniva.evaluate((el: Element) => {
      const parse = (css: string) => {
        const n = (css.match(/[\d.]+/g) || []).map(Number);
        return n.length >= 3 ? { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 } : null;
      };
      const stack: Array<{ r: number; g: number; b: number; a: number }> = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
      }
      // the browser's own canvas under everything, then each layer over it
      let out = { r: 255, g: 255, b: 255 };
      for (let i = stack.length - 1; i >= 0; i--) {
        const c = stack[i];
        out = {
          r: c.r * c.a + out.r * (1 - c.a),
          g: c.g * c.a + out.g * (1 - c.a),
          b: c.b * c.a + out.b * (1 - c.a),
        };
      }
      const s = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
      return 0.2126 * s(out.r) + 0.7152 * s(out.g) + 0.0722 * s(out.b);
    });
    expect(lum, "the picked carrier chip is dark — a black brand mark disappears into it").toBeGreaterThan(0.5);

    /* The fallback, which is the same one the bank chips have had since UX fix
       9: the capture-phase "error" listener takes the broken image out, and
       the name it was sitting next to is what stays on the chip. */
    const smartpost = page.locator('[data-carrier="smartpost"]');
    /* The 404 is what removes the mark, and on a cold `next dev` the first
       404 of the run compiles the not-found route first — on a CI runner
       that alone ran past the 8-second default (shard 1, 10.09.2026: failed,
       then passed on the retry with the route warm). */
    await expect(smartpost.locator("img.carrier__logo"), "the broken mark was not taken off the chip").toHaveCount(0, { timeout: 30_000 });
    await expect(smartpost).toContainText("SmartPosti");
  });
});
