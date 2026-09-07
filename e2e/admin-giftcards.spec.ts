import { expect, type Page, test } from "@playwright/test";
import {
  adminSection, continueButton, freshEmail, ipHeaders, loginAsAdmin, payButton, shopUrl,
  waitForScreen,
} from "./fixtures";

/**
 * The gift-card blocks in the panel — «Маркетинг → Подарочные карты» and the
 * gift-card lines on an order card.
 *
 * Dim, 07.09.2026: «код карты и кнопка „Карта PDF“ должны быть хотя бы на
 * разных строках — сейчас они одной строкой.» They were one anchor holding
 * both, so the code — which is money, and gets read aloud, copied and typed —
 * could not be looked at without looking at a button, and on a phone the pair
 * wrapped in the middle of the code. This file measures the fix the way the
 * complaint was made: are they on different lines, and is the button a button.
 *
 * While we were there: the issued list had no way to get the card itself and
 * no expiry date. Both are here now, from the same two derived fields the
 * order card already used (src/app/api/admin/giftcards/route.ts).
 */

/** Buys one 25 € gift card and returns the order number. */
async function buyGiftCard(page: Page): Promise<string> {
  await page.goto(shopUrl("", "/gift/"));
  await waitForScreen(page, "gift");
  await page.locator('[data-giftamt="25"]').click();
  await page.locator('[data-giftf="name"]').fill("Mari");
  await page.locator('[data-addgift="25"]').click();
  await expect(page.getByRole("status")).toBeVisible();

  await page.goto(shopUrl("", "/checkout/"));
  await waitForScreen(page, "checkout");
  await page.locator("[data-email]").fill(freshEmail("giftrow"));
  await continueButton(page, 2).click();
  await page.locator('[data-shipf="name"]').fill("E2E Buyer");
  await continueButton(page, 3).click();
  await page.locator('input[data-paym="1"]').check();
  await payButton(page).click();
  await page.waitForURL(/\/api\/payments\/mock\//);
  await page.getByRole("link", { name: "Оплатить" }).click();
  await page.waitForURL(/\/shop2.*\/done\/\?.*s=paid/);
  const number = new URL(page.url()).searchParams.get("n");
  if (!number) throw new Error("no order number on the receipt");
  return number;
}

/** True when `a` sits entirely above `b` — the question Dim actually asked. */
async function isAbove(page: Page, a: string, b: string): Promise<boolean> {
  const top = await page.locator(a).first().boundingBox();
  const bottom = await page.locator(b).first().boundingBox();
  if (!top || !bottom) throw new Error(`no box for ${a} or ${b}`);
  return top.y + top.height <= bottom.y + 1;
}

test.describe("admin — the gift-card blocks read as lines, not as one", () => {
  test.use({ extraHTTPHeaders: ipHeaders(155) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name === "tablet", "desktop and phone are the two designed layouts");
  });

  test("the code is one line and «Карта PDF ↗» is the next — on the order card and in «Маркетинг»", async ({ page }) => {
    test.setTimeout(150_000);
    const number = await buyGiftCard(page);
    await loginAsAdmin(page);

    // ---- the order card ----------------------------------------------------
    await page.locator('[data-admtab="orders"][aria-current]:visible').first().click();
    await page.locator('[data-admfilter="all"]').click();
    await page.locator(`[data-admorder]:has-text("${number}")`).first().click();
    await expect(page.locator(".adm-gifts__code")).toBeVisible();
    const pdf = page.locator("[data-giftpdf]").first();
    await expect(pdf).toContainText("Карта PDF");
    expect(await isAbove(page, ".adm-gifts__code", "[data-giftpdf]"),
      "the code and «Карта PDF ↗» are still on one line").toBe(true);
    // the code is text to copy, not part of a link
    await expect(page.locator(".adm-gifts__code a")).toHaveCount(0);
    // …and the button is a button-sized target, not an 18-px text link
    const box = (await pdf.boundingBox())!;
    expect(Math.round(box.height), "«Карта PDF ↗» is not a 44-px target").toBeGreaterThanOrEqual(40);

    // ---- «Маркетинг → Подарочные карты» ------------------------------------
    /* «Маркетинг» is one of the six behind «Ещё» on a phone, so the section is
       opened through the helper both viewports share, not by a selector that
       only exists on a desktop. */
    await adminSection(page, "promos", "gift");
    const row = page.locator(".adm-row--stack", { has: page.locator("[data-giftpdf]") }).first();
    await expect(row, "the issued card has no «Карта PDF ↗» of its own").toBeVisible();
    const code = row.locator(".adm-mono").first();
    await expect(code).toHaveText(/^RMP-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const rowCode = (await code.boundingBox())!;
    const rowPdf = (await row.locator("[data-giftpdf]").boundingBox())!;
    expect(rowCode.y + rowCode.height, "the issued card's code and its button share a line")
      .toBeLessThanOrEqual(rowPdf.y + 1);
    // the card says when it stops being money the shop owes
    await expect(row).toContainText("Действует до");
  });
});
