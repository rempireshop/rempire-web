import { expect, type Page, test } from "@playwright/test";
import { continueButton, eur, freshEmail, ipHeaders, PRODUCT, PRODUCT_2, shopUrl, waitForScreen } from "./fixtures";
import {
  assertClean, clearToast, EMOJI, freshShop, GOOD_VIDEO, HTML_BOMB, isRussian, LONG,
  openAdmin, openSettings, pick, prng, tab, toastText, watch, type Watch,
} from "./sweep-helpers";

/**
 * Admin panel fuzz sweep, part 2: the goods editor, the delivery-price table
 * and promo codes — the three screens where a typo becomes a number the shop
 * charges a stranger. See sweep-admin.spec.ts's header for the house rules.
 *
 * The product sample is seeded (`prng(20260904)`), so a failure names the
 * same five products on the next run. PRODUCT/PRODUCT_2 are excluded: other
 * spec files hard-code their prices (fixtures.ts), and a sweep that failed
 * half way through a restore would take those files down with it.
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "admin sweep — desktop project only, see docs/testing.md");
});

/**
 * The redesigned editor is five tabs over ONE form (docs/features.md § «Товар»):
 * every pane is in the DOM at once and the inactive ones carry `hidden`, so a
 * spec that types into a field has to open that field's tab first.
 */
type EdTab = "main" | "sizes" | "media" | "desc" | "seo";
async function edTab(page: Page, key: EdTab): Promise<void> {
  await page.locator(`[data-edtab="${key}"]`).click();
  await expect(page.locator(`[data-edtab="${key}"][aria-current="true"]`)).toBeVisible();
}

/** Opens one product's editor from the «Товары» tab, the way the owner does,
 *  and lands on «Размеры и цены» — where the money is. */
async function openGoods(page: Page, id: string): Promise<void> {
  // Clicking the tab is also how the editor is closed (the handler clears
  // S.adminEdit), so this works whether or not one is already open.
  await tab(page, "goods");
  await page.locator("[data-goodsq]").fill(id);
  await page.locator(`[data-admgoods="${id}"]`).click();
  await edTab(page, "sizes");
  await expect(page.locator("[data-edprice]")).toBeVisible();
}

/** The editor's own error line — a refusal the owner can read. */
function goodsErr(page: Page) {
  return page.locator("[data-goodserr]");
}

async function saveGoods(page: Page, id: string): Promise<void> {
  await page.locator(`[data-admsavegoods="${id}"]`).click();
}

/**
 * Types `value` into the price box, saves, and demands a readable refusal:
 * the editor still open, a Russian sentence, and the price untouched.
 */
async function expectPriceRefused(page: Page, w: Watch, id: string, value: string, was: string): Promise<void> {
  await page.locator("[data-edprice]").fill(value);
  await saveGoods(page, id);
  await expect(goodsErr(page), `price "${value}" was accepted or dropped without a word`).toBeVisible();
  const msg = (await goodsErr(page).textContent() || "").trim();
  expect(isRussian(msg), `price "${value}": message is not Russian — "${msg}"`).toBe(true);
  // Still in the editor — a refusal that also throws away the form is a
  // second bug on top of the first.
  await expect(page.locator("[data-edprice]"), `price "${value}": the editor closed on a refusal`).toBeVisible();
  await assertClean(page, w, `goods price "${value}"`);
  await page.locator("[data-edprice]").fill(was);
}

test.describe("sweep — goods editor", () => {
  test.use({ extraHTTPHeaders: ipHeaders(157) });

  test("five seeded products: garbage is refused in Russian, good values reach the shop, then everything is put back", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const w = watch(page);
    await openAdmin(page);
    await tab(page, "goods");
    await page.locator("[data-goodsq]").fill("");

    const ids = (await page.locator("[data-admgoods]").evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-admgoods") || "")))
      .filter((id) => id && id !== PRODUCT.id && id !== PRODUCT_2.id);
    expect(ids.length, "the goods list showed nothing to edit").toBeGreaterThan(6);
    const sample = pick(ids, 5, prng(20260904));

    const restore: Array<{ id: string; price: string; stock: string }> = [];
    try {
      for (const [i, id] of sample.entries()) {
        const deep = i === 0;   // the whole matrix once; the money fields on all five
        await openGoods(page, id);
        const price = await page.locator("[data-edprice]").inputValue();
        await edTab(page, "main");
        const stock = await page.locator("[data-edstock]").inputValue();
        await edTab(page, "sizes");
        restore.push({ id, price, stock });

        // ---- retail price -------------------------------------------------
        for (const bad of ["abc", "-5", "0", "1e9", ""]) await expectPriceRefused(page, w, id, bad, price);

        // ---- salon price ---------------------------------------------------
        await page.locator("[data-edproprice]").fill("abc");
        await saveGoods(page, id);
        await expect(goodsErr(page), "a salon price of «abc» was swallowed").toBeVisible();
        expect(isRussian((await goodsErr(page).textContent()) || "")).toBe(true);
        // Above retail — a salon paying more than the shelf price is a typo,
        // and a silent one is money lost on every wholesale order.
        await page.locator("[data-edproprice]").fill("400");
        await saveGoods(page, id);
        await expect(goodsErr(page), "a salon price above retail was accepted in silence").toBeVisible();
        expect(await page.locator("[data-edprice]").inputValue(),
          "a refused save still rewrote the price box").toBe(price);
        await assertClean(page, w, `goods "${id}" salon price refused`);

        // ---- what must go through ------------------------------------------
        // «12,50» is how a Russian- or Estonian-speaking owner writes money;
        // 5 € for a salon is below retail, which is the real case.
        await page.locator("[data-edprice]").fill("12,50");
        await page.locator("[data-edproprice]").fill("5");
        await saveGoods(page, id);
        expect(await toastText(page)).toMatch(/Сохранено/);
        await clearToast(page);
        await assertClean(page, w, `goods "${id}" saved 12,50`);
        await openGoods(page, id);
        expect(Number((await page.locator("[data-edprice]").inputValue()).replace(",", ".")),
          "«12,50» did not become 12.50").toBeCloseTo(12.5, 2);
        expect(Number(await page.locator("[data-edproprice]").inputValue()), "the salon price did not stick").toBe(5);

        if (!deep) continue;

        // Three decimals: rounded to cents, never stored as typed.
        await page.locator("[data-edprice]").fill("12.505");
        await saveGoods(page, id);
        await clearToast(page);
        await openGoods(page, id);
        const cents = Number((await page.locator("[data-edprice]").inputValue()).replace(",", "."));
        expect(cents, "12.505 landed nowhere near 12.50/12.51").toBeCloseTo(12.505, 1);
        expect((String(cents).split(".")[1] || "").length, "a price was stored with more than two decimals")
          .toBeLessThanOrEqual(2);

        // Padding is not a value.
        await page.locator("[data-edprice]").fill("  7  ");
        await saveGoods(page, id);
        await clearToast(page);
        await openGoods(page, id);
        expect(Number((await page.locator("[data-edprice]").inputValue()).replace(",", ".")),
          "«  7  » was not read as 7").toBe(7);

        // ---- stock ---------------------------------------------------------
        for (const value of ["out", "low", "in"]) {
          await edTab(page, "main");
          await page.locator("[data-edstock]").selectOption(value);
          await saveGoods(page, id);
          await clearToast(page);
          await openGoods(page, id);
          await edTab(page, "main");
          expect(await page.locator("[data-edstock]").inputValue(), `stock "${value}" did not stick`).toBe(value);
        }
        await assertClean(page, w, `goods "${id}" stock`);
      }

      // ---- the full text/media matrix, on the first sampled product --------
      const subject = sample[0];
      await openGoods(page, subject);

      await edTab(page, "main");
      const sub = page.locator("[data-edsubcat]");
      if (await sub.count()) {
        const values = await sub.locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
        const nonEmpty = values.filter(Boolean);
        if (nonEmpty.length) {
          await sub.selectOption(nonEmpty[0]);
          await saveGoods(page, subject);
          await clearToast(page);
          await openGoods(page, subject);
          await edTab(page, "main");
          expect(await sub.inputValue()).toBe(nonEmpty[0]);
          await sub.selectOption("");
        }
      }

      // SEO: a thousand characters, a script tag, an emoji — maxlength is the
      // only guard the form has, so check it actually holds.
      await edTab(page, "seo");
      await page.locator("[data-edseot]").fill(LONG);
      expect((await page.locator("[data-edseot]").inputValue()).length).toBeLessThanOrEqual(70);
      await page.locator("[data-edseod]").fill(LONG);
      expect((await page.locator("[data-edseod]").inputValue()).length).toBeLessThanOrEqual(170);
      await page.locator("[data-edseot]").fill(`SEO ${HTML_BOMB}`.slice(0, 70));
      await page.locator("[data-edseod]").fill(`${EMOJI} описание`);

      // Descriptions: whatever is pasted here is printed on the product page.
      // One language at a time — the segmented control is the only thing that
      // decides which of the three boxes is on screen.
      await edTab(page, "desc");
      await page.locator("[data-eddescru]").fill(`Описание ${HTML_BOMB}`);
      await page.locator('[data-eddesclang="et"]').click();
      await page.locator("[data-eddescet]").fill(EMOJI);
      await page.locator('[data-eddesclang="en"]').click();
      await page.locator("[data-eddescen]").fill(LONG);
      await page.locator('[data-eddesclang="ru"]').click();
      // the AI buttons the owner writes with are on this tab and reachable
      await expect(page.locator(`[data-admdescgen="${subject}"]`)).toBeVisible();
      await expect(page.locator(`[data-admtranslate="${subject}"]`)).toBeVisible();

      // A link that is not a video must be refused — the shop silently drops
      // anything it cannot turn into an embed, so «saved» would be a lie.
      await edTab(page, "media");
      for (const badUrl of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "not a url"]) {
        await page.locator("[data-edvideo]").fill(badUrl);
        await saveGoods(page, subject);
        await expect(goodsErr(page), `video "${badUrl}" was accepted`).toBeVisible();
        const msg = (await goodsErr(page).textContent() || "").trim();
        expect(isRussian(msg), `video "${badUrl}": message is not Russian — "${msg}"`).toBe(true);
        await assertClean(page, w, `goods video "${badUrl}"`);
      }
      await page.locator("[data-edvideo]").fill(GOOD_VIDEO);
      await saveGoods(page, subject);
      expect(await toastText(page)).toMatch(/Сохранено/);
      await clearToast(page);
      await assertClean(page, w, "goods text matrix saved");

      // The editor fires one PUT per changed field and does not wait for any
      // of them (srvPush → .catch(noop)); the storefront reads /api/overrides/
      // exactly once, on load. Wait for the public feed to actually carry the
      // new text before opening the page that reads it — otherwise this is a
      // race, not a test.
      await expect.poll(async () => {
        const body = await (await page.request.get("/api/overrides/")).json();
        return JSON.stringify((body.overrides || {})[subject] || {});
      }, { timeout: 15_000, message: "the overrides feed never carried the saved description" })
        .toContain("Описание");

      // ---- what a shopper actually gets ------------------------------------
      const shop = await freshShop(browser);
      await shop.page.goto(shopUrl("", `/p/${subject}/`));
      await waitForScreen(shop.page, "product");
      await expect(shop.page.locator("[data-price]")).toHaveText(eur(7, "RU"));
      // The pasted script is text inside a paragraph, not a tag in the DOM.
      await expect(shop.page.locator(".pdp")).toContainText("Описание <script>");
      expect(await shop.page.locator(".pdp script").count(), "the product page ran the owner's paste").toBe(0);
      expect(await shop.page.locator("img[onerror]").count()).toBe(0);
      // The YouTube link became a real embed, and no javascript: URL survived.
      await expect(shop.page.locator(".pvideo")).toBeVisible();
      const hrefs = await shop.page.locator("a[href], iframe[src]").evaluateAll((els) =>
        els.map((e) => e.getAttribute("href") || e.getAttribute("src") || ""));
      expect(hrefs.filter((h) => /^\s*(javascript|data|vbscript):/i.test(h))).toEqual([]);
      await assertClean(shop.page, shop.w, "product page after the goods fuzz");
      await shop.close();

      // ---- put the text back through the same UI ---------------------------
      await openGoods(page, subject);
      await edTab(page, "seo");
      await page.locator("[data-edseot]").fill("");
      await page.locator("[data-edseod]").fill("");
      await edTab(page, "desc");
      await page.locator("[data-eddescru]").fill("");
      await page.locator('[data-eddesclang="et"]').click();
      await page.locator("[data-eddescet]").fill("");
      await page.locator('[data-eddesclang="en"]').click();
      await page.locator("[data-eddescen]").fill("");
      await edTab(page, "media");
      await page.locator("[data-edvideo]").fill("");
      await saveGoods(page, subject);
      await clearToast(page);
      await openGoods(page, subject);
      await edTab(page, "seo");
      expect(await page.locator("[data-edseot]").inputValue(), "an SEO override cannot be cleared from the editor").toBe("");
      await edTab(page, "desc");
      expect(await page.locator("[data-eddescru]").inputValue()).toBe("");
      await edTab(page, "media");
      expect(await page.locator("[data-edvideo]").inputValue()).toBe("");
      await assertClean(page, w, "goods overrides cleared");
    } finally {
      // Prices and stock back to the catalogue's own values, through the
      // editor rather than a side-door API call — same rule as admin.spec.ts.
      for (const r of restore) {
        await openGoods(page, r.id);
        await page.locator("[data-edprice]").fill(r.price);
        await page.locator("[data-edproprice]").fill("");
        await edTab(page, "main");
        await page.locator("[data-edstock]").selectOption(r.stock);
        await saveGoods(page, r.id);
        await clearToast(page);
      }
    }
  });
});

/**
 * «Сохранить» on the tariff grid. A delivery price is money a stranger is
 * charged, so since the phase-3 redesign it goes through the confirm card like
 * shipping an order does (README § State) — two clicks, not one.
 */
async function saveTariffs(page: Page): Promise<void> {
  await page.locator("[data-admshipsave]").click();
  await expect(page.locator("[data-admapply]")).toBeVisible();
  await page.locator("[data-admapply]").click();
}

test.describe("sweep — delivery prices", () => {
  test.use({ extraHTTPHeaders: ipHeaders(158) });

  test("garbage never reaches the table, the Montonio fill never undercuts, the checkout bills what is shown", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    await openAdmin(page);
    await openSettings(page, "delivery");

    const before = await (await page.request.get("/api/admin/settings/")).json();
    const originalRules = before.settings.shipping_rules ?? null;

    try {
      const parcelEE = page.locator('[data-shiprule="m:parcel:EE"]');
      await expect(parcelEE).toBeVisible();

      // Garbage: whatever the panel does with it, the saved table must never
      // end up with a negative or absurd price — that is a number a stranger
      // is charged at checkout.
      for (const bad of ["-5", "abc", "999999", "1e9"]) {
        await parcelEE.fill(bad);
        await saveTariffs(page);
        await clearToast(page);
        const now = await (await page.request.get("/api/admin/settings/")).json();
        const value = now.settings.shipping_rules?.methods?.parcel?.EE;
        if (value != null) {
          expect(Number(value), `"${bad}" was stored as a delivery price`).toBeGreaterThanOrEqual(0);
          expect(Number(value), `"${bad}" was stored as a delivery price`).toBeLessThanOrEqual(99);
        }
        await assertClean(page, w, `shipping parcel EE = "${bad}"`);
      }

      // Comma decimals are how the owner writes money.
      await parcelEE.fill("4,20");
      // Courier, not parcel, is the one the checkout assertion below reads:
      // a parcel price can be overridden per carrier (shipPriceFor()), a
      // courier price never is, so this is the number the shopper must see.
      await page.locator('[data-shiprule="m:courier:EE"]').fill("13,37");
      await saveTariffs(page);
      expect(await toastText(page)).toMatch(/[Тт]ариф/);
      await clearToast(page);
      let now = await (await page.request.get("/api/admin/settings/")).json();
      expect(Number(now.settings.shipping_rules.methods.parcel.EE), "«4,20» was not read as 4.20").toBeCloseTo(4.2, 2);
      expect(Number(now.settings.shipping_rules.methods.courier.EE)).toBeCloseTo(13.37, 2);
      await assertClean(page, w, "shipping table saved");

      // What the table says is what the checkout charges.
      const shop = await freshShop(browser);
      await shop.page.goto(shopUrl("", `/p/${PRODUCT_2.id}/`));
      await waitForScreen(shop.page, "product");
      await shop.page.locator(`.pdp__add[data-add="${PRODUCT_2.id}"]`).click();
      await expect(shop.page.getByRole("status")).toBeVisible();
      await shop.page.goto(shopUrl("", "/checkout/"));
      await waitForScreen(shop.page, "checkout");
      await shop.page.locator("[data-email]").fill(freshEmail("sweep-ship"));
      await continueButton(shop.page, 2).click();
      const courierOpt = shop.page.locator("label.opt", { has: shop.page.locator('input[data-dm="courier"]') });
      await expect(courierOpt.locator(".opt__price"), "the checkout is not quoting the table's own price")
        .toHaveText(eur(13.37, "RU"));
      await assertClean(shop.page, shop.w, "checkout with the edited delivery price");
      await shop.close();

      // «Заполнить по тарифам Montonio» must only ever raise a price to cost —
      // never quietly undercut a price the owner set above it on purpose.
      await page.locator("[data-admshipfill]").click();
      await clearToast(page);
      await saveTariffs(page);
      await clearToast(page);
      now = await (await page.request.get("/api/admin/settings/")).json();
      expect(Number(now.settings.shipping_rules.methods.parcel.EE),
        "the Montonio fill undercut the price already in the table").toBeGreaterThanOrEqual(4.2);
      expect(Number(now.settings.shipping_rules.methods.courier.EE),
        "the Montonio fill undercut the price already in the table").toBeGreaterThanOrEqual(13.37);
      await assertClean(page, w, "montonio fill");

      // An emptied cell removes the override rather than storing a blank.
      await page.locator('[data-shiprule="m:courier:LV"]').fill("");
      await saveTariffs(page);
      await clearToast(page);
      await assertClean(page, w, "shipping cell emptied");
    } finally {
      await page.request.put("/api/admin/settings/", { data: { shipping_rules: originalRules ?? {} } });
    }
  });
});

test.describe("sweep — promo codes", () => {
  test.use({ extraHTTPHeaders: ipHeaders(159) });

  test("odd codes, impossible percentages and an expired code all behave at the checkout", async ({ page, context }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    // This test posts promo codes the server is *supposed* to refuse, and
    // Chromium logs each 400 as a console error of its own; what matters —
    // that the form told the owner why — is asserted directly below.
    w.allow.push(/\/api\/admin\/promos\//);
    await openAdmin(page);
    await tab(page, "promos");

    const stamp = Date.now().toString().slice(-6);
    const good = `SWEEP${stamp}`;

    // A code typed the way a human types it: lowercase, spaces, a Cyrillic
    // slip. The field is supposed to normalise it in front of the owner.
    await page.locator("[data-admpromonew]").click();
    await page.locator('[data-promof="code"]').fill(` sweep${stamp} тест `);
    const shown = await page.locator('[data-promof="code"]').inputValue();
    expect(shown, "the code field kept characters a promo code cannot contain").toMatch(/^[A-Z0-9-]*$/);
    expect(shown).toContain(`SWEEP${stamp}`);

    // Percentages the server refuses (docs: 1–90). Every one must come back
    // as a sentence in the form, never as a saved code or a dead button.
    // the kind is a chip row since the phase-3 redesign, not a radio list
    await page.locator('[data-promokind="percent"]').click();
    for (const bad of ["0", "100", "150", "-10", "abc"]) {
      await page.locator('[data-promof="value"]').fill(bad);
      await page.locator("[data-admpromosave]").click();
      // the form is adm- markup since the phase-3 redesign
      const err = page.locator(".adm-err[role=alert]");
      await expect(err, `percent "${bad}" was accepted`).toBeVisible();
      expect(isRussian((await err.textContent()) || ""), `percent "${bad}" message is not Russian`).toBe(true);
      await assertClean(page, w, `promo percent "${bad}"`);
    }

    // Minimum-order garbage falls back to «no condition» rather than NaN.
    await page.locator('[data-promof="value"]').fill("10");
    await page.locator('[data-promof="minSubtotal"]').fill("abc");
    await page.locator('[data-promof="code"]').fill(good);
    await page.locator("[data-admpromosave]").click();
    expect(await toastText(page)).toMatch(/[Пп]ромокод/);
    await clearToast(page);
    /* Scoped to the row's own name, not the page: since the switches say «Вкл»
       / «Выкл», each one also carries its clipped accessible name («Промокод
       SUMMER»), so a bare getByText(code) now matches two nodes. */
    await expect(page.locator(`[data-admpromoedit="${good}"] .adm-row__nm`)).toHaveText(good);
    await assertClean(page, w, "promo created");

    // An expired code saves (a shop keeps its history) but must not discount.
    const expired = `OLD${stamp}`;
    await page.locator("[data-admpromonew]").click();
    await page.locator('[data-promof="code"]').fill(expired);
    // the kind is a chip row since the phase-3 redesign, not a radio list
    await page.locator('[data-promokind="percent"]').click();
    await page.locator('[data-promof="value"]').fill("50");
    // the rarer conditions sit in a fold-out under the four fields the spec asks for
    await page.locator("[data-promomore]").click();
    await page.locator('[data-promof="endsAt"]').fill("2020-01-01");
    await page.locator("[data-admpromosave]").click();
    await clearToast(page);
    await assertClean(page, w, "expired promo created");

    // ---- the checkout is the only place any of this matters ---------------
    const shopper = await context.newPage();
    const sw = watch(shopper);
    // POST /api/promos/check answers 400 for a code that does not exist or
    // has expired — the refusals this test is here to provoke. The message
    // the shopper reads is asserted below; Chromium's own log line is not
    // the shop's doing.
    sw.allow.push(/\/api\/promos\/check\//);
    await shopper.goto(shopUrl("", `/p/${PRODUCT_2.id}/`));
    await waitForScreen(shopper, "product");
    await shopper.locator(`.pdp__add[data-add="${PRODUCT_2.id}"]`).click();
    await expect(shopper.getByRole("status")).toBeVisible();
    await shopper.goto(shopUrl("", "/checkout/"));
    await waitForScreen(shopper, "checkout");
    await shopper.locator("[data-email]").fill(freshEmail("sweep-promo"));
    await continueButton(shopper, 2).click();

    // Lower case, with spaces around it — the same code the owner made.
    await shopper.locator("[data-promo]").fill(`  ${good.toLowerCase()}  `);
    await shopper.locator("[data-applypromo]").click();
    await expect(shopper.locator("[data-promooff]"), "a valid code failed when typed in lower case").toBeVisible();
    await assertClean(shopper, sw, "checkout accepted the code");

    for (const bad of [expired, "НЕТТАКОГО", "'; DROP TABLE promo_codes; --"]) {
      await shopper.locator("[data-promo]").fill(bad);
      await shopper.locator("[data-applypromo]").click();
      // summaryBlockHTML() puts the refusal in its own alert inside the order
      // summary; the discount row would only exist if the code had worked.
      const err = shopper.locator('.cosum__body > .err[role="alert"]');
      await expect(err, `"${bad}" was accepted at the checkout`).toBeVisible();
      expect(isRussian((await err.textContent()) || ""), `"${bad}": message is not Russian`).toBe(true);
      await expect(shopper.locator("[data-promooff]")).toHaveCount(0);
      await assertClean(shopper, sw, `checkout refused "${bad}"`);
    }

    // Switching a code off has to reach the checkout too.
    await page.locator(`[data-admpromotoggle="${good}"]`).click();
    await clearToast(page);
    // the row carries a switch since the phase-3 redesign, not a link whose label flips
    await expect(page.locator(`[data-admpromotoggle="${good}"]`)).toHaveAttribute("aria-checked", "false");
    await shopper.locator("[data-promo]").fill(good);
    await shopper.locator("[data-applypromo]").click();
    await expect(shopper.locator("[data-promooff]"), "a disabled code still discounted the basket").toHaveCount(0);
    await assertClean(shopper, sw, "checkout refused the disabled code");
    await shopper.close();

    // Leave nothing switched on behind us — there is no DELETE for promos by
    // design (src/app/api/admin/promos), so «выключен» is the clean-up.
    await page.locator(`[data-admpromotoggle="${expired}"]`).click();
    await clearToast(page);
    await assertClean(page, w, "promos left disabled");
  });
});

/**
 * media: the two video shapes that are not a YouTube link.
 *
 * An Instagram reel has no poster address anyone can fetch without an API
 * key, so — unlike YouTube and Vimeo — its frame is in the page from the
 * start with loading="lazy" and a plain link underneath. That difference is
 * what this test pins: the embed address is built from the id (never from the
 * pasted string), and both the frame and the fallback are really there.
 *
 * PRODUCT_2 rather than one of the sweep's own five: the sample above
 * excludes it on purpose, and the field is put back empty in `finally`.
 */
test.describe("sweep — goods editor: Instagram video", () => {
  test.use({ extraHTTPHeaders: ipHeaders(160) });

  const REEL_ID = "C8xYzAbCdEf";
  const REEL = `https://www.instagram.com/reel/${REEL_ID}/`;

  test("an Instagram reel saved in the editor becomes a real embed on the product page", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    await openAdmin(page);
    const id = PRODUCT_2.id;

    try {
      await openGoods(page, id);
      await edTab(page, "media");
      // the source chips are the design's door to the same one field: pick
      // Instagram and the field's placeholder changes, the value does not
      await page.locator('[data-edvidkind="ig"]').click();
      await expect(page.locator('[data-edvidkind="ig"][aria-current="true"]')).toBeVisible();

      // An Instagram address that is not a reel or a post is still not a
      // video, and the refusal has to be readable.
      await page.locator("[data-edvideo]").fill("https://www.instagram.com/rempire.tallinn/");
      await saveGoods(page, id);
      await expect(goodsErr(page), "an Instagram profile link was accepted as a video").toBeVisible();
      expect(isRussian((await goodsErr(page).textContent()) || "")).toBe(true);
      await assertClean(page, w, "instagram profile link refused");

      await page.locator("[data-edvideo]").fill(REEL);
      await saveGoods(page, id);
      expect(await toastText(page)).toMatch(/Сохранено/);
      await clearToast(page);
      await assertClean(page, w, "instagram reel saved");

      // The editor writes through without waiting and the storefront reads
      // /api/overrides/ once, on load — so wait for the feed to carry it
      // rather than racing it.
      await expect.poll(async () => {
        const body = await (await page.request.get("/api/overrides/")).json();
        return ((body.overrides || {})[id] || {}).videoUrl || "";
      }, { timeout: 15_000, message: "the overrides feed never carried the video link" }).toBe(REEL);

      const shop = await freshShop(browser);
      // instagram.com is unreachable from a test machine, and Chromium logs
      // the frame's failed navigation as a console error. The assertion that
      // matters is the markup, checked right below.
      shop.w.allow.push(/instagram\.com/i);
      await shop.page.goto(shopUrl("", `/p/${id}/`));
      await waitForScreen(shop.page, "product");

      const frame = shop.page.locator(".pvideo--ig iframe");
      await expect(frame).toHaveCount(1);
      await expect(frame).toHaveAttribute("src", `https://www.instagram.com/reel/${REEL_ID}/embed/`);
      await expect(frame).toHaveAttribute("loading", "lazy");
      // and the fallback, for a browser or an extension that blocks the embed
      await expect(shop.page.locator(`.pvideo--ig a[href="${REEL}"]`)).toBeVisible();
      // nothing else on the page picked up a hostile scheme along the way
      const hrefs = await shop.page.locator("a[href], iframe[src], video[src]").evaluateAll((els) =>
        els.map((e) => e.getAttribute("href") || e.getAttribute("src") || ""));
      expect(hrefs.filter((h) => /^\s*(javascript|data|vbscript):/i.test(h))).toEqual([]);
      /* Instagram's own embed script throws inside its own frame on a machine
         with no Instagram session («requireLazy is not defined»). That is
         their code in their document, reported on our page object because a
         frame's uncaught errors surface there — drop exactly those and hold
         everything else on the page to the sweep's usual standard. */
      shop.w.pageErrors = shop.w.pageErrors.filter((e) => !/instagram\.com/i.test(e));
      await assertClean(shop.page, shop.w, "product page with an Instagram embed");
      await shop.close();
    } finally {
      await openGoods(page, id);
      await edTab(page, "media");
      await page.locator("[data-edvideo]").fill("");
      await saveGoods(page, id);
      await clearToast(page);
    }
  });
});
