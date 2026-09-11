import { expect, type Page, test } from "@playwright/test";
import { eur, ipHeaders, PRODUCT_2, shopUrl, waitForScreen } from "./fixtures";
import { assertClean, clearToast, freshShop, openAdmin, tab, toastText, watch } from "./sweep-helpers";

/**
 * «Товар» — the redesigned product editor (phase 2 of the admin redesign,
 * docs/design/admin-handoff-README.md § «Товар (editor)»).
 *
 * The shape this spec pins is the one the design changed: five tabs over ONE
 * form with a sticky save bar under all of them. Every pane is in the DOM at
 * once and the inactive ones carry `hidden` — that is not decoration, it is
 * the reason a half-typed «Описание» survives a look at «Google»: the editor
 * keeps no draft in S and reads every field off the DOM when «Сохранить» is
 * pressed (goodsEditor()/[data-admsavegoods] in app.js).
 *
 * What is checked end to end, because it is what the owner is actually doing:
 *   · a size price and a salon price typed on «Размеры и цены» reach the shop;
 *   · a stock number typed in the same grid reaches «Склад» (it travels as a
 *     relative move on the inventory API, like the ± stepper does);
 *   · a barcode typed in the same grid binds to that size;
 *   · the photo grid tags its first picture «главное»;
 *   · a video link round-trips;
 *   · the destructive slot goes through the confirm card.
 *
 * PRODUCT_2, not PRODUCT: this spec counts a shelf and moves a price, and
 * fixtures.ts reserves PRODUCT for the specs that must never see either.
 * Everything it changes is put back in `finally`.
 */

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop" && testInfo.project.name !== "mobile",
    "product editor — desktop and mobile only, see docs/testing.md");
});

type EdTab = "main" | "sizes" | "media" | "desc" | "seo";
async function edTab(page: Page, key: EdTab): Promise<void> {
  await page.locator(`[data-edtab="${key}"]`).click();
  await expect(page.locator(`[data-edtab="${key}"][aria-current="true"]`)).toBeVisible();
}

async function openEditor(page: Page, id: string): Promise<void> {
  await tab(page, "goods");
  await page.locator("[data-goodsq]").fill(id);
  await page.locator(`[data-admgoods="${id}"]`).click();
  await expect(page.locator("[data-admsavegoods]")).toBeVisible();
}

/** The count the warehouse actually holds — read from the route the panel
 *  itself reads. `null` while the row is still untracked. */
async function stockQty(page: Page, productId: string, variant: string): Promise<number | null> {
  const res = await page.request.get(`/api/admin/inventory/?filter=all&q=${encodeURIComponent(productId)}`);
  const rows = (await res.json()).levels as Array<{ productId: string; variant: string; tracked: boolean; qty: number; ean: string | null }>;
  const row = rows.find((r) => r.productId === productId && (r.variant || "") === variant);
  return row && row.tracked ? row.qty : null;
}
async function stockEan(page: Page, productId: string, variant: string): Promise<string> {
  const res = await page.request.get(`/api/admin/inventory/?filter=all&q=${encodeURIComponent(productId)}`);
  const rows = (await res.json()).levels as Array<{ productId: string; variant: string; ean: string | null }>;
  const row = rows.find((r) => r.productId === productId && (r.variant || "") === variant);
  return (row && row.ean) || "";
}

test.describe("admin — the product editor", () => {
  test.use({ extraHTTPHeaders: ipHeaders(171) });

  test("five tabs, one sticky save bar, and what is typed reaches the shop and the warehouse", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    const id = PRODUCT_2.id;
    const VARIANT = "40 мл";
    let priceWas = "";

    await openAdmin(page);
    await openEditor(page, id);

    // ---- the frame ---------------------------------------------------------
    // «← Товары», the kicker, the title and the way out to the shop
    await expect(page.locator("[data-admclose]").first()).toHaveText("← Товары");
    await expect(page.locator(".adm-head__kicker")).toContainText(PRODUCT_2.brand);
    await expect(page.locator(`[data-go-product="${id}"]`)).toHaveText("Открыть в магазине ↗");

    // Five tabs, and the save bar under every one of them.
    const TABS: Array<[EdTab, string]> = [
      ["main", "Основное"], ["sizes", "Размеры и цены"], ["media", "Фото и видео"],
      ["desc", "Описание"], ["seo", "Google"],
    ];
    for (const [key, label] of TABS) {
      await expect(page.locator(`[data-edtab="${key}"]`), `the «${label}» tab is missing`).toHaveText(label);
      await edTab(page, key);
      await expect(page.locator(`[data-edpane="${key}"]`), `«${label}» did not open`).toBeVisible();
      await expect(page.locator(`[data-admsavegoods="${id}"]`), `no save bar on «${label}»`).toBeVisible();
      await expect(page.locator("[data-admgoodspull]"), `no destructive action on «${label}»`).toBeVisible();
    }
    await assertClean(page, w, "editor tabs");

    // A tab is a DOM patch, not a rebuild: what was typed on one pane is still
    // there after a look at another. This is the whole reason the panes stay
    // mounted, so it is worth one assertion of its own.
    await edTab(page, "seo");
    await page.locator("[data-edseot]").fill("Черновик заголовка");
    await edTab(page, "main");
    await edTab(page, "seo");
    expect(await page.locator("[data-edseot]").inputValue(),
      "switching tabs threw away what was typed").toBe("Черновик заголовка");
    await page.locator("[data-edseot]").fill("");

    // ---- what the catalogue owns is read-only, and says so -----------------
    await edTab(page, "main");
    await expect(page.locator('[data-edpane="main"] input[readonly]').first()).toBeVisible();
    await expect(page.locator('[data-edpane="main"]')).toContainText("приходят из каталога");

    try {
      // ---- Размеры и цены: price, salon price, stock, barcode ---------------
      await edTab(page, "sizes");
      priceWas = await page.locator("[data-edprice]").inputValue();
      const stockWas = (await stockQty(page, id, VARIANT)) ?? 0;
      const eanWas = await stockEan(page, id, VARIANT);
      const ean = `28${Date.now().toString().slice(-10)}`;

      // The salon column follows the price until the owner says otherwise —
      // «auto = price × 0.8» in the design, the shop's own discount here.
      await page.locator("[data-edprice]").fill("20");
      const auto = Number(await page.locator("[data-edproprice]").inputValue());
      expect(auto, "the salon price did not follow the retail one").toBeGreaterThan(0);
      expect(auto, "the salon price is not below the retail one").toBeLessThan(20);

      // …and stops following the moment a salon price is typed by hand.
      await page.locator("[data-edproprice]").fill("11");
      await page.locator("[data-edprice]").fill("19");
      expect(await page.locator("[data-edproprice]").inputValue(),
        "a deliberate salon price was overwritten by a retail edit").toBe("11");

      // Остаток and Штрихкод are the warehouse, in the same grid.
      await page.locator(`[data-edqty="${id} ${VARIANT}"]`).fill(String(stockWas + 7));
      await page.locator(`[data-edean="${id} ${VARIANT}"]`).fill(ean);

      // One button saves the whole form, from whichever tab it is pressed.
      await page.locator(`[data-admsavegoods="${id}"]`).click();
      expect(await toastText(page)).toMatch(/Сохранено/);
      await clearToast(page);
      await assertClean(page, w, "editor saved price + salon + stock + ean");

      // ---- …and all four of them landed -------------------------------------
      await expect.poll(async () => stockQty(page, id, VARIANT),
        { timeout: 15_000, message: "the stock typed in the editor never reached the warehouse" })
        .toBe(stockWas + 7);
      await expect.poll(async () => stockEan(page, id, VARIANT),
        { timeout: 15_000, message: "the barcode typed in the editor never bound" }).toBe(ean);

      // «Склад» shows the same two numbers — it is the same rows.
      await tab(page, "stock");
      await page.locator("[data-stockq]").fill(ean);
      const row = page.locator(`[data-stockedit="${id} ${VARIANT}"]`).locator("xpath=..");
      await expect(row, "«Склад» does not show the barcode the editor bound").toContainText(ean);
      await expect(row, "«Склад» does not show the count the editor set").toContainText(String(stockWas + 7));
      await assertClean(page, w, "«Склад» agrees with the editor");

      // The storefront charges what the editor says.
      await expect.poll(async () => {
        const body = await (await page.request.get("/api/overrides/")).json();
        return Number(((body.overrides || {})[id] || {}).price);
      }, { timeout: 15_000, message: "the overrides feed never carried the new price" }).toBe(19);
      const shop = await freshShop(browser);
      await shop.page.goto(shopUrl("", `/p/${id}/`));
      await waitForScreen(shop.page, "product");
      await expect(shop.page.locator("[data-price]")).toHaveText(eur(19, "RU"));
      await assertClean(shop.page, shop.w, "product page after the editor");
      await shop.close();

      // ---- Фото и видео ------------------------------------------------------
      await openEditor(page, id);
      await edTab(page, "media");
      // the first photo is the main one and wears the tag that says so
      await expect(page.locator(".adm-photo__tag--ink").first()).toHaveText("главное");
      await expect(page.locator(`[data-galup="${id}"]`), "no «+ Фото с телефона»").toBeVisible();
      // the three video sources, one field behind them
      for (const kind of ["yt", "ig", "up"]) {
        await expect(page.locator(`[data-edvidkind="${kind}"]`)).toBeVisible();
      }
      await page.locator("[data-edvideo]").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      await page.locator(`[data-admsavegoods="${id}"]`).click();
      await clearToast(page);
      await openEditor(page, id);
      await edTab(page, "media");
      expect(await page.locator("[data-edvideo]").inputValue(), "the video link did not round-trip")
        .toContain("dQw4w9WgXcQ");
      await assertClean(page, w, "editor media tab");

      // ---- Описание: the language control and the AI buttons ------------------
      await edTab(page, "desc");
      await expect(page.locator("[data-eddescru]")).toBeVisible();
      await page.locator('[data-eddesclang="et"]').click();
      await expect(page.locator("[data-eddescet]"), "the Estonian box did not open").toBeVisible();
      await expect(page.locator("[data-eddescru]"), "two languages were on screen at once").toBeHidden();
      await page.locator('[data-eddesclang="ru"]').click();
      await expect(page.locator(`[data-admdescgen="${id}"]`)).toHaveText("Написать черновик");
      await expect(page.locator(`[data-admtranslate="${id}"]`)).toHaveText("Перевести с русского");
      await assertClean(page, w, "editor description tab");

      // ---- the destructive slot goes through the confirm card ----------------
      await page.locator("[data-admgoodspull]").click();
      const card = page.locator(".adm-confirm");
      await expect(card, "«Снять с продажи» skipped the confirm card").toBeVisible();
      await expect(card).toContainText("Снять с продажи?");
      // …and «Отмена» really cancels
      await page.locator("[data-admcancel]").click();
      await expect(card).toHaveCount(0);
      await expect(page.locator("[data-admsavegoods]"), "cancelling the card closed the editor").toBeVisible();

      await page.locator("[data-admgoodspull]").click();
      await page.locator("[data-admapply]").click();
      expect(await toastText(page)).toMatch(/Снято с продажи/);
      // the undo the toast offers is the safety net the README asks for
      await expect(page.locator(".adm-toast__undo")).toBeVisible();
      await page.locator(".adm-toast__undo").click();
      await expect(page.getByRole("status")).toContainText("Отменено");
      await clearToast(page);
      await assertClean(page, w, "«Снять с продажи» and its undo");

      // the product is on sale again — which is what the undo promised
      await openEditor(page, id);
      await edTab(page, "main");
      expect(await page.locator("[data-edstock]").inputValue(),
        "the undo did not put the product back on sale").not.toBe("out");
    } finally {
      // Price back to the catalogue's own, the salon override cleared, and the
      // shelf left well stocked — every other spec that buys this product
      // decrements the same count (fixtures.ts, PRODUCT_2).
      await openEditor(page, id);
      await edTab(page, "sizes");
      if (priceWas) await page.locator("[data-edprice]").fill(priceWas);
      await page.locator("[data-edproprice]").fill("");
      await page.locator(`[data-edqty="${PRODUCT_2.id} ${VARIANT}"]`).fill("500");
      await edTab(page, "media");
      await page.locator("[data-edvideo]").fill("");
      await edTab(page, "main");
      await page.locator("[data-edstock]").selectOption("in");
      await page.locator(`[data-admsavegoods="${id}"]`).click();
      await clearToast(page);
    }
  });

  /**
   * «Google»: one title/description pair per language behind the same
   * segmented control «Описание» has. What is pinned: the AI button fills the
   * language that is on screen (it used to send Russian whatever was shown),
   * «все три языка» fills all three, what is saved comes back per language,
   * and the shop's own <title> reads the page's language with the Russian
   * pair as the fallback. The model is stubbed at the network edge — this
   * checks what the panel asks for and where the answer lands, not OpenAI.
   */
  test("Google tab: one pair per language, the AI fills the language shown, the shop reads the right one", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    const id = PRODUCT_2.id;
    const asked: string[] = [];
    await page.route("**/api/admin/ai/text/", async (route) => {
      const body = route.request().postDataJSON() as { task: string; lang: string };
      asked.push(`${body.task}:${body.lang}`);
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, text: { title: `Title ${body.lang}`, description: `Snippet ${body.lang}` } }),
      });
    });

    await openAdmin(page);
    await openEditor(page, id);
    await edTab(page, "seo");

    // Russian first, the other two behind the control — one language on screen
    await expect(page.locator('[data-edseolang="ru"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator("[data-edseot]")).toBeVisible();
    await expect(page.locator("[data-edseotet]")).toBeHidden();
    await page.locator('[data-edseolang="et"]').click();
    await expect(page.locator("[data-edseotet]")).toBeVisible();
    await expect(page.locator("[data-edseot]")).toBeHidden();

    // the AI button asks for the language that is on screen, and only that pair moves
    await page.locator(`[data-admseogen="${id}"]`).click();
    await expect(page.locator("[data-edseotet]")).toHaveValue("Title ET");
    await expect(page.locator("[data-edseodet]")).toHaveValue("Snippet ET");
    expect(asked).toEqual(["seo:ET"]);
    expect(await page.locator("[data-edseot]").inputValue(), "the Russian pair was written over").toBe("");
    await clearToast(page);

    // «все три языка»: three questions, three pairs
    await page.locator(`[data-admseoall="${id}"]`).click();
    await expect(page.locator("[data-edseoten]")).toHaveValue("Title EN");
    await expect(page.locator("[data-edseot]")).toHaveValue("Title RU");
    expect(asked.slice(1).sort()).toEqual(["seo:EN", "seo:ET", "seo:RU"]);
    await clearToast(page);
    await assertClean(page, w, "Google tab AI fill");

    try {
      // the owner's own words: Russian and Estonian, English left empty
      await page.locator('[data-edseolang="ru"]').click();
      await page.locator("[data-edseot]").fill("Русский заголовок для Google");
      await page.locator("[data-edseod]").fill("Русское описание");
      await page.locator('[data-edseolang="et"]').click();
      await page.locator("[data-edseotet]").fill("Eesti pealkiri Google'ile");
      await page.locator("[data-edseodet]").fill("");
      await page.locator('[data-edseolang="en"]').click();
      await page.locator("[data-edseoten]").fill("");
      await page.locator("[data-edseoden]").fill("");
      await page.locator(`[data-admsavegoods="${id}"]`).click();
      expect(await toastText(page)).toMatch(/Сохранено/);
      await clearToast(page);
      await assertClean(page, w, "Google tab saved");

      // the public feed carries the set per language, the Russian pair in the legacy fields too
      await expect.poll(async () => {
        const body = await (await page.request.get("/api/overrides/")).json();
        return ((body.overrides || {})[id] || {}).seo || null;
      }, { timeout: 15_000, message: "the overrides feed never carried the per-language pairs" })
        .toEqual({ RU: { title: "Русский заголовок для Google", desc: "Русское описание" }, ET: { title: "Eesti pealkiri Google'ile" } });
      const feed = await (await page.request.get("/api/overrides/")).json();
      expect(feed.overrides[id].seoTitle).toBe("Русский заголовок для Google");

      // …and the editor shows each pair where it belongs
      await openEditor(page, id);
      await edTab(page, "seo");
      expect(await page.locator("[data-edseot]").inputValue()).toBe("Русский заголовок для Google");
      await page.locator('[data-edseolang="et"]').click();
      expect(await page.locator("[data-edseotet]").inputValue()).toBe("Eesti pealkiri Google'ile");
      await page.locator('[data-edseolang="en"]').click();
      expect(await page.locator("[data-edseoten]").inputValue()).toBe("");

      // the shop: the Estonian page reads its own title, the English one — with
      // nothing of its own — the Russian pair, and the Russian page its own
      const shop = await freshShop(browser);
      await shop.page.goto(shopUrl("/et", `/p/${id}/`));
      await waitForScreen(shop.page, "product");
      await expect(shop.page).toHaveTitle(/Eesti pealkiri Google'ile/);
      await shop.page.goto(shopUrl("/en", `/p/${id}/`));
      await waitForScreen(shop.page, "product");
      await expect(shop.page).toHaveTitle(/Русский заголовок для Google/);
      expect(await shop.page.locator('meta[name="description"]').getAttribute("content")).toBe("Русское описание");
      await shop.page.goto(shopUrl("", `/p/${id}/`));
      await waitForScreen(shop.page, "product");
      await expect(shop.page).toHaveTitle(/Русский заголовок для Google/);
      await assertClean(shop.page, shop.w, "product page titles per language");
      await shop.close();
    } finally {
      // every pair emptied = the override is gone, not stored as blanks
      await openEditor(page, id);
      await edTab(page, "seo");
      for (const [lang, t, d] of [["ru", "[data-edseot]", "[data-edseod]"], ["et", "[data-edseotet]", "[data-edseodet]"], ["en", "[data-edseoten]", "[data-edseoden]"]]) {
        await page.locator(`[data-edseolang="${lang}"]`).click();
        await page.locator(t).fill("");
        await page.locator(d).fill("");
      }
      await page.locator(`[data-admsavegoods="${id}"]`).click();
      await clearToast(page);
      await expect.poll(async () => {
        const body = await (await page.request.get("/api/overrides/")).json();
        return ((body.overrides || {})[id] || {}).seo || null;
      }, { timeout: 15_000 }).toBeNull();
    }
  });

  /**
   * The phone. Renat tested the editor on a Samsung S21 FE (10.09.2026) and
   * sent a screenshot: «Сохранить» and «Отмена» half under the bottom nav,
   * the assistant's black square on the form, the photo tiles' arrows running
   * into the next tile. Then the bar that fixed that took a quarter of his
   * iPhone 14's screen — two rows on the nav — so on a phone the bar is the
   * screen's top header now (r13, Dim 11.09.2026): «Отмена · state ·
   * Сохранить», the way Notes and Contacts do it (admin.css ≤ 767), and the
   * destructive link ends the form instead. Pinned as geometry:
   *   · the bar is the first thing on the screen — at the very top, edge to
   *     edge, the panel's own header gone while it stands, its two buttons a
   *     thumb's size and below the notch inset an iPhone reports under
   *     viewport-fit=cover (index.html; the CDP emulation Chromium has for
   *     exactly this, so no real phone is needed);
   *   · the form starts under the bar, not behind it, and a field the caret
   *     jumps to lands under the bar's edge, not behind it (scroll padding);
   *   · «Снять с продажи» is the form's last row — above the nav at the end
   *     of the scroll, inset and all, never under it;
   *   · the assistant's button is off the screen (it would sit on the form);
   *   · every photo button lies inside its own row and crosses no other;
   *   · «Сканер» beside a size's barcode box fills THAT box, closes, and
   *     leaves the editor as it was — and Back closes the scanner alone.
   */
  test("phone: the save bar is the header — on top, clear of the form and the nav; photo buttons stay in their rows; «Сканер» fills the barcode box", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the phone layout — the desktop has no bottom nav");
    test.setTimeout(120_000);
    const w = watch(page);
    const id = PRODUCT_2.id;
    const VARIANT = "40 мл", OTHER = "150 мл";
    type Box = { l: number; t: number; r: number; b: number };
    const overlaps = (a: Box, b: Box) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    const inside = (a: Box, b: Box) => a.l >= b.l - 0.5 && a.r <= b.r + 0.5 && a.t >= b.t - 0.5 && a.b <= b.b + 0.5;

    await openAdmin(page);
    await openEditor(page, id);
    await edTab(page, "sizes");

    // ---- the bar as the header, the form under it, the nav under the form ---
    const header = async (label: string, inset: number, where: "top" | "mid" | "end") => {
      const r = await page.evaluate(() => {
        const box = (el: Element) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        const q = (sel: string) => box(document.querySelector(sel)!);
        const shown = (sel: string) => { const el = document.querySelector(sel); return !!el && getComputedStyle(el).display !== "none"; };
        return {
          vw: window.innerWidth, vh: window.innerHeight,
          bar: q(".adm-savebar"), nav: q(".adm-bar"), del: q("[data-admgoodspull]"), form: q(".adm-screen"),
          fabShown: shown(".adm-fab"), panelHeaderShown: shown(".cohdr--adm"),
          buttons: Array.from(document.querySelectorAll(".adm-savebar button")).map((el) => ({ name: (el.textContent || "").trim(), ...box(el) })),
        };
      });
      expect(r.nav.b, `${label}: the nav is not at the bottom of the screen`).toBe(r.vh);
      // the bar: the top edge of the screen, edge to edge, one row plus the inset — not two rows, not a nav-stacked bar
      expect(Math.abs(r.bar.t), `${label}: the bar is ${Math.round(r.bar.t)}px off the top of the screen`).toBeLessThanOrEqual(0.5);
      expect(r.bar.l, `${label}: the bar does not start at the left edge`).toBeLessThanOrEqual(0.5);
      expect(r.bar.r, `${label}: the bar does not reach the right edge`).toBeGreaterThanOrEqual(r.vw - 0.5);
      expect(r.bar.b, `${label}: the bar is shorter than its row plus the inset`).toBeGreaterThanOrEqual(52 + inset);
      expect(r.bar.b, `${label}: the bar is ${Math.round(r.bar.b)}px tall — more than one row over the inset`).toBeLessThanOrEqual(56 + inset);
      expect(r.panelHeaderShown, `${label}: the panel's own header is on the screen beside the bar`).toBe(false);
      // its buttons: «Сохранить» and «Отмена» only — the destructive link is not here — a thumb's size, under the notch
      expect(r.buttons.map((b) => b.name).sort(), `${label}: the bar's buttons`).toEqual(["Отмена", "Сохранить"]);
      for (const btn of r.buttons) {
        expect(btn.b - btn.t, `${label}: «${btn.name}» is under a thumb's size`).toBeGreaterThanOrEqual(43.5);
        expect(btn.t, `${label}: «${btn.name}» is under the notch inset`).toBeGreaterThanOrEqual(inset - 0.5);
        expect(btn.b, `${label}: «${btn.name}» sticks out of the bar`).toBeLessThanOrEqual(r.bar.b + 0.5);
      }
      // the assistant's button is not on the screen while the bar is the header («Ещё» keeps the assistant)
      expect(r.fabShown, `${label}: the assistant's button is on the form`).toBe(false);
      // the form starts under the bar, not behind it…
      if (where === "top") expect(r.form.t, `${label}: the form starts behind the bar`).toBeGreaterThanOrEqual(r.bar.b);
      // …and ends in «Снять с продажи», above the nav, never under it
      if (where === "end") {
        expect(r.del.t, `${label}: «Снять с продажи» is under the bar`).toBeGreaterThanOrEqual(r.bar.b);
        expect(r.del.b, `${label}: «Снять с продажи» is under the nav`).toBeLessThanOrEqual(r.nav.t + 0.5);
      }
    };
    // a field the caret jumps to lands under the bar's edge, not behind it
    // (scroll-padding-top, admin.css) — and the bar stays where it is
    const fieldUnderBar = async (label: string) => {
      const r = await page.evaluate(() => {
        const el = document.querySelector("[data-edprice]") as HTMLInputElement;
        el.scrollIntoView({ block: "start" });
        el.focus();
        const f = el.getBoundingClientRect(), b = document.querySelector(".adm-savebar")!.getBoundingClientRect();
        return { field: f.top, barTop: b.top, barBottom: b.bottom, focused: document.activeElement === el };
      });
      expect(r.focused, `${label}: the price box did not take the focus`).toBe(true);
      expect(r.field, `${label}: the price box scrolled behind the bar`).toBeGreaterThanOrEqual(r.barBottom);
      expect(Math.abs(r.barTop), `${label}: the bar left the top of the screen with a field focused`).toBeLessThanOrEqual(0.5);
    };
    await page.evaluate(() => window.scrollTo(0, 0));
    await header("no inset, top of the scroll", 0, "top");
    await page.evaluate(() => window.scrollTo(0, 200));
    await header("no inset, scrolled", 0, "mid");
    await fieldUnderBar("no inset");
    // an iPhone 14: 47 px of notch above, 34 px of home indicator below
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 47, left: 0, bottom: 34, right: 0 } });
    await expect.poll(() => page.locator(".adm-bar").evaluate((el) => el.getBoundingClientRect().height),
      { message: "the nav did not grow by the inset" }).toBeGreaterThanOrEqual(98);
    await expect.poll(() => page.locator(".adm-savebar").evaluate((el) => el.getBoundingClientRect().height),
      { message: "the bar did not grow by the notch inset" }).toBeGreaterThanOrEqual(99);
    await page.evaluate(() => window.scrollTo(0, 0));
    await header("iPhone insets, top of the scroll", 47, "top");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await header("iPhone insets, end of the scroll", 47, "end");
    await fieldUnderBar("iPhone insets");
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, left: 0, bottom: 0, right: 0 } });
    await cdp.detach();

    // ---- the photo rows -----------------------------------------------------
    await edTab(page, "media");
    const photos = await page.evaluate(() => {
      const box = (el: Element) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
      return Array.from(document.querySelectorAll(".adm-photo:not(.adm-photo--add)")).map((t) => ({
        tile: box(t),
        ops: Array.from(t.querySelectorAll(".adm-photo__op")).map((o) => ({ name: o.getAttribute("aria-label") || "", ...box(o) })),
      }));
    });
    expect(photos.length, "PRODUCT_2 has two catalogue photos — the second is the one with ← → ★ ×").toBeGreaterThanOrEqual(2);
    photos.forEach((p, i) => {
      expect(p.ops.length, `photo ${i + 1} has no buttons`).toBeGreaterThanOrEqual(3);
      for (const op of p.ops) {
        expect(inside(op, p.tile), `photo ${i + 1}: «${op.name}» sticks out of its own tile`).toBe(true);
        expect(Math.min(op.r - op.l, op.b - op.t), `photo ${i + 1}: «${op.name}» is under a thumb's size`).toBeGreaterThanOrEqual(43.5);
        for (const other of p.ops) if (other !== op) expect(overlaps(op, other), `photo ${i + 1}: «${op.name}» overlaps «${other.name}»`).toBe(false);
        photos.forEach((q, j) => { if (j !== i) expect(overlaps(op, q.tile), `photo ${i + 1}: «${op.name}» lies over photo ${j + 1}`).toBe(false); });
      }
    });
    await assertClean(page, w, "phone editor: bar and photos");

    // ---- «Сканер» fills the box it was opened from ---------------------------
    await edTab(page, "sizes");
    const box = page.locator(`[data-edean="${id} ${VARIANT}"]`);
    const other = page.locator(`[data-edean="${id} ${OTHER}"]`);
    const otherWas = await other.inputValue();
    const eanWas = await stockEan(page, id, VARIANT);
    await page.locator(`[data-edscan="${id} ${VARIANT}"]`).click();
    await expect(page.locator(".scanoverlay")).toBeVisible();
    await expect(page.locator(".scan__mode")).toHaveText("Товар: код встанет в поле «Штрихкод»");
    // Back while it is up: the scanner goes, the editor stays, the panel stays
    await page.goBack();
    await expect(page.locator(".scanoverlay"), "Back did not close the scanner").toHaveCount(0);
    await expect(page.locator("[data-admsavegoods]"), "Back closed the editor along with the scanner").toBeVisible();
    await expect(page.locator('body[data-screen="admin"]')).toBeAttached();
    // again, and this time a code arrives — the manual field is the camera's
    // stand-in in headless Chromium, the same path a camera hit takes
    // (scanner-app.spec.ts, handleScanCode)
    await page.locator(`[data-edscan="${id} ${VARIANT}"]`).click();
    await expect(page.locator(".scanoverlay")).toBeVisible();
    await expect(page.locator("[data-scanmanualsubmit]")).toHaveText("Вписать");
    const code = `27${Date.now().toString().slice(-10)}`;
    await page.locator("[data-scanmanual]").fill(code);
    await page.locator("[data-scanmanualsubmit]").click();
    await expect(page.locator(".scanoverlay"), "the scanner stayed open after the read").toHaveCount(0);
    await expect(page.locator("[data-admsavegoods]"), "the editor closed with the scanner").toBeVisible();
    await expect(page.locator('[data-edtab="sizes"][aria-current="true"]'), "the editor lost its tab").toBeVisible();
    await expect(box, "the code did not land in the box the scanner was opened from").toHaveValue(code);
    expect(await other.inputValue(), "the code landed in the other size's box too").toBe(otherWas);
    expect(await toastText(page)).toMatch(/Код считан/);
    // …and the toast asking for «Сохранить» does not sit on «Сохранить»
    const toastVsSave = await page.evaluate(() => {
      const t = document.querySelector(".adm-toast")!.getBoundingClientRect();
      const s = document.querySelector("[data-admsavegoods]")!.getBoundingClientRect();
      return { l: t.left, t: t.top, r: t.right, b: t.bottom, save: { l: s.left, t: s.top, r: s.right, b: s.bottom } };
    });
    expect(overlaps(toastVsSave, toastVsSave.save), "the toast covers the «Сохранить» it asks for").toBe(false);
    await clearToast(page);
    // the scan itself wrote nothing — like a typed code, it is bound by «Сохранить»
    expect(await stockEan(page, id, VARIANT), "the scan bound the code on its own").toBe(eanWas);
    // Back now closes the editor — the one layer left — and stays in the panel
    await page.goBack();
    await expect(page.locator("[data-admsavegoods]"), "Back did not close the editor").toHaveCount(0);
    await expect(page.locator('body[data-screen="admin"]'), "Back left the admin").toBeAttached();
    await assertClean(page, w, "phone editor: the scanner into the box");
  });

  /**
   * Round 12 (Dim, 10.09.2026). The brand box of «+ Товар» was an <input
   * list> over a <datalist>, and Chrome drew the OS's own popup for it —
   * dark, taller than the window. It is the panel's own list now: the shop's
   * brands with the most products first, at most eight rows, filtered as you
   * type with the typed part marked, ↑ ↓ Enter Escape, a press outside
   * closes it, and «Новый бренд «…»» is the one row when nothing matches.
   * Nothing is written — the editor is cancelled at the end.
   */
  test("«+ Товар»: the brand box is the panel's own list — filtered, keyboard-driven, a new brand when nothing matches", async ({ page }) => {
    const w = watch(page);
    await openAdmin(page);
    await tab(page, "goods");
    await page.locator("[data-admgoodsnew]").click();
    const box = page.locator("[data-edbrand]");
    const list = page.locator("#edbrandlist");
    const opts = list.locator('[role="option"]');
    await expect(box).toBeVisible();
    // no OS popup: a combobox over the panel's own listbox
    await expect(page.locator("datalist"), "the <datalist> is still there").toHaveCount(0);
    await expect(box).toHaveAttribute("role", "combobox");
    await expect(list).toHaveAttribute("role", "listbox");

    // opens on focus — «+ Товар» puts the caret there — and on a press in the
    // box, with the shop's brands, every row a thumb's size; it survives the
    // background render the media probe's answer causes
    await expect(list, "the list did not open with the focus").toBeVisible();
    await page.waitForTimeout(700);
    await expect(list, "a background render closed the list").toBeVisible();
    await box.click();
    await expect(list).toBeVisible();
    await expect(box).toHaveAttribute("aria-expanded", "true");
    expect(await opts.count()).toBeGreaterThanOrEqual(2);
    expect(await opts.count()).toBeLessThanOrEqual(8);
    for (const h of await opts.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
      expect(h, "a brand row is under a thumb's size").toBeGreaterThanOrEqual(43.5);
    }

    // typed → filtered, the typed part marked in each name
    await box.fill("pror");
    await expect(opts.first()).toContainText("Proraso");
    await expect(opts.first().locator("mark")).toHaveText(/^pror$/i);
    for (const name of await opts.allTextContents()) expect(name.toLowerCase()).toContain("pror");

    // ↓ then Enter picks the marked row and closes the list
    await box.press("ArrowDown");
    await expect(box).toHaveAttribute("aria-activedescendant", "edbrandopt-0");
    await expect(opts.first()).toHaveAttribute("aria-selected", "true");
    await box.press("Enter");
    await expect(box).toHaveValue("Proraso");
    await expect(list).toBeHidden();
    await expect(box).toHaveAttribute("aria-expanded", "false");

    // nothing matches → the one row offers what was typed as a new brand
    await box.fill("Zeta Beard Co");
    await expect(opts).toHaveCount(1);
    await expect(opts.first()).toContainText("Новый бренд «Zeta Beard Co»");
    await opts.first().click();
    await expect(box).toHaveValue("Zeta Beard Co");
    await expect(list).toBeHidden();

    // Escape closes the list and nothing else; a press outside closes it too
    await box.press("ArrowDown");
    await expect(list).toBeVisible();
    await box.press("Escape");
    await expect(list).toBeHidden();
    await expect(page.locator("[data-admsavegoods]"), "Escape closed more than the list").toBeVisible();
    await box.press("ArrowDown");
    await expect(list).toBeVisible();
    await page.locator("h1.adm-h1").click();
    await expect(list).toBeHidden();
    expect(await box.inputValue(), "closing the list changed the typed brand").toBe("Zeta Beard Co");
    await assertClean(page, w, "the brand list");
    await page.locator("[data-admclose]").first().click();
  });

  /**
   * Round 12 (Dim, 10.09.2026): the desktop photo tile. Its buttons — 30 px,
   * laid over the picture's bottom edge — wrapped and clipped on the 144-px
   * tile a 760-px pane gave. They stand under the picture now, on paper, in
   * one row, 36 px each and named; the tile itself is at least 200 px and
   * the «главное» tag reads at 12 px. The phone's row layout is the test
   * above; this one is the desktop's.
   */
  test("desktop: photo buttons stand in one row under the picture, big enough to hit, inside their own tile", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the desktop tile — the phone has its own row layout");
    const w = watch(page);
    type Box = { l: number; t: number; r: number; b: number };
    const overlaps = (a: Box, b: Box) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    const inside = (a: Box, b: Box) => a.l >= b.l - 0.5 && a.r <= b.r + 0.5 && a.t >= b.t - 0.5 && a.b <= b.b + 0.5;

    await openAdmin(page);
    await openEditor(page, PRODUCT_2.id);
    await edTab(page, "media");
    const photos = await page.evaluate(() => {
      const box = (el: Element) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
      return Array.from(document.querySelectorAll(".adm-photo:not(.adm-photo--add)")).map((t) => {
        const tag = t.querySelector(".adm-photo__tag");
        return {
          tile: box(t), img: box(t.querySelector(".adm-photo__img")!),
          tag: tag ? { text: (tag.textContent || "").trim(), size: parseFloat(getComputedStyle(tag).fontSize) } : null,
          ops: Array.from(t.querySelectorAll(".adm-photo__op")).map((o) => ({ name: o.getAttribute("aria-label") || "", title: o.getAttribute("title") || "", ...box(o) })),
        };
      });
    });
    expect(photos.length, "PRODUCT_2 has two catalogue photos").toBeGreaterThanOrEqual(2);
    photos.forEach((p, i) => {
      expect(p.tile.r - p.tile.l, `tile ${i + 1} is narrower than 160 px`).toBeGreaterThanOrEqual(160);
      expect(p.ops.length, `tile ${i + 1} has no buttons`).toBeGreaterThanOrEqual(3);
      for (const op of p.ops) {
        expect(op.name && op.title, `tile ${i + 1}: a button with no name`).toBeTruthy();
        expect(inside(op, p.tile), `tile ${i + 1}: «${op.name}» sticks out of its tile`).toBe(true);
        expect(Math.min(op.r - op.l, op.b - op.t), `tile ${i + 1}: «${op.name}» is under 32 px`).toBeGreaterThanOrEqual(32);
        expect(op.t, `tile ${i + 1}: «${op.name}» lies over the picture`).toBeGreaterThanOrEqual(p.img.b - 0.5);
        for (const other of p.ops) if (other !== op) expect(overlaps(op, other), `tile ${i + 1}: «${op.name}» overlaps «${other.name}»`).toBe(false);
      }
      expect(new Set(p.ops.map((o) => Math.round(o.t))).size, `tile ${i + 1}: the buttons wrapped onto two lines`).toBe(1);
    });
    expect(photos[0].tag?.text, "the first photo does not say «главное»").toBe("главное");
    expect(photos[0].tag!.size, "the «главное» tag is too small to read").toBeGreaterThanOrEqual(12);
    await assertClean(page, w, "desktop photo tiles");
  });
});
