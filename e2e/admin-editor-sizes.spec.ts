import { expect, type Page, test } from "@playwright/test";
import { ipHeaders, shopUrl, waitForScreen } from "./fixtures";
import { assertClean, clearToast, freshShop, openAdmin, tab, toastText, watch } from "./sweep-helpers";

/**
 * «Товар → Размеры и цены» — the three controls that were `disabled` until
 * db/migrations/147_override_sizes_hidden.sql: «+ Размер», «×» and
 * «Показывать в магазине».
 *
 * Dim's answer was «we need the feature, so implement», so what is pinned
 * here is exactly what he asked for and nothing about the design around it:
 *   · a volume Renat adds to a CATALOGUE product reaches the shop's product
 *     page and the public feed, at the price he typed;
 *   · «×» takes a volume away again;
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

async function openEditor(page: Page, id: string): Promise<void> {
  await tab(page, "goods");
  await page.locator("[data-goodsq]").fill(id);
  await page.locator(`[data-admgoods="${id}"]`).click();
  await expect(page.locator("[data-admsavegoods]")).toBeVisible();
}
async function edTab(page: Page, key: string): Promise<void> {
  await page.locator(`[data-edtab="${key}"]`).click();
  await expect(page.locator(`[data-edtab="${key}"][aria-current="true"]`)).toBeVisible();
}
/** What the public feed says about this product right now. */
async function feedFor(page: Page, id: string): Promise<Record<string, unknown>> {
  const body = await (await page.request.get("/api/overrides/")).json();
  return ((body.overrides || {})[id] || {}) as Record<string, unknown>;
}

test.describe("admin — «+ Размер», «×» and «Показывать в магазине»", () => {
  test.use({ extraHTTPHeaders: ipHeaders(176) });

  test("a volume Renat adds reaches the shop, and «×» takes it away again", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    const id = azur.id;

    await openAdmin(page);
    await openEditor(page, id);
    await edTab(page, "sizes");

    // The two buttons that used to be dead are alive, and say what they do
    // rather than «скоро» / «Объёмы заводит Дим».
    await expect(page.locator("[data-edsizeadd]"), "«+ Размер» is still dead").toBeEnabled();
    await expect(page.locator("[data-edsizeadd]")).toHaveText("+ Размер");
    await expect(page.locator('[data-edpane="sizes"]')).not.toContainText("Объёмы заводит Дим");

    try {
      // ---- «+ Размер»: one volume becomes two ------------------------------
      await page.locator("[data-edsizeadd]").click();
      await expect(page.locator('[data-edsz="0"]'), "the first row did not become a labelled volume").toBeVisible();
      await page.locator('[data-edsz="0"]').fill("100 мл");
      await page.locator('[data-edpx="0"]').fill("16");
      await page.locator('[data-edsz="1"]').fill("400 мл");
      await page.locator('[data-edpx="1"]').fill("29");
      await page.locator(`[data-admsavegoods="${id}"]`).click();
      expect(await toastText(page)).toMatch(/Сохранено/);
      await clearToast(page);
      await assertClean(page, w, "editor saved a new size ladder");

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
      await assertClean(shop.page, shop.w, "product page after «+ Размер»");
      await shop.close();

      // ---- «×»: the second volume goes away --------------------------------
      await openEditor(page, id);
      await edTab(page, "sizes");
      await expect(page.locator('[data-edsz="1"]')).toHaveValue("400 мл");
      await page.locator('[data-edsizedel="1"]').click();
      await expect(page.locator('[data-edsz="1"]'), "«×» did not remove the row").toHaveCount(0);
      await page.locator(`[data-admsavegoods="${id}"]`).click();
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
      await openEditor(page, id);
      await edTab(page, "sizes");
      const rows = await page.locator("[data-edpx]").count();
      for (let i = rows - 1; i > 0; i -= 1) await page.locator(`[data-edsizedel="${i}"]`).click();
      if (await page.locator('[data-edsz="0"]').count()) await page.locator('[data-edsz="0"]').fill("");
      await page.locator('[data-edpx="0"]').fill(String(azur.price));
      await page.locator(`[data-admsavegoods="${id}"]`).click();
      await clearToast(page);
    }
  });

  test("«Показывать в магазине» takes a product out of the shop and puts it back", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    const id = azur.id;

    await openAdmin(page);
    await openEditor(page, id);
    await edTab(page, "main");

    const sw = page.locator(`[data-edhidden="${id}"]`);
    await expect(sw, "«Показывать в магазине» is still a dead decoration").toBeEnabled();
    await expect(sw).toHaveAttribute("aria-checked", "true");

    try {
      await sw.click();
      expect(await toastText(page)).toMatch(/убран из магазина/);
      await clearToast(page);
      await assertClean(page, w, "product hidden");
      await expect.poll(async () => (await feedFor(page, id)).hidden,
        { timeout: 15_000, message: "the feed never carried «hidden»" }).toBe(true);

      // the panel still has it — with «Скрыт» beside it, so it can be found again
      await tab(page, "goods");
      await page.locator("[data-goodsq]").fill(id);
      const row = page.locator(`[data-admgoods="${id}"]`);
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
      await openEditor(page, id);
      await edTab(page, "main");
      await page.locator(`[data-edhidden="${id}"]`).click();
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
