/**
 * Online payment at checkout — the payment step itself, driven through the
 * mock provider (PAYMENT_PROVIDER=mock, docs/payments.md §4), which since
 * 06.09.2026 shows *which* of Montonio's pages it stands in for.
 *
 * What is pinned here, each a bug Dim hit on 06.09.2026:
 *   · Apple Pay / Google Pay reaches the card page — not the bank list it
 *     used to be folded into — and the order remembers the choice, which
 *     the admin order card shows;
 *   · the express «Купить через G Pay» button on a product page opens the
 *     checkout with the wallet already chosen;
 *   · a gift card bigger than the basket pays for all of it: no bank at
 *     all, straight to the paid receipt, the card charged once and the
 *     remainder kept;
 *   · a gift card that covers the goods but not the delivery sends the
 *     rest to the bank;
 *   · cancelling at the bank keeps the order — «Оплатить ещё раз» on the
 *     failed receipt goes back to the bank the same way, and paying there
 *     lands on the paid receipt for the same order.
 *
 * Desktop and mobile-safari, like the other functional specs (docs/testing.md).
 */
import { expect, type APIRequestContext, type Browser, type Page, test } from "@playwright/test";
import { E2E_ADMIN_PASSWORD } from "./env.mjs";
import {
  continueButton,
  freshEmail,
  functionalProject,
  ipHeaders,
  loginAsAdmin,
  openSummary,
  payButton,
  PRODUCT,
  shopUrl,
  tr,
  waitForScreen,
} from "./fixtures";

test.use({ extraHTTPHeaders: ipHeaders(45) });
test.beforeEach(async ({}, testInfo) => {
  test.skip(!functionalProject(testInfo), "functional spec — desktop and mobile-safari projects only, see docs/testing.md");
  test.setTimeout(90_000);
});

/* ------------------------------------------------------------------ */
/* One admin session for the file                                       */
/* ------------------------------------------------------------------ */

/** `POST /api/admin/login/` allows 5/min per IP (src/lib/auth.ts) — one
 *  request context, logged in once, serves every lookup below. */
let adminCtx: { close(): Promise<void>; request: APIRequestContext } | null = null;

async function admin(browser: Browser): Promise<APIRequestContext> {
  if (!adminCtx) {
    adminCtx = await browser.newContext({ extraHTTPHeaders: ipHeaders(45) });
    const login = await adminCtx.request.post("/api/admin/login/", { data: { password: E2E_ADMIN_PASSWORD } });
    expect(login.ok(), "payments: admin login").toBe(true);
  }
  return adminCtx.request;
}

test.afterAll(async () => {
  if (adminCtx) await adminCtx.close();
  adminCtx = null;
});

type AdminOrder = { number: string; status: string; total: number; payment: Record<string, unknown> | null };

/** The order as the owner's list has it — status, total and the payment blob. */
async function adminOrder(browser: Browser, number: string): Promise<AdminOrder> {
  const req = await admin(browser);
  const res = await req.get(`/api/admin/orders/?q=${encodeURIComponent(number)}`);
  expect(res.ok(), "payments: admin order lookup").toBe(true);
  const body = (await res.json()) as { orders: AdminOrder[] };
  const order = body.orders.find((o) => o.number === number);
  expect(order, `payments: order ${number} not found server-side`).toBeTruthy();
  return order!;
}

/** The cards issued for one order, through the e2e-only lookup (docs/testing.md). */
async function cardsOf(browser: Browser, number: string): Promise<Array<{ code: string; balance: number }>> {
  const req = await admin(browser);
  const res = await req.get(`/api/e2e/gift-card/?order=${number}`);
  expect(res.ok(), "payments: gift-card lookup").toBe(true);
  return ((await res.json()) as { cards: Array<{ code: string; balance: number }> }).cards;
}

/* ------------------------------------------------------------------ */
/* Walking the checkout                                                 */
/* ------------------------------------------------------------------ */

/** "12,50 €" / "€12.50" → 12.5 — `eur()`'s inverse for the Russian storefront. */
function parseEur(text: string): number {
  return Number(text.replace("€", "").replace(/[\s  ]/g, "").replace("−", "-").replace(",", "."));
}

async function addProduct(page: Page): Promise<void> {
  await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
  await waitForScreen(page, "product");
  await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
  await expect(page.getByRole("status")).toBeVisible();
}

/** Steps 1 and 2: the e-mail, then pickup (no address, no parcel feeds) or a courier to the door. */
async function toPaymentStep(page: Page, email: string, delivery: "pickup" | "courier"): Promise<void> {
  await page.goto(shopUrl("", "/checkout/"));
  await waitForScreen(page, "checkout");
  await page.locator("[data-email]").fill(email);
  await continueButton(page, 2).click();
  await page.locator(`input[data-dm="${delivery}"]`).check();
  await page.locator('[data-shipf="name"]').fill("E2E Payer");
  if (delivery === "courier") {
    await page.locator('[data-shipf="addr"]').fill("Testitänav 1");
    await page.locator('[data-shipf="zip"]').fill("10111");
    await page.locator('[data-shipf="city"]').fill("Tallinn");
  }
  await page.locator('[data-shipf="phone"]').fill("+372 5550045");
  await continueButton(page, 3).click();
}

/** Types a gift-card code into the summary and waits for the shop to take it. */
async function applyGiftCard(page: Page, code: string): Promise<void> {
  await openSummary(page);
  await page.locator("[data-promo]").fill(code);
  await page.locator("[data-applypromo]").click();
  await expect(page.locator("[data-giftoff]")).toBeVisible();
}

async function shownTotal(page: Page): Promise<number> {
  await openSummary(page);
  return parseEur((await page.locator(".cosum__row--tot .num").textContent()) || "");
}

/** The number on the receipt URL (`?n=R-100042`). */
function receiptNumber(page: Page): string {
  const n = new URL(page.url()).searchParams.get("n");
  if (!n) throw new Error(`payments: no order number on the receipt URL ${page.url()}`);
  return n;
}

/**
 * A 25 € gift card, bought through the shop itself and read back through the
 * e2e-only lookup — the same route giftcard.spec.ts uses, and the only way
 * anything can learn a real code. Bought once, spent across the tests below.
 */
let giftCode = "";
const GIFT_AMOUNT = 25;

async function ensureGiftCard(page: Page, browser: Browser): Promise<string> {
  if (giftCode) return giftCode;
  await page.goto(shopUrl("", "/gift/"));
  await waitForScreen(page, "gift");
  await page.locator(`[data-giftamt="${GIFT_AMOUNT}"]`).click();
  await page.locator('[data-giftf="name"]').fill("Payer");
  await page.locator(`[data-addgift="${GIFT_AMOUNT}"]`).click();
  await expect(page.getByRole("status")).toBeVisible();

  await page.goto(shopUrl("", "/checkout/"));
  await waitForScreen(page, "checkout");
  await page.locator("[data-email]").fill(freshEmail("pay-gift"));
  await continueButton(page, 2).click();
  // an all-gift-card order: step 2 is the recipient, «отправить мне» on by default
  await page.locator('[data-shipf="name"]').fill("E2E Payer");
  await continueButton(page, 3).click();
  await page.locator('input[data-paym="1"]').check();
  await payButton(page).click();
  await page.waitForURL(/\/api\/payments\/mock\//);
  await page.getByRole("link", { name: "Оплатить" }).click();
  await page.waitForURL(/\/shop2.*\/done\/\?.*s=paid/);

  giftOrder = receiptNumber(page);
  const cards = await cardsOf(browser, giftOrder);
  expect(cards.length, "payments: one card per gift line").toBe(1);
  expect(cards[0].balance).toBe(GIFT_AMOUNT);
  giftCode = cards[0].code;
  return giftCode;
}

/** The card's balance right now — the card is found through the order that bought it. */
let giftOrder = "";
async function giftBalance(browser: Browser): Promise<number> {
  const cards = await cardsOf(browser, giftOrder);
  const card = cards.find((c) => c.code === giftCode);
  expect(card, "payments: the gift card vanished").toBeTruthy();
  return card!.balance;
}

/* ------------------------------------------------------------------ */
/* 1. Apple Pay / Google Pay                                            */
/* ------------------------------------------------------------------ */

test.describe("payments — Apple Pay / Google Pay", () => {
  test("the wallet reaches the card page, and the order remembers the choice", async ({ page, browser }, testInfo) => {
    await addProduct(page);
    await toPaymentStep(page, freshEmail("pay-wallet"), "pickup");

    /* The bank list first — the chip the shopper leaves highlighted there must
       not travel with the wallet they switch to. */
    await page.locator('input[data-paym="0"]').check();
    await expect(page.locator(".banks [data-bank]").first()).toBeVisible();
    await page.locator('input[data-paym="2"]').check();
    await expect(page.locator(".banks")).toHaveCount(0);

    await payButton(page).click();
    await page.waitForURL(/\/api\/payments\/mock\//);
    // the card form with the wallet buttons — never the bank list
    await expect(page.locator("[data-mock-page]")).toHaveAttribute("data-mock-page", "card");
    await expect(page.locator("[data-mock-method]")).toContainText("Apple Pay / Google Pay");
    await page.getByRole("link", { name: "Оплатить" }).click();
    await page.waitForURL(/\/shop2.*\/done\/\?.*s=paid/);
    await waitForScreen(page, "done");
    await expect(page.locator("h1")).toHaveText(tr("Заказ оплачен", "RU"));
    const number = receiptNumber(page);

    const order = await adminOrder(browser, number);
    expect(order.status).toBe("paid");
    expect(order.payment?.method).toBe("wallet");
    expect(order.payment?.bank ?? null).toBeNull();
    expect(order.payment?.provider).toBe("mock");

    // …and the owner sees it on the order card (the admin is Chromium-only, docs/testing.md "Safari")
    if (testInfo.project.name !== "desktop") return;
    await loginAsAdmin(page);
    await page.locator('[data-admtab="orders"][aria-current]:visible').first().click();
    await page.locator(`[data-admorder]:has-text("${number}")`).first().click();
    await expect(page.locator(".adm-head__kicker--code")).toContainText(number);
    const pay = page.locator(".adm-kv", { hasText: "Apple Pay / Google Pay" });
    await expect(pay).toBeVisible();
    await expect(pay).toContainText("тестовый банк");
    await expect(pay).toContainText("оплачен");
  });

  test("«Купить через G Pay» opens the checkout with the wallet already chosen", async ({ page }) => {
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.btn--express[data-buynow="${PRODUCT.id}"]`).click();
    await waitForScreen(page, "checkout");

    await page.locator("[data-email]").fill(freshEmail("pay-express"));
    await continueButton(page, 2).click();
    await page.locator('input[data-dm="pickup"]').check();
    await page.locator('[data-shipf="name"]').fill("E2E Payer");
    await page.locator('[data-shipf="phone"]').fill("+372 5550045");
    await continueButton(page, 3).click();

    await expect(page.locator('input[data-paym="2"]')).toBeChecked();
    await expect(page.locator(".banks")).toHaveCount(0);

    // «Другие способы оплаты» on the same product leaves the choice alone
    // (a fresh page load: the radio starts from its default, the bank link)
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__alt [data-buynow="${PRODUCT.id}"]`).click();
    await waitForScreen(page, "checkout");
    await page.locator("[data-email]").fill(freshEmail("pay-express"));
    await continueButton(page, 2).click();
    await page.locator('input[data-dm="pickup"]').check();
    await page.locator('[data-shipf="name"]').fill("E2E Payer");
    await page.locator('[data-shipf="phone"]').fill("+372 5550045");
    await continueButton(page, 3).click();
    await expect(page.locator('input[data-paym="0"]')).toBeChecked();
  });
});

/* ------------------------------------------------------------------ */
/* 2. A gift card at the till                                           */
/* ------------------------------------------------------------------ */

test.describe("payments — a gift card at checkout", () => {
  test("a card bigger than the basket pays for all of it: no bank, straight to the receipt, charged once", async ({ page, browser }) => {
    const code = await ensureGiftCard(page, browser);
    const before = await giftBalance(browser);

    await addProduct(page);
    await toPaymentStep(page, freshEmail("pay-giftall"), "pickup");
    await page.locator('input[data-paym="0"]').check();
    await applyGiftCard(page, code);

    const total = await shownTotal(page);
    expect(total).toBe(0);
    const goods = parseEur((await page.locator(".cosum__line .cosum__pr").first().textContent()) || "");
    expect(goods).toBeGreaterThan(0);
    // the remainder is shown, not swallowed
    await expect(page.locator(".cosum__row--note .num")).toHaveText(new RegExp(String(before - goods).replace(".", ",")));

    await payButton(page).click();
    // no bank page in between — the receipt straight away, paid
    await page.waitForURL(/\/shop2.*\/done\/\?.*s=paid/);
    await waitForScreen(page, "done");
    expect(page.url()).not.toMatch(/\/api\/payments\/mock\//);
    await expect(page.locator("h1")).toHaveText(tr("Заказ оплачен", "RU"));
    const number = receiptNumber(page);

    const order = await adminOrder(browser, number);
    expect(order.status).toBe("paid");
    expect(order.total).toBe(0);
    expect(order.payment?.provider).toBe("none");
    expect(order.payment?.method).toBe("giftcard");
    // charged exactly the goods, once — reloading the receipt changes nothing
    expect(await giftBalance(browser)).toBeCloseTo(before - goods, 2);
    await page.reload();
    await waitForScreen(page, "done");
    expect(await giftBalance(browser)).toBeCloseTo(before - goods, 2);
    expect((await adminOrder(browser, number)).status).toBe("paid");
  });

  test("a card that covers the goods but not the delivery sends the rest to the bank", async ({ page, browser }) => {
    const code = await ensureGiftCard(page, browser);
    const before = await giftBalance(browser);
    expect(before).toBeGreaterThan(0);

    await addProduct(page);
    await toPaymentStep(page, freshEmail("pay-giftpart"), "courier");
    await page.locator('input[data-paym="1"]').check();
    await applyGiftCard(page, code);

    const total = await shownTotal(page);
    const goods = parseEur((await page.locator(".cosum__line .cosum__pr").first().textContent()) || "");
    const delivery = parseEur((await page.locator(".cosum__row--rule .num").last().textContent()) || "");
    // 25 € bought a 9 € basket above, so 16 € are left: the goods and part of the courier
    expect(delivery).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(0);
    expect(Math.round(total * 100)).toBe(Math.round((goods + delivery - Math.min(before, goods + delivery)) * 100));

    await payButton(page).click();
    await page.waitForURL(/\/api\/payments\/mock\//);
    // the bank is asked for exactly the remainder
    await expect(page.locator(".sum")).toHaveText(`${total.toFixed(2).replace(".", ",")} €`);
    // nothing taken off the card until the bank says paid
    expect(await giftBalance(browser)).toBe(before);
    await page.getByRole("link", { name: "Оплатить" }).click();
    await page.waitForURL(/\/shop2.*\/done\/\?.*s=paid/);
    await waitForScreen(page, "done");

    const order = await adminOrder(browser, receiptNumber(page));
    expect(order.status).toBe("paid");
    expect(Math.round(order.total * 100)).toBe(Math.round(total * 100));
    expect(await giftBalance(browser)).toBeCloseTo(Math.max(0, before - (goods + delivery)), 2);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Cancelling at the bank, and trying again                          */
/* ------------------------------------------------------------------ */

test.describe("payments — cancelled at the bank", () => {
  test("«Оплатить ещё раз» takes the same order back to the same bank, and paying there lands on its receipt", async ({ page, browser }) => {
    await addProduct(page);
    await toPaymentStep(page, freshEmail("pay-again"), "pickup");
    await page.locator('input[data-paym="0"]').check();
    // the second bank chip, so the retry can be seen carrying a real choice
    const chips = page.locator(".banks [data-bank]");
    await expect(chips.first()).toBeVisible();
    await chips.nth(1).click();
    await expect(chips.nth(1)).toHaveAttribute("aria-current", "true");

    await payButton(page).click();
    await page.waitForURL(/\/api\/payments\/mock\//);
    await expect(page.locator("[data-mock-page]")).toHaveAttribute("data-mock-page", "bank");
    const bankLine = (await page.locator("[data-mock-method]").textContent()) || "";
    expect(bankLine).toMatch(/банковская ссылка · [A-Z0-9]{8,11}/);

    await page.getByRole("link", { name: "Отменить" }).click();
    await page.waitForURL(/\/shop2.*\/done\/\?.*s=failed/);
    await waitForScreen(page, "done");
    await expect(page.locator("h1")).toHaveText(tr("Оплата не прошла", "RU"));
    const number = receiptNumber(page);
    const orderId = new URL(page.url()).searchParams.get("o") || "";
    expect(orderId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await adminOrder(browser, number)).status).toBe("failed");
    // the basket was emptied on the way to the bank — the order is what a second try is about
    await expect(page.locator("[data-cartbadge]")).toHaveText("");

    await page.locator("[data-payagain]").click();
    await page.waitForURL(/\/api\/payments\/mock\//);
    // the same order, the same bank — nothing had to be chosen again
    await expect(page.locator(".ref").first()).toContainText(number);
    await expect(page.locator("[data-mock-method]")).toHaveText(bankLine);
    await page.getByRole("link", { name: "Оплатить" }).click();
    await page.waitForURL(/\/shop2.*\/done\/\?.*s=paid/);
    await waitForScreen(page, "done");
    expect(receiptNumber(page)).toBe(number);
    await expect(page.locator("h1")).toHaveText(tr("Заказ оплачен", "RU"));

    const order = await adminOrder(browser, number);
    expect(order.status).toBe("paid");
    expect(order.payment?.method).toBe("bank");
    // the paid receipt carries no order id, and a paid order cannot be sent to the bank again
    expect(new URL(page.url()).searchParams.get("o")).toBeNull();
    const again = await page.request.post("/api/payments/create/", { data: { orderId } });
    expect(again.status()).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe("already_paid");
  });
});
