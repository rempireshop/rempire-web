import { expect, type Page, test } from "@playwright/test";
import { adminSection, ipHeaders, loginAsAdmin, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

/**
 * «Строка брендов» (31.10.2026). Renat asked to take CBD Daily and Lumin out
 * of the brand row under the home page's banner — and nothing in the panel
 * could: the row was every brand the catalogue has. Now «Настройки → Главная
 * страница → Строка брендов» has a switch per brand (settings.home_brands),
 * and a brand's fold in «Тексты страниц», where he looked first, links there.
 */

async function openFold(page: Page, key: string): Promise<void> {
  const b = page.locator(`[data-admfold="${key}"]`);
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
  await expect(b).toHaveAttribute("aria-expanded", "true");
}

const hiddenNow = async (page: Page): Promise<string[]> => {
  const feed = await (await page.request.get("/api/overrides/", { headers: { "cache-control": "no-cache" } })).json();
  return (feed.settings?.home_brands?.hidden ?? []) as string[];
};

test.describe("admin — the home page's brand row", () => {
  test.use({ extraHTTPHeaders: ipHeaders(101) });

  test("a brand switched off leaves the row and nothing else, «Тексты страниц» links there, and it comes back", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const brand = PRODUCT.brand;
    await loginAsAdmin(page);
    await adminSection(page, "setup");
    await page.locator('[data-admsetpage="home"]').click();
    await openFold(page, "set:home-brands");
    await expect(page.locator(".adm-foldrow.is-open .adm-foldrow__s")).toHaveText("показаны все");

    const sw = page.locator(`[data-admhomebrand="${brand}"]`);
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await sw.click();
    await expect(page.locator(".adm-toast__t")).toContainText(`${brand} убран из строки брендов`);
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect.poll(() => hiddenNow(page), { timeout: 10_000 }).toEqual([brand]);

    // the shop: the row without it, and its products still on sale
    const shop = await browser.newPage();
    await shop.goto(shopUrl("", "/"));
    await waitForScreen(shop, "home");
    await expect(shop.locator(".brandstrip__it").first()).toBeVisible();
    await expect(shop.locator(`.brandstrip__it[data-go-brand="${brand}"]`)).toHaveCount(0);
    await shop.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(shop, "product");
    await shop.close();

    // «Тексты страниц»: the brand's fold says it is out, and «изменить» opens the row's switches
    // Back closes a settings page on every layout (the desktop's «← Настройки» link is not on a phone)
    await page.goBack();
    await page.locator('[data-admsetpage="texts"]').click();
    await openFold(page, `pt:brand:${brand}`);
    const line = page.locator(".adm-foldrow.is-open .adm-hint", { hasText: "В строке брендов на главной:" });
    await expect(line).toContainText("скрыт");
    await line.locator("[data-admhomebrandsgo]").click();
    await expect(page.locator('[data-admfold="set:home-brands"]')).toHaveAttribute("aria-expanded", "true");

    await page.locator(`[data-admhomebrand="${brand}"]`).click();
    await expect(page.locator(".adm-toast__t")).toContainText(`${brand} снова в строке брендов`);
    await expect.poll(() => hiddenNow(page), { timeout: 10_000 }).toEqual([]);
  });
});
