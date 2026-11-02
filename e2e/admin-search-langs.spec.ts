import { expect, type Page, test } from "@playwright/test";
import { adminLang, ipHeaders } from "./fixtures";
import { openAdmin, tab } from "./sweep-helpers";

/**
 * The panel's product search, in the panel's own languages.
 *
 * Owner report, 02.11.2026: on an English or Estonian panel the «Товары» rows
 * read «ANGEL.WASH — shampoo» (trName), but the search box looked at the raw
 * Russian name only — «Shampoo» found 27 of the 40 shampoos, Kevin.Murphy's
 * among the missing, and «шампуни» (the plural) found none at all. Every
 * product box of the panel asks one search now (admProdMatch in
 * public/shop2/app.js); tests/admin-search-all-langs.test.ts holds its rules
 * over the whole catalogue. This holds the box itself, cold, in a browser.
 */

const WASH = '[data-admgoods="kevin-murphy-angel-wash"]';
const RINSE = '[data-admgoods="kevin-murphy-angel-rinse"]';

async function searchGoods(page: Page, q: string): Promise<void> {
  const box = page.locator("[data-goodsq]:visible").first();
  await box.fill(q);
  await expect(box).toHaveValue(q);
}

test.describe("«Товары» on an English panel", () => {
  test.use({ extraHTTPHeaders: ipHeaders(238) });

  test("«Shampoo» finds Kevin.Murphy ANGEL.WASH, the row the panel draws as «… — shampoo»", async ({ page }) => {
    test.setTimeout(120_000);
    await openAdmin(page);
    await adminLang(page, "EN");
    await tab(page, "goods");

    await searchGoods(page, "Shampoo");
    const wash = page.locator(WASH).first();
    await expect(wash).toBeVisible();
    // the very words that were typed are on the row — that is what Renat was matching against
    await expect(wash).toContainText(/shampoo/i);
    await expect(page.locator(RINSE)).toHaveCount(0);

    await searchGoods(page, "Conditioner");
    await expect(page.locator(RINSE).first()).toBeVisible();
    await expect(page.locator(WASH)).toHaveCount(0);

    // the plural and the Estonian word find the same bottle
    for (const q of ["shampoos", "šampoon"]) {
      await searchGoods(page, q);
      await expect(page.locator(WASH).first(), q).toBeVisible();
    }
  });
});

test.describe("«Товары» on the Russian panel", () => {
  test.use({ extraHTTPHeaders: ipHeaders(251) });

  test("«шампуни» — the plural — finds ANGEL.WASH, and «kevin murphy шампуни» still narrows", async ({ page }) => {
    test.setTimeout(120_000);
    await openAdmin(page);
    await tab(page, "goods");

    await searchGoods(page, "шампуни");
    await expect(page.locator(WASH).first()).toBeVisible();

    // every word still has to be there: Davines' shampoos drop out
    await searchGoods(page, "kevin murphy шампуни");
    await expect(page.locator(WASH).first()).toBeVisible();
    await expect(page.locator('[data-admgoods^="davines-"]')).toHaveCount(0);
  });
});
