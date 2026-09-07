import { expect, type Locator, type Page, test } from "@playwright/test";
import { freshEmail, ipHeaders, loginAsAdmin, payOrder, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

/**
 * «Which one am I pointing at?» — the admin's list rows.
 *
 * Dim, 07.09.2026: «на странице заказов при наведении на заказ (как на других
 * страницах) должно быть видно, на какой заказ мы наводим.» An orders row is a
 * wrapper with a button inside it, and that button carries `background:none`
 * in a style attribute — which beats any class, so the panel's `:hover` tint
 * had nothing to paint. This file holds every list Renat scans to the same
 * three promises: the pointer lights the whole row, an ink bar says which one
 * without relying on the tint, and Tab lights the same row the mouse would.
 *
 * Desktop only for the hover half (a phone has no pointer); the focus half is
 * the keyboard's, which is the laptop too.
 */

const PAPER = "rgb(255, 255, 255)";
const TINT = "rgb(246, 244, 238)";

async function bg(row: Locator): Promise<string> {
  return row.evaluate((el) => getComputedStyle(el).backgroundColor);
}
/** The 3-px ink bar in the row's left bleed — 1 when lit, 0 when not. */
async function barOpacity(row: Locator): Promise<number> {
  return row.evaluate((el) => Number(getComputedStyle(el, "::before").opacity));
}

/** Hovering `row` lights it and leaves `other` alone.
 *  Polled throughout: the panel's rows fade in (`adm-up`) and the tint itself
 *  is a .12 s transition, so a single read can land mid-animation. */
async function expectHoverLights(page: Page, row: Locator, other: Locator, what: string): Promise<void> {
  await page.mouse.move(0, 0);
  await expect.poll(() => bg(row), { message: `${what}: a row is tinted before anything is hovered` }).toBe(PAPER);
  await row.hover();
  await expect.poll(() => bg(row), { message: `${what}: hover does not tint the row` }).toBe(TINT);
  await expect.poll(() => barOpacity(row), { message: `${what}: no ink bar on the hovered row` }).toBe(1);
  expect(await bg(other), `${what}: the neighbour lit up too`).toBe(PAPER);
  expect(await barOpacity(other), `${what}: the neighbour got a bar too`).toBe(0);
}

test.describe("admin — the row under the pointer", () => {
  test.use({ extraHTTPHeaders: ipHeaders(153) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "hover is the laptop's; a phone has no pointer");
  });

  test("«Заказы»: the row under the pointer, and the row the keyboard is in", async ({ page }) => {
    test.setTimeout(180_000);

    // two paid orders, so "this one and not that one" is a real question
    for (const tag of ["rows-a", "rows-b"]) {
      await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
      await waitForScreen(page, "product");
      await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
      await expect(page.getByRole("status")).toBeVisible();
      await page.goto(shopUrl("", "/checkout/"));
      await waitForScreen(page, "checkout");
      await payOrder(page, freshEmail(tag), "paid");
    }

    await loginAsAdmin(page);
    await page.locator('[data-admtab="orders"][aria-current]:visible').first().click();
    const rows = page.locator("#orderlist .adm-row--open");
    await expect(rows.nth(1), "two paid orders should be waiting").toBeVisible();

    await expectHoverLights(page, rows.nth(0), rows.nth(1), "orders");
    await expectHoverLights(page, rows.nth(1), rows.nth(0), "orders, the second one");

    // the keyboard gets the same band: focus anything inside a row and the
    // WHOLE row lights, not just the button
    await page.mouse.move(0, 0);
    await expect.poll(() => bg(rows.nth(1))).toBe(PAPER);
    await rows.nth(1).locator("[data-admorder]").focus();
    await expect.poll(() => bg(rows.nth(1)), { message: "focus does not light the row" }).toBe(TINT);
    expect(await barOpacity(rows.nth(1)), "focus draws no ink bar").toBe(1);
    expect(await bg(rows.nth(0)), "the other row lit up on focus").toBe(PAPER);
  });

  test("the other lists Renat scans: товары, клиенты, промокоды, блог", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);

    // «Товары» — the row IS the button here, so the same rules have to reach it
    await page.locator('[data-admtab="goods"][aria-current]:visible').first().click();
    const goods = page.locator("#goodslist .adm-row--click");
    await expect(goods.nth(1)).toBeVisible();
    await expectHoverLights(page, goods.nth(0), goods.nth(1), "products");

    // «Маркетинг → Промокоды» — a wrapper row with a switch beside the name;
    // focusing the SWITCH lights the row too, which is how you know which
    // code you are about to switch off
    await page.locator('[data-admtab="promos"][aria-current]:visible').first().click();
    const code = `ROW${Date.now().toString().slice(-7)}`;
    for (const suffix of ["A", "B"]) {
      await page.locator("[data-admpromonew]").click();
      await page.locator('[data-promof="code"]').fill(code + suffix);
      await page.locator('[data-promokind="percent"]').click();
      await page.locator('[data-promof="value"]').fill("5");
      await page.locator("[data-admpromosave]").click();
      await expect(page.locator(`[data-admpromotoggle="${code}${suffix}"]`)).toBeVisible();
    }
    const promoRow = (s: string) => page.locator(".adm-row--open", { has: page.locator(`[data-admpromotoggle="${code}${s}"]`) });
    await expectHoverLights(page, promoRow("A"), promoRow("B"), "promo codes");
    await page.mouse.move(0, 0);
    await page.locator(`[data-admpromotoggle="${code}B"]`).focus();
    await expect.poll(() => bg(promoRow("B")), { message: "the switch's row does not light on focus" }).toBe(TINT);

    // «Блог» — the row is the button again
    await page.locator('[data-admtab="blog"][aria-current]:visible').first().click();
    const posts = page.locator("[data-admblogedit]");
    if ((await posts.count()) > 1) await expectHoverLights(page, posts.nth(0), posts.nth(1), "blog posts");

    // «Клиенты» — a wrapper row; the suite's shop has at least the buyers the
    // orders above made
    await page.locator('[data-admtab="people"][aria-current]:visible').first().click();
    const people = page.locator(".adm-row--open", { has: page.locator("[data-admcustopen]") });
    if ((await people.count()) > 1) await expectHoverLights(page, people.nth(0), people.nth(1), "customers");
  });
});
