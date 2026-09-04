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
});
