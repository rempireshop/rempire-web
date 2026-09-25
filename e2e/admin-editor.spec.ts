import { expect, type Page, test } from "@playwright/test";
import { eur, ipHeaders, PRODUCT, PRODUCT_2, shopUrl, waitForScreen } from "./fixtures";
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
 *   · the photo grid tags its first picture «главное», and the sizes that show it;
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
      const row = page.locator(`[data-stockedit="${id} ${VARIANT}"]`).locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' adm-row ')][1]");
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
      // the first photo is the main one and wears the tag that says so. Since
      // 19.09.2026 (0a8e2fa) the tag also names the sizes that show it —
      // «главное · 40 мл · 150 мл»; it used to stop at the word, so the one
      // picture most sizes point at was the one tile that would not admit it.
      // The word stays a node of its own, which is what lets the dictionary
      // carry it while the size names beside it travel as they are.
      const mainTag = page.locator(".adm-photo__tag--ink").first();
      await expect(mainTag.locator("span").first()).toHaveText("главное");
      await expect(mainTag, "the main photo does not say which sizes show it").toContainText(VARIANT);
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
      // On a catalogue product it is «Отметить «нет в наличии»» since
      // 19.09.2026 (6313532): it never did take the product off sale — the
      // «Показывать в магазине» switch does that — so it stopped saying it
      // did. «Снять с продажи» is the owner's own product's word only.
      await expect(page.locator("[data-admgoodspull]")).toHaveText("Отметить «нет в наличии»");
      await page.locator("[data-admgoodspull]").click();
      const card = page.locator(".adm-confirm");
      await expect(card, "«Отметить «нет в наличии»» skipped the confirm card").toBeVisible();
      await expect(card).toContainText("Отметить «нет в наличии»?");
      // …and «Отмена» really cancels
      await page.locator("[data-admcancel]").click();
      await expect(card).toHaveCount(0);
      await expect(page.locator("[data-admsavegoods]"), "cancelling the card closed the editor").toBeVisible();

      await page.locator("[data-admgoodspull]").click();
      await page.locator("[data-admapply]").click();
      expect(await toastText(page)).toMatch(/Отмечено «нет в наличии»/);
      // the undo the toast offers is the safety net the README asks for
      await expect(page.locator(".adm-toast__undo")).toBeVisible();
      await page.locator(".adm-toast__undo").click();
      await expect(page.getByRole("status")).toContainText("Отменено");
      await clearToast(page);
      await assertClean(page, w, "«Отметить «нет в наличии»» and its undo");

      // the product is in stock again — which is what the undo promised
      await openEditor(page, id);
      await edTab(page, "main");
      expect(await page.locator("[data-edstock]").inputValue(),
        "the undo did not put the product back in stock").not.toBe("out");
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
        // on screen at all — its own box, or none because it or a parent is display:none
        const shown = (sel: string) => { const el = document.querySelector(sel); return !!el && el.getClientRects().length > 0; };
        return {
          vw: window.innerWidth, vh: window.innerHeight,
          bar: q(".adm-savebar"), nav: q(".adm-bar"), del: q("[data-admgoodspull]"), form: q(".adm-screen"),
          // 1a: the panel's own top bar and the assistant's icon in it (the site bar and the floating button are gone)
          fabShown: shown(".adm-top__ai"), panelHeaderShown: shown(".adm-top"),
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
      // the assistant's icon is not on the screen while the bar is the header (it comes back with the top bar)
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
    /* Back now closes the editor — the one layer left — and stays in the
       panel. The scanned code is an unsaved edit like a typed one (map of the
       panel, 23.09.2026, #3), so the first Back asks and the second leaves. */
    await page.goBack();
    await expect(page.locator("[data-admbackyes]"), "Back threw the scanned code away without asking").toBeVisible();
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
    // the word first, then — since 19.09.2026 (0a8e2fa) — the sizes that show it
    expect(photos[0].tag?.text, "the first photo does not say «главное»").toMatch(/^главное(?: · |$)/);
    expect(photos[0].tag!.size, "the «главное» tag is too small to read").toBeGreaterThanOrEqual(12);
    await assertClean(page, w, "desktop photo tiles");
  });
});

/* ==========================================================================
   The acceptance run, 12.09.2026 — five things the owner found on his phone,
   and what each of them turned out to be. His words are quoted on the test
   they belong to.
   ========================================================================== */

/** A photo in the bucket, and the cut-out of it the server answers with. */
const CUT_SRC = "/shop/img/system-4-bio-botanical-shampoo-0.webp?v=5";
const CUT_OUT = "/shop/img/system-4-bio-botanical-serum-0.webp?v=5";

/**
 * No bucket in this suite (playwright.config.ts), so the media routes answer
 * from here. `hold: true` keeps the cut-out in flight until release() is
 * called — which is the whole point: on the real server a cut-out is a model
 * round trip the route allows up to 90 seconds (src/lib/photo-cutout.ts), and
 * what this pins is everything the owner can do to the gallery in that time.
 */
async function stubCutout(page: Page, opts: { hold: boolean }) {
  const asked: string[] = [];
  let release: (() => void) | null = null;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route("**/api/admin/upload/**", async (route) => {
    const r = route.request();
    if (r.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, configured: true, cutout: true, maxBytes: 12 * 1024 * 1024, maxVideoBytes: 60 * 1024 * 1024 }) });
      return;
    }
    if (r.url().includes("/cutout/")) {
      asked.push(String((r.postDataJSON() as { url?: string }).url || ""));
      if (opts.hold) await gate;
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, key: "products/e2e/cut.png", url: CUT_OUT, thumbUrl: CUT_OUT, bytes: 10 }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, key: "products/e2e/1.webp", url: CUT_SRC, thumbUrl: CUT_SRC, width: 1, height: 1, bytes: 10, alt: "" }) });
  });
  return { asked, release: () => release && release() };
}

/** Every photo tile as the owner sees it: its picture, its label, and whether it says it is busy. */
function photoState(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".adm-photo:not(.adm-photo--add)")).map((t) => ({
      img: ((t.querySelector(".adm-photo__img") as HTMLElement | null)?.style.backgroundImage || "").replace(/^url\(['"]?|['"]?\)$/g, ""),
      tag: (t.querySelector(".adm-photo__tag")?.textContent || "").trim(),
      busy: t.classList.contains("adm-photo--busy"),
    })),
  );
}

test.describe("admin — what the acceptance run found", () => {
  /**
   * Renat, 12.09.2026: «Photo is loaded. When I click "remove background" and
   * move it to main, then actually the photo which it replaced is lost — the
   * one that I moved to main has still the background, after some time the
   * one where the background is removed — the background is removed and it
   * appears.»
   *
   * Two faults in one sentence. The cut-out was written back to the INDEX the
   * ✂ had been pressed on, so a ★ in the meantime shifted the list under the
   * answer: it landed on whatever photo had moved into that slot and replaced
   * it outright — a photo gone, with nothing said. And the only sign that
   * anything was happening at all was the ✂ buttons going grey, so the
   * picture simply changed under him a minute later.
   */
  test("a cut-out that lands after the photo has been moved replaces that photo and no other, and the tile says it is being worked on", async ({ page }, ti) => {
    test.skip(ti.project.name !== "desktop", "one gallery, one engine — the phone layout is the test below");
    test.setTimeout(120_000);
    const w = watch(page);
    const cut = await stubCutout(page, { hold: true });
    await openAdmin(page);
    await openEditor(page, PRODUCT_2.id);
    await edTab(page, "media");
    const before = await photoState(page);
    expect(before.length, "this product needs two photos for the test to mean anything").toBeGreaterThanOrEqual(2);

    // ✂ on the second photo — and, while the server works, ★ to make it the main one
    await page.locator('[data-galcut="1"]').click();
    await expect.poll(async () => (await photoState(page))[1].busy,
      { message: "nothing on the tile says this photo is still being worked on" }).toBe(true);
    expect((await photoState(page))[1].tag).toContain("Убираем фон");
    await page.locator('[data-galmain="1"]').click();
    const moved = await photoState(page);
    expect(moved[0].busy, "«Убираем фон…» stayed behind on the slot instead of following the photo").toBe(true);
    expect(moved[1].busy).toBe(false);

    cut.release();
    await expect.poll(async () => (await photoState(page))[0].img, { timeout: 20_000 }).toContain(CUT_OUT);
    const after = await photoState(page);
    expect(after.length, "a photo went missing while a background was being removed").toBe(before.length);
    expect(after[1].img, "the cut-out landed on the wrong photo and replaced it").toContain(before[0].img.split("?")[0]);
    expect(after.some((p) => p.busy), "a tile is still marked busy after the answer").toBe(false);
    expect(cut.asked[0], "the wrong photo was sent to be cut out")
      .toContain(before[1].img.split("?")[0].replace(/^https?:\/\/[^/]+/, ""));
    await clearToast(page);
    await assertClean(page, w, "a cut-out while the gallery is being reordered");
  });

  /**
   * Renat, 12.09.2026: «The buttons and each photo have a square around them,
   * but the buttons are overflowing there.»
   *
   * Five 44-px buttons and their four gaps are 236 px; the column they stand
   * in is 235 px wide at 375. The row could neither wrap (no flex-wrap) nor
   * shrink (flex: none), so it ran out of its own tile — and .adm2's
   * overflow-x: clip hid the evidence instead of showing a scrollbar. The
   * phone test further up never saw it because it does not stub the media
   * probe, so MEDIA.cutout is false there and a tile carries four buttons.
   */
  test("phone: all five photo buttons stay inside their own tile, at 375 and at 360", async ({ page }, ti) => {
    test.skip(ti.project.name !== "mobile", "the phone layout");
    test.setTimeout(120_000);
    const w = watch(page);
    await stubCutout(page, { hold: false });
    await openAdmin(page);
    await openEditor(page, PRODUCT_2.id);
    await edTab(page, "media");

    for (const width of [375, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(150);
      const shot = await page.evaluate(() => {
        const box = (el: Element) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        return {
          docW: document.documentElement.scrollWidth, winW: window.innerWidth,
          tiles: Array.from(document.querySelectorAll(".adm-photo:not(.adm-photo--add)")).map((t) => {
            const cs = getComputedStyle(t), b = t.getBoundingClientRect();
            return {
              // the tile's own paper, inside its padding — where its buttons belong
              pad: { r: b.right - parseFloat(cs.paddingRight), b: b.bottom - parseFloat(cs.paddingBottom) },
              ops: Array.from(t.querySelectorAll(".adm-photo__op")).map((o) => ({ name: o.getAttribute("aria-label") || "", ...box(o) })),
            };
          }),
        };
      });
      expect(shot.docW, `${width}px: the panel scrolls sideways`).toBeLessThanOrEqual(shot.winW + 0.5);
      shot.tiles.forEach((t, i) => {
        expect(t.ops.length, `${width}px: photo ${i + 1} lost its buttons`).toBeGreaterThanOrEqual(4);
        for (const op of t.ops) {
          expect(op.r, `${width}px: photo ${i + 1}: «${op.name}» sticks out of its own tile`).toBeLessThanOrEqual(t.pad.r + 0.5);
          expect(op.b, `${width}px: photo ${i + 1}: «${op.name}» hangs out of the bottom of its own tile`).toBeLessThanOrEqual(t.pad.b + 0.5);
          expect(Math.min(op.r - op.l, op.b - op.t), `${width}px: «${op.name}» is under a thumb's size`).toBeGreaterThanOrEqual(43.5);
        }
      });
      expect(shot.tiles[1].ops.length, `${width}px: a photo that is not the main one carries all five buttons`).toBe(5);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await assertClean(page, w, "the photo tiles at 375 and at 360");
  });

  /**
   * Renat, 12.09.2026, on removing a size: «The deletion does not trigger or
   * inform that it needs to be saved.»
   *
   * The bar's «Не сохранено» is set by an `input` or a `change` event, and a
   * button press is neither. «+ Размер» got away with it because it ends by
   * putting the caret in the new box, so the owner's next keystroke marked
   * the form; «×» types nothing, so a real change that «Сохранить» would
   * write went unannounced and could be walked away from.
   *
   * Nothing here is saved — the shortened ladder lives in S.goodsSizes until
   * «Сохранить», and this test presses «Отмена» and then «Выйти без
   * сохранения» — so PRODUCT's three sizes, which half this suite reads, are
   * not touched.
   *
   * Since 19.09.2026 (edec888) the same mark is what makes «Отмена» ask
   * before it throws the form away — the card «← Товары» and Back show too —
   * so the deletion is announced twice now: once in the bar, once on the way
   * out. «Отмена» going straight back to the list would mean the ladder had
   * been walked away from without a word, which is this finding over again.
   */
  test("phone: a size removed with «×» says the form is not saved", async ({ page }, ti) => {
    test.skip(ti.project.name !== "mobile", "the «Не сохранено» note is the phone bar's");
    test.setTimeout(120_000);
    const w = watch(page);
    await openAdmin(page);
    await openEditor(page, PRODUCT.id);
    const note = page.locator("[data-barnote]");
    await edTab(page, "sizes");
    await expect(note, "a form nobody has touched already says it is unsaved").toHaveText("");
    const rows = page.locator("[data-edsizedel]");
    const n = await rows.count();
    expect(n, "this product needs two sizes for «×» to be pressable").toBeGreaterThanOrEqual(2);
    await rows.nth(n - 1).click();
    await expect(page.locator("[data-edsizedel]")).toHaveCount(n - 1);
    await expect(note, "a deleted size is a real change and nobody was told").toHaveText("Не сохранено");
    await page.locator(".adm-savebar [data-admclose]").click();
    await expect(page.locator("[data-admbackyes]"), "«Отмена» threw a deleted size away without asking").toBeVisible();
    await expect(page.locator("#goodslist")).toHaveCount(0);
    await page.locator("[data-admbackyes]").click();
    await expect(page.locator("#goodslist")).toBeVisible();
    await assertClean(page, w, "a deleted size");
  });

  /**
   * Renat, 12.09.2026, twice: «After the save, in the list I am somehow put
   * almost to the bottom of the page» and «after each save, when I am put
   * back into the list, I am put back to the bottom of the list.»
   *
   * Nothing decided the scroll at all. The panel is morph-patched rather than
   * rebuilt, so the depth the editor was scrolled to — and on a phone its
   * «Сохранить» is a fixed bar he can press from any depth — was simply
   * applied to the list that took its place.
   */
  test("saving a product puts the list back on the row it came from", async ({ page }, ti) => {
    test.skip(ti.project.name !== "desktop", "one list, one rule — measured where the list is longest");
    test.setTimeout(150_000);
    const w = watch(page);
    await openAdmin(page);
    await tab(page, "goods");
    await page.locator("[data-goodsq]").fill("");
    const rows = page.locator("#goodslist [data-admgoods]");
    await expect(rows.first()).toBeVisible();
    /* «Показать ещё» pressed in the page, not by the mouse. A mouse click
       scrolls the button into view first, and since 19.09.2026 bringing it
       into view IS the next page (goodsScrollMore): the list grows under the
       pointer and the click lands on a product row. On 24.09.2026 that opened
       «Proraso White» and this test counted the rows of an editor — 0. */
    const before = await rows.count();
    if (await page.locator("[data-admgoodsmore]").count()) {
      await page.evaluate(() => document.querySelector<HTMLElement>("[data-admgoodsmore]")?.click());
      await expect.poll(() => rows.count(), { message: "«Показать ещё» did not lengthen the list" }).toBeGreaterThan(before);
    }
    const n = await rows.count();
    expect(n, "the list is too short for this to mean anything").toBeGreaterThan(12);
    const target = rows.nth(Math.min(25, n - 1));
    const id = await target.getAttribute("data-admgoods");
    await target.scrollIntoViewIfNeeded();
    await target.click();
    await expect(page.locator("[data-admsavegoods]")).toBeVisible();
    // he reads down the editor and presses the bar's «Сохранить» from where he is
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.locator("[data-admsavegoods]").first().click();
    await expect(page.locator("#goodslist")).toBeVisible();
    await page.waitForTimeout(600);
    const where = await page.evaluate((pid) => {
      const row = document.querySelector(`#goodslist [data-admgoods="${pid}"]`);
      if (!row) return null;
      const b = row.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, vh: window.innerHeight };
    }, id);
    expect(where, "the row is gone from the list").not.toBeNull();
    expect(where!.bottom, "the row of the product just saved is above the screen").toBeGreaterThan(0);
    expect(where!.top, "the row of the product just saved is below the screen — «I am put back to the bottom of the list»")
      .toBeLessThan(where!.vh);
    await clearToast(page);
    await assertClean(page, w, "back to the row it came from");
  });

  /**
   * Renat, 12.09.2026: «it lands somewhere at the end of the list, so it's
   * hard to find it again. Maybe some sort of a filter would be good for such
   * products and other statuses.»
   *
   * A product taken off sale leaves CATALOGUE altogether and comes back into
   * the panel's list only through its two trailing buckets — after every
   * product still on sale, and usually past the 40-row cap. The chips are the
   * same ones «Заказы» and «Склад» carry.
   */
  test("the products list filters by status, and a product taken off sale is two taps away", async ({ page }, ti) => {
    test.skip(ti.project.name !== "desktop", "the chips are the same at both widths; driven once");
    test.setTimeout(150_000);
    const w = watch(page);
    await openAdmin(page);
    await tab(page, "goods");
    await expect(page.locator("[data-goodsfilter]"), "the products list has no status chips").toHaveCount(4);
    await expect(page.locator('[data-goodsfilter="all"]')).toHaveAttribute("aria-current", "true");

    /* A catalogue product no other spec names — the same one
       admin-products.spec.ts picked for its own hide test, and for the same
       reason. Switched off here, switched back on in `finally`. */
    const HIDE_ID = "system-4-hydro-care-conditioner-h";
    await openEditor(page, HIDE_ID);
    await page.locator("[data-edhidden]").click();
    expect(await toastText(page)).toMatch(/убран из магазина/);
    await clearToast(page);
    try {
      await tab(page, "goods");
      await page.locator("[data-goodsq]").fill("");
      await page.locator('[data-goodsfilter="off"]').click();
      await expect(page.locator('[data-goodsfilter="off"]')).toHaveAttribute("aria-current", "true");
      await expect(page.locator(`[data-admgoods="${HIDE_ID}"]`),
        "the product taken off sale is not under «Скрытые»").toBeVisible();
      await expect(page.locator(`[data-admgoods="${HIDE_ID}"] .adm-badge`).first()).toHaveText("Скрыт");
      await page.locator('[data-goodsfilter="on"]').click();
      await expect(page.locator(`[data-admgoods="${HIDE_ID}"]`),
        "a product that is off sale is still listed under «В продаже»").toHaveCount(0);
      await assertClean(page, w, "the status chips");
    } finally {
      await page.locator('[data-goodsfilter="all"]').click();
      await openEditor(page, HIDE_ID);
      await page.locator("[data-edhidden]").click();
      await page.waitForTimeout(800);
      await clearToast(page);
      await page.locator(".adm-savebar [data-admclose]").click();
    }
  });
});
