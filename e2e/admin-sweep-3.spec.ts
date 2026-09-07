import { expect, type Page, test } from "@playwright/test";
import { continueButton, freshEmail, ipHeaders, loginAsAdmin, payButton, PRODUCT_2, payOrder, shopUrl, waitForScreen } from "./fixtures";
import { assertClean, watch } from "./sweep-helpers";

/**
 * The third admin sweep (docs/audit/2026-09-06-admin-qa.md): the screens that
 * said one thing while the shop did another, and the two lists that offered a
 * step the card behind them refuses.
 *
 *   - «Отменить заказ» no longer promises that the money comes back and a
 *     letter goes out — setOrderStatus() returns the stock and nothing else,
 *     and there is no cancellation template in src/emails/ at all;
 *   - a paid gift-card-only order has no «Отправлен» in the list, because its
 *     card has none either — one tap used to mail «Заказ отправлен», with a
 *     tracking number it does not have, about nothing;
 *   - the orders search says out loud that the chip filter is off while it
 *     searches every order;
 *   - «Письма»: «Товар снова в наличии» starts off, like the sender reads it,
 *     and the birthday row says the day it actually sends on;
 *   - «Салон» points at the receipt link instead of a receipt letter nothing
 *     sends;
 *   - the dumb-user corners: an empty search, a pasted 400-character name,
 *     emoji, and the browser's Back in the middle of an edit.
 *
 * Desktop and mobile: the phone is the owner's machine and the confirm card
 * is a sheet on it. Each describe has its own fake IP — admin login is 5/min
 * (docs/testing.md).
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === "tablet" || testInfo.project.name === "mobile-safari", "admin sweep — desktop and mobile projects only");
});

/** A quick, throwaway paid order (the same recipe admin-sweep-2.spec.ts uses). */
async function placeOrder(page: Page, email: string): Promise<string> {
  await page.goto(shopUrl("", `/p/${PRODUCT_2.id}/`));
  await waitForScreen(page, "product");
  await page.locator(`.pdp__add[data-add="${PRODUCT_2.id}"]`).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto(shopUrl("", "/checkout/"));
  await waitForScreen(page, "checkout");
  return payOrder(page, email, "paid");
}

/** A paid order whose basket is one gift card — shipping method «digital». */
async function placeGiftOrder(page: Page, email: string): Promise<string> {
  await page.goto(shopUrl("", "/gift/"));
  await waitForScreen(page, "gift");
  await page.locator('[data-giftamt="25"]').click();
  await page.locator('[data-addgift="25"]').click();
  await expect(page.getByRole("status")).toBeVisible();

  await page.goto(shopUrl("", "/checkout/"));
  await waitForScreen(page, "checkout");
  await page.locator("[data-email]").fill(email);
  await continueButton(page, 2).click();
  // the card goes to the buyer — «отправить мне на почту» is on by default
  await expect(page.locator("[data-gifttome]")).toBeChecked();
  await page.locator('[data-shipf="name"]').fill("E2E Buyer");
  await continueButton(page, 3).click();
  await page.locator('input[data-paym="1"]').check();
  await payButton(page).click();
  await page.waitForURL(/\/api\/payments\/mock\//);
  await page.getByRole("link", { name: "Оплатить" }).click();
  await page.waitForURL(/\/shop2.*\/done\/\?.*s=paid/);
  const number = new URL(page.url()).searchParams.get("n");
  if (!number) throw new Error("placeGiftOrder: no order number (?n=) in the receipt URL");
  return number;
}

function ordersTab(page: Page) {
  return page.locator('[data-admtab="orders"][aria-current]:visible').first();
}

/** Opens one of the five places on either viewport (on a phone the last six
    sit behind «Ещё» — the same helper admin-sweep-2.spec.ts uses). */
async function section(page: Page, key: string): Promise<void> {
  const direct = page.locator(`[data-admtab="${key}"][aria-current]:visible`);
  if (await direct.count()) await direct.first().click();
  else {
    await page.locator("[data-admmore]:visible").click();
    await page.locator(`.adm-sheet [data-admtab="${key}"]`).click();
  }
}

/** «Письма» is a tab inside «Маркетинг» — section, then tab (admin-mail.spec.ts). */
async function openMailList(page: Page): Promise<void> {
  await section(page, "promos");
  await page.locator('[data-admtab="mail"][aria-current]:visible').first().click();
  await expect(page.locator("[data-mailtpl]").first()).toBeVisible();
}

test.describe("admin sweep 3 — «Отменить заказ» says what really happens", () => {
  test.use({ extraHTTPHeaders: ipHeaders(196) });

  /* The card was corrected twice. First (06.09.2026) it stopped promising a
     letter and a refund that nothing sent: cancelling only moved the status
     and put the shelf back. Then (07.09.2026) the letter was actually built,
     so the card says it goes — and the money moved to its own button,
     «Вернуть деньги», which is the only thing on this screen that sends any.
     The rule the test is really holding is the one that has not changed: the
     card describes what happens, not what would be nice. */
  test("the card names the stock and the letter, and sends nobody to Montonio for the money", async ({ page }) => {
    test.setTimeout(120_000);
    const number = await placeOrder(page, freshEmail("sweep3-cancel"));
    await loginAsAdmin(page);
    await ordersTab(page).click();
    await page.locator(`[data-admorder]:has-text("${number}")`).first().click();
    await expect(page.locator(".adm-head__kicker--code")).toContainText(number);

    await page.locator("[data-admordercancel]").click();
    const card = page.locator(".adm-confirm");
    await expect(card.locator(".adm-confirm__t")).toHaveText("Отменить заказ?");
    const detail = card.locator(".adm-confirm__d");
    await expect(detail).toContainText(number);
    // what the server really does: the shelf comes back and the customer is told
    await expect(detail).toContainText("товары вернутся на склад");
    await expect(detail).toContainText("клиенту уйдёт письмо «Заказ отменён»");
    // …and what it does not do: cancelling moves no money, and the card names
    // the button that does rather than sending Renat off to Montonio
    await expect(detail).toContainText("Деньги отмена не возвращает");
    await expect(detail).toContainText("«Вернуть деньги»");
    await expect(detail).not.toContainText("Письмо не уходит");
    await expect(detail).not.toContainText("Деньги вернутся клиенту");

    // and that button is really there, on a paid order with money left to send back
    await expect(page.locator("[data-admrefund]")).toBeVisible();

    // «Отмена» leaves the order where it was
    await page.locator("[data-admcancel]").click();
    await expect(page.locator(".adm-confirm")).toHaveCount(0);
    const status = async () =>
      (await (await page.request.get(`/api/admin/orders/${number}/`)).json()).order.status as string;
    expect(await status()).toBe("paid");
  });
});

test.describe("admin sweep 3 — a gift-card order has no parcel step", () => {
  test.use({ extraHTTPHeaders: ipHeaders(197) });

  test("«Отправлен» is offered neither on the row nor on the card", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one viewport is enough — the rule is in admOrderStepBtn");
    test.setTimeout(120_000);
    const number = await placeGiftOrder(page, freshEmail("sweep3-gift"));

    await loginAsAdmin(page);
    await ordersTab(page).click();
    // «Все», so the row is found whatever chip the panel opened on
    await page.locator('[data-admfilter="all"]').click();
    await page.locator("[data-admorderq]").fill(number);
    const row = page.locator(".adm-row", { hasText: number }).first();
    await expect(row).toBeVisible();
    // the badge still says the money is in…
    await expect(row.locator(".adm-badge")).toHaveText("Оплачен");
    // …and there is no step to take: no label, no «Отправлен», no «Выдан»
    await expect(row.locator("[data-admshipnow]")).toHaveCount(0);
    await expect(row.locator("[data-admlabel]")).toHaveCount(0);
    await expect(row.locator("[data-admdelivered]")).toHaveCount(0);

    await page.locator(`[data-admorder]:has-text("${number}")`).first().click();
    await expect(page.locator(".adm-head__kicker--code")).toContainText(number);
    // the card has always hidden the steps for a digital order; the row now agrees
    await expect(page.locator("[data-admshipnow]")).toHaveCount(0);
    await expect(page.locator("[data-admlabel]")).toHaveCount(0);
    await expect(page.locator("[data-admdelivered]")).toHaveCount(0);
    // what it does offer: the card as a file, and a letter the owner writes
    await expect(page.locator("[data-giftpdf]").first()).toBeVisible();
    await expect(page.locator("[data-admorderreply]")).toBeVisible();
  });
});

test.describe("admin sweep 3 — the orders search says the filter is off", () => {
  test.use({ extraHTTPHeaders: ipHeaders(198) });

  test("a typed search admits it looks past the chip, and stops saying so when cleared", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one viewport is enough for a filter");
    test.setTimeout(120_000);
    const number = await placeOrder(page, freshEmail("sweep3-filter"));
    await loginAsAdmin(page);
    await ordersTab(page).click();

    // a chip that cannot contain a freshly paid order
    await page.locator('[data-admfilter="delivered"]').click();
    await expect(page.locator(`[data-admorder]:has-text("${number}")`)).toHaveCount(0);
    const hint = page.locator("#orderlist .adm-hint");
    await expect(hint).toHaveCount(0);

    // typing finds it anyway — and the list says why the chip stopped mattering
    await page.locator("[data-admorderq]").fill(number);
    await expect(page.locator(`[data-admorder]:has-text("${number}")`).first()).toBeVisible();
    await expect(hint).toHaveText("Ищем по всем заказам — фильтр сейчас не действует.");
    // the chip is still the one the owner will come back to
    await expect(page.locator('[data-admfilter="delivered"]')).toHaveAttribute("aria-current", "true");

    // clearing the box puts the filter back, and takes the line away with it
    await page.locator("[data-admorderq]").fill("");
    await expect(hint).toHaveCount(0);
    await expect(page.locator(`[data-admorder]:has-text("${number}")`)).toHaveCount(0);

    // «Все» + a search needs no line: nothing is being overridden
    await page.locator('[data-admfilter="all"]').click();
    await page.locator("[data-admorderq]").fill(number);
    await expect(hint).toHaveCount(0);
  });
});

test.describe("admin sweep 3 — «Письма» and «Салон» describe themselves truthfully", () => {
  test.use({ extraHTTPHeaders: ipHeaders(199) });

  test("the back-in-stock switch starts off, the birthday row names the right day, the salon hint names the link", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    await loginAsAdmin(page);

    await openMailList(page);

    /* «Товар снова в наличии» is off on a shop that has never touched the
       switch — the same default FLOW_DEFAULTS (src/lib/flows.ts) reads. It
       used to draw itself on while the sender read it as off, so the row
       claimed to be mailing a queue nobody was mailing. */
    const backstock = page.locator('[data-admflow="backstock"]');
    await expect(backstock).toHaveAttribute("aria-pressed", "false");
    await expect(backstock).toHaveAttribute("aria-label", "Включить письмо");
    const flows = await (await page.request.get("/api/overrides/")).json();
    expect(flows.settings.flows.backstock, "the shop's own default disagrees with the switch").toBe(false);

    // …and the birthday row names the day runBirthdays() actually sends on
    const birthday = page.locator(".adm-row", { hasText: "Скидка ко дню рождения" }).first();
    await expect(birthday).toContainText("в день рождения");
    await expect(birthday).not.toContainText("за 3 дня");
    await assertClean(page, w, "the mail list");

    /* «Салон»: the receipt is a link on the order, not a letter — POST
       /api/admin/pos-orders/ sends nothing at all. */
    await section(page, "pos");
    await expect(page.locator(".adm-hint", { hasText: "Покупатель не обязателен" }).first())
      .toContainText("письмом он не уходит");
    await expect(page.locator(".adm-hint", { hasText: "чек письмом" })).toHaveCount(0);
    await assertClean(page, w, "the salon register");
  });
});

test.describe("admin sweep 3 — the corners a hurried owner finds", () => {
  test.use({ extraHTTPHeaders: ipHeaders(200) });

  test("an empty search, a pasted essay, emoji and the Back button leave the panel standing", async ({ page }) => {
    test.setTimeout(150_000);
    const w = watch(page);
    // the shop first, so the panel has something behind it in history — this
    // is how the owner really arrives, and the Back step below needs it
    await page.goto(shopUrl("", "/"));
    await waitForScreen(page, "home");
    await loginAsAdmin(page);

    /* ---- «Заказы»: a search that matches nothing, and one made of spaces -- */
    await ordersTab(page).click();
    const q = page.locator("[data-admorderq]");
    await q.fill("   ");
    // a query of nothing but spaces is no query: the chip's own list comes back
    await expect(page.locator("#orderlist .adm-hint")).toHaveCount(0);
    await q.fill("нет-такого-заказа-🙃");
    await expect(page.locator(".adm-empty")).toHaveText("Таких заказов нет");
    await assertClean(page, w, "orders: a search that finds nothing");
    await q.fill("");

    /* ---- «Товары»: a 400-character name and emoji in the search ---------- */
    await section(page, "goods");
    const goodsQ = page.locator("[data-goodsq]");
    await goodsQ.fill("ш".repeat(400));
    await expect(page.locator(".adm-empty")).toBeVisible();
    await assertClean(page, w, "goods: a 400-character search");
    await goodsQ.fill("🙈🙉🙊");
    await assertClean(page, w, "goods: an emoji search");
    await goodsQ.fill("");

    /* ---- «Клиенты»: the same, plus a filter chip ------------------------- */
    await section(page, "people");
    const custQ = page.locator("[data-admcustq]");
    await custQ.fill("  \t  ");
    await assertClean(page, w, "customers: a whitespace search");
    await custQ.fill("<script>alert(1)</script>");
    await assertClean(page, w, "customers: a script tag in the search");
    await custQ.fill("");

    /* ---- the browser's Back in the middle of an edit ---------------------
       The panel is one URL: opening a product pushes no history entry, so Back
       leaves the panel altogether rather than closing the editor. That is a
       question for the owner (docs/audit/2026-09-06-admin-qa.md), not a bug to
       fix behind his back — what has to hold is that nothing breaks and that
       the half-typed price never reached the shop. */
    await section(page, "goods");
    await page.locator("[data-admgoods]").first().click();
    // «Сохранить» carries the open product's id — it is on both editors, the
    // catalogue one and the owner's own (edPaneMain / edPaneMainOwn)
    await expect(page.locator("[data-admsavegoods]")).toBeVisible();
    await page.locator('[data-edtab="sizes"]').click();
    await page.locator("[data-edprice]").first().fill("999999999");
    await page.goBack();
    // it lands in the shop, not on «Товары» — one URL, no history of its own
    await waitForScreen(page, "home");
    await assertClean(page, w, "goods: Back out of an open editor");
    // …and nothing of that half-typed price survived into the shop
    const priced = await (await page.request.get("/api/overrides/")).json();
    for (const o of Object.values(priced.overrides || {}) as Array<{ price?: number }>) {
      expect(Number(o.price ?? 0), "an abandoned edit reached the price list").toBeLessThan(10_000);
    }

    /* ---- coming back lands on the panel, still signed in, nothing half-open */
    await page.goto(shopUrl("", "/admin/"));
    await waitForScreen(page, "admin");
    await expect(page.locator("[data-admpw]")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator(".adm-confirm")).toHaveCount(0);
    await expect(page.locator("[data-admsavegoods]")).toHaveCount(0);
    await assertClean(page, w, "the panel after coming back");
  });
});
