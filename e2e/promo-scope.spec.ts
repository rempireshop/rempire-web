import { expect, type Page, test } from "@playwright/test";
import {
  adminSection, continueButton, eur, freshEmail, ipHeaders, loginAsAdmin, openSummary,
  payButton, PRODUCT, PRODUCT_2, shopUrl, waitForScreen,
} from "./fixtures";

/**
 * Promo codes that apply to ONE BRAND or ONE PRODUCT — db/migrations/170_promo_scope.sql.
 *
 * The owner chose what «на Davines» means: the discount comes off the matching
 * lines and nothing else. So the two things this file has to see are the two
 * halves of that sentence — the discount really is taken (on the brand's lines)
 * and it really is not taken (on everything else in the same basket) — and,
 * because he makes these on an iPhone, that choosing a brand or a product is
 * not a wall of 220 names on a 375-px screen.
 *
 * The basket is PRODUCT (System 4) and PRODUCT_2 (Kevin.Murphy): two brands,
 * so «only the matching lines» is a statement with a witness on both sides.
 */

function freshCode(tag: string): string {
  return `${tag}${Date.now().toString().slice(-7)}`.toUpperCase();
}

/** Put both products in the basket and stop at the order summary. */
async function twoBrandBasket(page: Page): Promise<void> {
  for (const id of [PRODUCT.id, PRODUCT_2.id]) {
    await page.goto(shopUrl("", `/p/${id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
  }
  await page.goto(shopUrl("", "/checkout/"));
  await waitForScreen(page, "checkout");
  await page.locator("[data-email]").fill(freshEmail("promo-scope"));
  await continueButton(page, 2).click();
  await openSummary(page);
}

test.describe("«На что действует» — the owner picks a brand or a product on a phone", () => {
  test.use({ extraHTTPHeaders: ipHeaders(236) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name === "tablet", "desktop and phone are the two designed layouts");
  });

  test("a brand is one tap on a list of 26; a product is a search, never 220 rows", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await loginAsAdmin(page);
    await adminSection(page, "promos");
    await page.locator("[data-admpromonew]").click();

    // «Весь заказ» is where a new code starts — every code made before this
    // existed is exactly that, and the default must not change behind them
    await expect(page.locator('[data-promoscope="order"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator("[data-promobrand]")).toHaveCount(0);
    await expect(page.locator("[data-promoq]")).toHaveCount(0);

    // ---- «Бренд»: a native select, so the phone's own wheel does the work --
    await page.locator('[data-promoscope="brand"]').click();
    const select = page.locator("[data-promobrand]");
    await expect(select).toBeVisible();
    const brands = await select.locator("option").allTextContents();
    // 26 brands plus the «Выберите бренд» placeholder — a list, not a wall
    expect(brands.length, "the brand list is not the catalogue's brands").toBeGreaterThan(10);
    expect(brands.length).toBeLessThan(40);
    expect(brands, "the brands are not the shop's own").toContain(PRODUCT_2.brand);
    if (testInfo.project.name === "mobile") {
      const box = await select.boundingBox();
      expect(box!.height, "the select is not a thumb's height").toBeGreaterThanOrEqual(40);
    }

    // ---- «Товар»: a search box, and at most a handful of answers ----------
    await page.locator('[data-promoscope="product"]').click();
    await expect(page.locator("[data-promobrand]"), "the brand select stayed behind").toHaveCount(0);
    const q = page.locator("[data-promoq]");
    await expect(q).toBeVisible();
    // nothing typed, nothing listed: the 220 names are never all on screen
    const picks = page.locator("[data-promoprodpick]");
    await expect(picks).toHaveCount(0);
    /* …and a word that matches sixty-four products still answers with a
       handful. This is the whole of «not a wall on a 375-px screen»: the cap
       is on the ANSWER, not on the catalogue. */
    await q.fill("kevin");
    await expect(picks.first()).toBeVisible();
    expect(await picks.count(), "the search answered with a wall").toBeLessThanOrEqual(6);
    await q.fill("un-tangled");
    await expect(picks).toHaveCount(1);
    await page.locator(`[data-promoprodpick="${PRODUCT_2.id}"]`).click();
    // picked: the search is gone and the chosen product stands there instead
    await expect(page.locator("[data-promoq]")).toHaveCount(0);
    await expect(page.locator("[data-promoproddel]")).toBeVisible();

    // ---- free delivery has no scope at all, and says why ------------------
    await page.locator('[data-promokind="free_shipping"]').click();
    await expect(page.locator('[data-promoscope="brand"]'),
      "a free-delivery code was offered a brand").toHaveCount(0);
    await expect(page.locator(".adm-card--pad")).toContainText("посылка одна на всю корзину");
    // …and the server refuses the pair even when it is posted directly
    const refused = await page.request.post("/api/admin/promos/", {
      data: { code: freshCode("SHIPB"), kind: "free_shipping", scope: "brand", scopeValue: PRODUCT_2.brand },
    });
    expect(refused.status(), "a scoped free-delivery code was accepted").toBe(400);
    expect((await refused.json()).error).toBe("scope_free_shipping");
  });

  test("a code made through the form comes back scoped, and the list says so", async ({ page }) => {
    test.setTimeout(180_000);
    await loginAsAdmin(page);
    await adminSection(page, "promos");
    const code = freshCode("BRND");

    await page.locator("[data-admpromonew]").click();
    await page.locator('[data-promof="code"]').fill(code);
    await page.locator('[data-promof="value"]').fill("10");
    await page.locator('[data-promoscope="brand"]').click();
    await page.locator("[data-promobrand]").selectOption(PRODUCT_2.brand);
    await page.locator("[data-admpromosave]").click();
    await expect(page.getByRole("status")).toContainText("Промокод сохранён");

    // the row names what the code is for — the half a list of codes cannot imply
    const row = page.locator(".adm-row--open").filter({ has: page.locator(`[data-admpromotoggle="${code}"]`) });
    await expect(row).toBeVisible();
    await expect(row).toContainText(`на бренд ${PRODUCT_2.brand}`);

    // …and the server stored the pair, not half of it
    const list = await (await page.request.get("/api/admin/promos/")).json();
    const saved = (list.promos as Array<{ code: string; scope: string; scopeValue: string }>)
      .find((p) => p.code === code);
    expect(saved).toMatchObject({ scope: "brand", scopeValue: PRODUCT_2.brand });

    // reopening the form finds the code where it was left, not on «Весь заказ»
    await page.locator(`[data-admpromoedit="${code}"]`).click();
    await expect(page.locator('[data-promoscope="brand"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator("[data-promobrand]")).toHaveValue(PRODUCT_2.brand);
  });
});

test.describe("the checkout takes a scoped code off the matching lines only", () => {
  test.use({ extraHTTPHeaders: ipHeaders(237) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name === "tablet", "desktop and phone are the two designed layouts");
  });

  test("a brand code discounts its own brand, says so, and the order is billed the same", async ({ page }) => {
    test.setTimeout(300_000);
    await loginAsAdmin(page);
    const code = freshCode("KM");
    const made = await page.request.post("/api/admin/promos/", {
      data: { code, kind: "percent", value: 10, scope: "brand", scopeValue: PRODUCT_2.brand, active: true },
    });
    expect(made.status(), "the scoped code was not created").toBe(200);

    await twoBrandBasket(page);
    await page.locator("[data-promo]").fill(code);
    await page.locator("[data-applypromo]").click();
    await expect(page.locator("[data-promooff]"), "the code did not apply").toBeVisible();

    /* Ten per cent of the Kevin.Murphy line, not of the basket. PRODUCT's
       first size is the one a fresh «В корзину» adds, and PRODUCT_2 has one
       price — so both halves of the sum are known here, and the assertion is
       about the number rather than about «less than the whole». */
    const goods = PRODUCT.prices[0] + PRODUCT_2.price;
    const sum = page.locator("details[data-sum]");
    await expect(sum, "the discount was taken off the whole basket").toContainText(`−${eur(PRODUCT_2.price * 0.1, "RU")}`);
    // …and the shopper is told why it is not ten per cent of everything
    await expect(sum.locator(".cosum__scope")).toContainText(`Скидка только на ${PRODUCT_2.brand}`);
    await expect(sum.locator(".cosum__scope")).toContainText(`${eur(PRODUCT_2.price, "RU")} из ${eur(goods, "RU")}`);

    // ---- and the bill agrees with the screen ------------------------------
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
    await page.getByRole("link", { name: "Оплатить" }).click();
    await page.waitForURL(/\/shop2.*\/done\/\?.*s=paid/);

    const orders = await (await page.request.get("/api/admin/orders/?limit=5")).json();
    const order = (orders.orders as Array<{
      discount: number; discountCode: string; subtotal: number;
      discountScope: { kind: string; value: string; base: number; lines: string[] } | null;
    }>).find((o) => (o.discountCode || "").toUpperCase() === code);
    expect(order, "the paid order does not carry the code").toBeTruthy();
    expect(order!.discount).toBeCloseTo(Math.round(PRODUCT_2.price * 10) / 100, 2);
    // the order records WHAT it discounted, not only how much
    expect(order!.discountScope).toMatchObject({ kind: "brand", value: PRODUCT_2.brand });
    expect(order!.discountScope!.lines).toContain(PRODUCT_2.id);
    expect(order!.discountScope!.lines, "a line of another brand was discounted").not.toContain(PRODUCT.id);

    await page.request.patch("/api/admin/promos/", { data: { code, active: false } });
  });

  test("a code for a brand the basket does not hold is refused, by name", async ({ page }) => {
    test.setTimeout(180_000);
    await loginAsAdmin(page);
    const code = freshCode("NONE");
    await page.request.post("/api/admin/promos/", {
      data: { code, kind: "percent", value: 10, scope: "brand", scopeValue: PRODUCT_2.brand, active: true },
    });

    // one product only, and it is the other brand
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    await page.locator("[data-email]").fill(freshEmail("promo-scope-none"));
    await continueButton(page, 2).click();
    await openSummary(page);

    await page.locator("[data-promo]").fill(code);
    await page.locator("[data-applypromo]").click();
    /* Not «неверный код» — the code is perfectly valid, the basket is simply
       not the one it is for, and only the message can say which. */
    await expect(page.locator('div.err[role="alert"]'))
      .toContainText(`В корзине нет товаров ${PRODUCT_2.brand}`);
    await expect(page.locator("[data-promooff]"), "a code that matched nothing was applied").toHaveCount(0);

    await page.request.patch("/api/admin/promos/", { data: { code, active: false } });
  });
});
