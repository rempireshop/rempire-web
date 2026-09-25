import { expect, type Page, test } from "@playwright/test";
import { ipHeaders, shopUrl, waitForScreen } from "./fixtures";
import { openCard, settled, toSection, typeAndLeave } from "./goods-helpers";
import { assertClean, clearToast, freshShop, openAdmin, tab, toastText, watch } from "./sweep-helpers";

/**
 * «Товар → Объёмы и цены» — the three controls that were `disabled` until
 * db/migrations/147_override_sizes_hidden.sql: «+ Объём», «×» and
 * «Показывать в магазине».
 *
 * Dim's answer was «we need the feature, so implement», so what is pinned
 * here is exactly what he asked for:
 *   · a volume Renat adds to a CATALOGUE product reaches the shop's product
 *     page and the public feed, at the price he typed — and (1a) it is saved
 *     the moment the ladder is whole, without «Сохранить»;
 *   · «×» asks first (README rule 4) and then takes a volume away;
 *   · «Показывать в магазине» off really removes the product — the panel's
 *     own list still has it (marked «Скрыт»), the catalogue, the search and
 *     the shop's product page no longer do;
 *   · both are reversible from the toast, like every other switch.
 *
 * A product of its own (`azur`), never touched by another spec, and every
 * change put back in `finally` — the suite is serial and order-independent
 * only because each file cleans up after itself (docs/testing.md).
 */

const azur = { id: "proraso-azur-lime-after-shave-balm-100-ml", brand: "Proraso", price: 16 };

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop" && testInfo.project.name !== "mobile",
    "product editor — desktop and mobile only, see docs/testing.md");
});

/** What the public feed says about this product right now. */
async function feedFor(page: Page, id: string): Promise<Record<string, unknown>> {
  const body = await (await page.request.get("/api/overrides/")).json();
  return ((body.overrides || {})[id] || {}) as Record<string, unknown>;
}

/** The catalogue file's own ladder again — no sizes, no price override. The
    card's own cleanup leaves one nameless rung behind (a ladder of one), which
    the next run (the phone project after the desktop one) must not start from. */
async function resetLadder(page: Page, id: string): Promise<void> {
  const r = await page.request.put("/api/admin/overrides/", { data: { id, sizes: null, price: null } });
  expect(r.status(), "the ladder reset was refused").toBe(200);
}

/** A tap on a phone first closes the keyboard: the bars that hide while a box
    is focused (body.adm-typing) come back, and in an emulated phone — no
    keyboard to make room — they land on the button being tapped. */
async function leaveBox(page: Page): Promise<void> {
  await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; if (a && a !== document.body) a.blur(); });
}

/** «×» on a size that is in the shop: the sheet, then «Убрать». */
async function removeSize(page: Page, i: number): Promise<void> {
  await page.locator(`[data-edsizedel="${i}"]`).click();
  const sheet = page.locator(".adm-confirm");
  if (await sheet.count()) await page.locator("[data-admapply]").click();
  await settled(page, "the shorter ladder");
}

test.describe("admin — «+ Объём», «×» and «Показывать в магазине»", () => {
  test.use({ extraHTTPHeaders: ipHeaders(176) });

  test("a volume Renat adds reaches the shop, and «×» takes it away again", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    const id = azur.id;

    await openAdmin(page);
    await resetLadder(page, id);
    await openCard(page, id);
    await toSection(page, "sizes");

    await expect(page.locator("[data-edsizeadd]"), "«+ Объём» is still dead").toBeEnabled();
    await expect(page.locator("[data-edsizeadd]")).toHaveText("+ Объём");
    await expect(page.locator('[data-edsec="sizes"]')).not.toContainText("Объёмы заводит Дим");

    try {
      // ---- «+ Объём»: one volume becomes two --------------------------------
      await page.locator("[data-edsizeadd]").click();
      await expect(page.locator('[data-edsz="0"]'), "the first row did not become a labelled volume").toBeVisible();
      await typeAndLeave(page, page.locator('[data-edsz="0"]'), "100 мл");
      // the new row has no name yet: nothing went to the shop, and the box says why
      expect((await feedFor(page, id)).sizes ?? null, "a ladder with a nameless size was saved").toBeNull();
      await expect(page.locator('[data-edsz="1"]')).toHaveAttribute("aria-invalid", "true");
      await typeAndLeave(page, page.locator('[data-edpx="0"]'), "16");
      await typeAndLeave(page, page.locator('[data-edsz="1"]'), "400 мл");
      await typeAndLeave(page, page.locator('[data-edpx="1"]'), "29");
      await assertClean(page, w, "the card saved a new size ladder");

      // …the feed carries the whole ladder, and `price` still agrees with rung 0
      await expect.poll(async () => (await feedFor(page, id)).sizes,
        { timeout: 15_000, message: "the overrides feed never carried the ladder" })
        .toEqual([{ size: "100 мл", price: 16 }, { size: "400 мл", price: 29 }]);
      expect(Number((await feedFor(page, id)).price)).toBe(16);

      // …and the shop offers both volumes, at the prices he typed
      const shop = await freshShop(browser);
      await shop.page.goto(shopUrl("", `/p/${id}/`));
      await waitForScreen(shop.page, "product");
      await expect(shop.page.locator("[data-size]"), "the shop shows the old ladder").toHaveCount(2);
      await expect(shop.page.locator("[data-size]").nth(1)).toContainText("400 мл");
      await shop.page.locator("[data-size]").nth(1).click();
      await expect(shop.page.locator("[data-price]")).toContainText("29");
      await assertClean(shop.page, shop.w, "product page after «+ Объём»");
      await shop.close();

      // ---- «×»: the second volume goes away — after the question ----------
      await openCard(page, id);
      await toSection(page, "sizes");
      await expect(page.locator('[data-edsz="1"]')).toHaveValue("400 мл");
      await page.locator('[data-edsizedel="1"]').click();
      await expect(page.locator(".adm-confirm"), "a size in the shop went without a question").toContainText("Убрать 400 мл?");
      await page.locator("[data-admapply]").click();
      await expect(page.locator('[data-edsz="1"]'), "«×» did not remove the row").toHaveCount(0);
      await settled(page);
      await clearToast(page);
      await expect.poll(async () => (await feedFor(page, id)).sizes, { timeout: 15_000 })
        .toEqual([{ size: "100 мл", price: 16 }]);

      // the shop cannot be sold the volume that is gone
      const res = await page.request.post("/api/orders/", {
        data: {
          lang: "ru", items: [{ id, variant: "400 мл", qty: 1 }],
          customer: { name: "Тест", email: "t@example.com", phone: "+372 5555 5555" },
          shipping: { method: "parcel", country: "EE" },
        },
      });
      expect(res.status(), "a removed volume was still sellable").toBeGreaterThanOrEqual(400);
    } finally {
      // back to the catalogue file's own single volume
      await openCard(page, id);
      await toSection(page, "sizes");
      const rows = await page.locator("[data-edpx]").count();
      for (let i = rows - 1; i > 0; i -= 1) await removeSize(page, i);
      if (await page.locator('[data-edsz="0"]').count()) await typeAndLeave(page, page.locator('[data-edsz="0"]'), "");
      await typeAndLeave(page, page.locator('[data-edpx="0"]'), String(azur.price));
      await clearToast(page);
      await resetLadder(page, id);
    }
  });

  /* «+ Объём» and «×» rebuild the sizes grid in place, and only the size and
     the price travel across the rebuild (edSizeRowsRead). «Остаток»,
     «Штрихкод» and «Салон, €» are re-drawn from the warehouse and the saved
     row — so a count just typed and a code just scanned were once gone the
     moment a volume was added beside them. 1a: leaving those boxes saves
     them, and the rebuilt grid shows what was saved; a row added and taken
     away again before it had a name never reaches the shop, and goes without
     the question. The code is unbound again at the end. */
  test("«+ Объём» keeps the count and the code just typed beside it", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    const id = azur.id;

    await openAdmin(page);
    await openCard(page, id);
    await toSection(page, "sizes");

    /* One unlabelled volume ⇒ the warehouse key is «<id> » with an empty
       tail. `.first()` because a volume added before either row has been
       given a label makes two rows with that same empty tail; row 0 is the
       one that was typed into. */
    const qty = page.locator(`[data-edqty="${id} "]`).first();
    const ean = page.locator(`[data-edean="${id} "]`).first();
    /* …and the box is dead until the warehouse list has landed: a count is
       sent as the difference from what the row holds, and before the list
       there is no count — the whole typed number once went out as a move. */
    await expect(qty, "«Остаток» never came alive").toBeEnabled({ timeout: 20_000 });

    try {
      await qty.fill("7");
      await ean.fill("4820000000017");
      // «Салон, €» is only a column while «Партнёры и баллы» is on
      const salon = page.locator("[data-edproprice]");
      const hasSalon = (await salon.count()) > 0;
      if (hasSalon) await salon.fill("11.50");

      await leaveBox(page);
      await page.locator("[data-edsizeadd]").click();
      await expect(page.locator('[data-edsz="1"]'), "«+ Объём» added no row").toBeVisible();
      await settled(page, "the boxes left for «+ Объём»");

      await expect(qty, "the count typed into «Остаток» was thrown away").toHaveValue("7");
      await expect(ean, "the code typed into «Штрихкод» was thrown away").toHaveValue("4820000000017");
      if (hasSalon) await expect(salon, "«Салон, €» was thrown away").toHaveValue(/^11[.,]5/);

      // …and «×» on the row nobody named takes it away without a question, and eats nothing
      await page.locator('[data-edsizedel="1"]').click();
      await expect(page.locator(".adm-confirm"), "a row that is not in the shop asked to be removed from it").toHaveCount(0);
      await expect(page.locator('[data-edsz="1"]')).toHaveCount(0);
      await expect(qty, "«×» threw the count away").toHaveValue("7");
      await expect(ean, "«×» threw the code away").toHaveValue("4820000000017");
      await assertClean(page, w, "«+ Объём» over a typed count and code");
    } finally {
      // the code goes back to nobody; the salon price to the discount
      await openCard(page, id);
      const unbind = page.locator(`[data-edunbind="${id} "]`);
      if (await unbind.count()) { await unbind.click(); await settled(page, "the unbound code"); }
      if (await page.locator("[data-edproprice]").count()) await typeAndLeave(page, page.locator("[data-edproprice]"), "");
      await clearToast(page);
    }
  });

  test("«Показывать в магазине» takes a product out of the shop and puts it back", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    const id = azur.id;

    await openAdmin(page);
    await openCard(page, id);
    await toSection(page, "shop");

    const sw = page.locator(`[data-edhidden="${id}"]`);
    await expect(sw, "«Показывать в магазине» is still a dead decoration").toBeEnabled();
    await expect(sw).toHaveAttribute("aria-checked", "true");

    try {
      await sw.click();
      expect(await toastText(page)).toMatch(/скрыт из магазина/);
      await settled(page, "the switch");
      await clearToast(page);
      await assertClean(page, w, "product hidden");
      await expect.poll(async () => (await feedFor(page, id)).hidden,
        { timeout: 15_000, message: "the feed never carried «hidden»" }).toBe(true);

      // the panel still has it — with «Скрыт» beside it, so it can be found again
      await tab(page, "goods");
      await page.locator("[data-goodsq]").fill(id);
      const row = page.locator(`[data-goodsrow="${id}"]`);
      await expect(row, "a hidden product disappeared from the panel too").toBeVisible();
      await expect(row).toContainText("Скрыт");

      // the shop does not: not in the catalogue, not in the search, no page
      const shop = await freshShop(browser);
      await shop.page.goto(shopUrl("", "/c/beard/"));
      await waitForScreen(shop.page, "catalog");
      await expect(shop.page.locator(`[data-go-product="${id}"]`),
        "a hidden product is still in the catalogue").toHaveCount(0);
      await shop.page.goto(shopUrl("", `/p/${id}/`));
      await shop.page.waitForFunction(() => document.body.dataset.screen !== undefined);
      expect(await shop.page.locator(`[data-add="${id}"]`).count(),
        "a hidden product could still be added to the basket").toBe(0);
      await assertClean(shop.page, shop.w, "shop without the hidden product");
      await shop.close();

      // …and it cannot be bought behind the shop's back either
      const res = await page.request.post("/api/orders/", {
        data: {
          lang: "ru", items: [{ id, qty: 1 }],
          customer: { name: "Тест", email: "t@example.com", phone: "+372 5555 5555" },
          shipping: { method: "parcel", country: "EE" },
        },
      });
      expect(res.status(), "a hidden product was still sellable").toBeGreaterThanOrEqual(400);
    } finally {
      await openCard(page, id);
      await toSection(page, "shop");
      await page.locator(`[data-edhidden="${id}"]`).click();
      await settled(page, "the switch back");
      await clearToast(page);
      await expect.poll(async () => (await feedFor(page, id)).hidden, { timeout: 15_000 })
        .not.toBe(true);
    }

    // back in the shop, which is what the switch promised
    const back = await freshShop(browser);
    await back.page.goto(shopUrl("", `/p/${id}/`));
    await waitForScreen(back.page, "product");
    await expect(back.page.locator(`[data-add="${id}"]`).first()).toBeVisible();
    await back.close();
  });
});
