import { expect, type Page, test } from "@playwright/test";
import { adminSection, continueButton, freshEmail, ipHeaders, loginAsAdmin, payButton, payOrder, PRODUCT, shopUrl, waitForScreen } from "./fixtures";
import { pdfRuns } from "../tests/pdf-text";

/**
 * Round 16 — the four things Renat found in the orders section on his phone.
 *
 * Every test here starts from a real order paid through the mock bank, because
 * every one of them is about a row of «Заказы» as he actually sees it.
 */

/** A paid pickup («Самовывоз») order — the one whose next step is «Выдан клиенту». */
async function pickupOrder(page: Page, tag: string): Promise<string> {
  await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
  await waitForScreen(page, "product");
  await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto(shopUrl("", "/checkout/"));
  await waitForScreen(page, "checkout");
  await page.locator("[data-email]").fill(freshEmail(tag));
  await continueButton(page, 2).click();
  await page.locator('input[data-dm="pickup"]').check();
  await page.locator('[data-shipf="name"]').fill("E2E Pickup");
  await page.locator('[data-shipf="phone"]').fill("+372 5550001");
  await continueButton(page, 3).click();
  await page.locator('input[data-paym="1"]').check();
  await payButton(page).click();
  await page.waitForURL(/\/api\/payments\/mock\//);
  await page.getByRole("link", { name: "Оплатить" }).click();
  await page.waitForURL(/\/shop2.*\/done\/\?.*s=paid/);
  const number = new URL(page.url()).searchParams.get("n");
  if (!number) throw new Error("pickupOrder: no order number on the receipt");
  return number;
}

/**
 * «Выдан клиенту» «worked only on second click in the list row» (13.09.2026).
 *
 * Two things were true at once. The action line of a pickup row is the row's
 * whole width and the button was the left 130 px of it — the rest belonged to
 * the row's opener (`data-admrowopen`), so a thumb landing beside the button
 * opened the order card instead. And a status has no local copy, so even a tap
 * that DID land left the row saying «Выдан клиенту» over «Оплачен» until a
 * PATCH and a reload had both come back, which reads as nothing happening.
 *
 * Phone only: the action line is the phone's layout (`admin.css`,
 * `.adm-row--lines`); a desktop lays the same row out in one line.
 */
test.describe("admin — «Выдан клиенту» takes one tap", () => {
  test.use({ extraHTTPHeaders: ipHeaders(241) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the action line is the phone's layout");
  });

  test("the lone action fills the line, and one tap hands the order over", async ({ page }) => {
    test.setTimeout(180_000);
    const number = await pickupOrder(page, "r16-pickup");

    await loginAsAdmin(page);
    await adminSection(page, "orders");
    const row = page.locator("#orderlist .adm-row--lines").filter({ hasText: number }).first();
    await expect(row, "the order is not under the opening chip").toBeVisible();

    // 1. there is no blank left to miss: the one action IS the action line
    const acts = row.locator(".adm-acts");
    const button = row.locator("[data-admdelivered]");
    await expect(button).toHaveText("Выдан клиенту");
    const [lineBox, buttonBox] = [await acts.boundingBox(), await button.boundingBox()];
    expect(lineBox!.width - buttonBox!.width, "the action does not fill its line").toBeLessThanOrEqual(1);
    expect(buttonBox!.height, "the action is under a thumb's size").toBeGreaterThanOrEqual(44);

    // 2. a tap at the far right of that line is the action, not the card
    await acts.click({ position: { x: lineBox!.width - 6, y: lineBox!.height / 2 } });
    await expect(page.locator('[data-admorder=""]'), "the tap opened the order card").toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("выдан клиенту");

    // 3. …and the row says so at once, without waiting for the server
    await expect(row.locator("[data-admdelivered]"), "the row still offers the step it just took").toHaveCount(0);

    // 4. the step really did land
    await expect.poll(async () => row.locator(".adm-badge").first().innerText(), {
      timeout: 15_000, message: "the order never reached «Доставлен»",
    }).toBe("Доставлен");
  });
});

/**
 * «I think also in orders section we should initially show "all"», and «a
 * return … needs a separate category as it's quite hard to find that order».
 */
test.describe("admin — «Заказы» opens on «Все» and has a place for returns", () => {
  test.use({ extraHTTPHeaders: ipHeaders(242) });

  test("«Все» leads and is lit; the steps and «Возвраты» are each one tap", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    const number = await payOrder(page, freshEmail("r16-all"), "paid");

    await loginAsAdmin(page);
    await adminSection(page, "orders");

    const chips = page.locator("#app [data-admfilter]");
    await expect(chips.first(), "«Все» is not the first chip").toHaveText(/^Все/);
    await expect(page.locator('[data-admfilter="all"]'), "the screen does not open on «Все»")
      .toHaveAttribute("aria-current", "true");
    // a paid order is in the opening list without touching a chip
    await expect(page.locator("#orderlist .adm-row--lines").filter({ hasText: number })).toBeVisible();

    // every state filter is still one tap from here, in the order they happen
    for (const key of ["new", "shipped", "invoice", "returns"]) {
      const chip = page.locator(`[data-admfilter="${key}"]`);
      await expect(chip, `«${key}» is not on the strip`).toHaveCount(1);
      await chip.scrollIntoViewIfNeeded();
      await chip.click();
      await expect(chip).toHaveAttribute("aria-current", "true");
    }

    /* «Возвраты» holds nothing but return requests, and this brand-new paid
       order is not one. (Not «the list is empty»: the suite shares one
       database and an earlier spec may well have left a request in it.) */
    await expect(page.locator('[data-admfilter="returns"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator("#orderlist"), "a plain paid order turned up under «Возвраты»")
      .not.toContainText(number);
    await expect(page.locator("#orderlist")).toContainText(/Таких заказов нет|Просит возврат/);
  });

  test("a customer's return request lands on its own chip, and is marked in «Все»", async ({ page }) => {
    test.setTimeout(240_000);
    const email = freshEmail("r16-return");
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    const number = await payOrder(page, email, "paid");

    // the owner takes it all the way to «Доставлен» — a return can only be
    // asked for on a delivered order (src/lib/returns.ts canRequestReturn)
    await loginAsAdmin(page);
    const patch = async (status: string) => {
      const res = await page.request.patch(`/api/admin/orders/${encodeURIComponent(number)}/`, { data: { status } });
      expect(res.status(), `the order would not move to ${status}`).toBe(200);
    };
    await patch("shipped");
    await patch("delivered");

    /* …and the customer ticks «Хочу вернуть заказ» in their own account. The
       route is the customer's, not the admin's: it needs their signed-in
       cookie, which `page.request` shares with the page. The tick itself is
       covered end to end in account.spec.ts — here it is only the thing that
       has to happen before the panel can be looked at. */
    await page.goto(shopUrl("", "/account/"));
    await waitForScreen(page, "account");
    await page.locator("[data-email]").fill(email);
    const codeResponse = page.waitForResponse((r) => r.url().includes("/api/account/code/"));
    await page.locator("[data-login]").click();
    const codeBody = (await (await codeResponse).json()) as { ok: boolean; code?: string };
    await page.locator("[data-acctcode]").fill(codeBody.code!);
    await page.locator("[data-logincode]").click();
    await expect(page.locator("[data-logout]")).toBeVisible();
    const asked = await page.request.post("/api/account/return-request/", { data: { number } });
    expect(asked.status(), "the return request was refused").toBe(200);

    await page.goto(shopUrl("", "/admin/"));
    await adminSection(page, "orders");
    const chip = page.locator('[data-admfilter="returns"]');
    await expect.poll(async () => chip.innerText(), { timeout: 15_000, message: "the chip never counted the request" })
      .toMatch(/Возвраты\s+\d/);

    // in «Все» the row itself says what is being asked about the order
    const row = page.locator("#orderlist .adm-row--lines").filter({ hasText: number }).first();
    await expect(row).toContainText("Просит возврат");

    // and the chip holds it — and holds nothing that was not asked about
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    const rows = page.locator("#orderlist .adm-row--lines");
    await expect(rows.filter({ hasText: number }), "the request is not under its own chip").toHaveCount(1);
    // …every one of them is a return: still asking, or already refunded
    for (const row of await rows.all()) await expect(row).toContainText(/Просит возврат|Возврат/);
  });
});

/**
 * «There is no link to that payment at the bank — just an id.» Montonio
 * publishes no address for a single payment, so the id is made to travel: one
 * tap copies it and the line says where to paste it.
 */
test.describe("admin — the payment's number can be taken away", () => {
  test.use({ extraHTTPHeaders: ipHeaders(243) });

  test("the order card offers the payment number with a copy button", async ({ page, context }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    const number = await payOrder(page, freshEmail("r16-payref"), "paid");

    await loginAsAdmin(page);
    await adminSection(page, "orders");
    await page.locator("[data-admorderq]").fill(number);
    await page.locator(`#orderlist [data-admorder]:has-text("${number}")`).first().click();
    await expect(page.locator(".adm-head__kicker--code")).toContainText(number);

    const ref = page.locator("[data-payref]");
    await expect(ref, "the order card shows no payment number").toBeVisible();
    const id = (await ref.innerText()).trim();
    expect(id, "the mock bank's own reference is not on the card").toMatch(/^mock_/);
    // it left the muted grey line it used to be buried in
    await expect(page.locator(".adm-kv").filter({ hasText: "оплачен" })).not.toContainText(id);

    // the button — the number itself copies on a tap too (24.09.2026), so the attribute alone matches two
    await page.locator(`button[data-admcopy="${id}"]`).click();
    await expect(page.getByRole("status")).toContainText("Номер платежа скопирован");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(id);
  });
});

/**
 * «No drop-off code for the locker is shown», «the address or any information
 * from order is not printed on the PDF».
 *
 * The A4 sheet — the one the panel's button opens, and the one Renat's office
 * printer prints — now carries the order under the label: the drop-off code in
 * big figures, where the parcel goes, who is waiting for it, the tracking
 * number and what is inside. A6 is the bare sticker and stays that way.
 *
 * The carrier here is the e2e stand-in (SHIPPING_PROVIDER=mock), whose parcel
 * carries a drop-off PIN exactly as Montonio's does.
 */
test.describe("admin — the label sheet carries the order", () => {
  test.use({ extraHTTPHeaders: ipHeaders(244) });

  test("the A4 sheet prints the drop-off code and the delivery details; A6 does not", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    const number = await payOrder(page, freshEmail("r16-label"), "paid");

    await loginAsAdmin(page);
    const booked = await page.request.post("/api/admin/shipments/", { data: { orderId: number } });
    expect(booked.status(), "the parcel was not registered").toBe(200);
    const shipment = ((await booked.json()) as { shipment: { dropOffPin: string; trackingCode: string } }).shipment;
    expect(shipment.dropOffPin, "the carrier returned no drop-off code").toBeTruthy();

    const label = await page.request.get(`/api/admin/shipments/${number}/label/?size=A4`);
    expect(label.status()).toBe(200);
    expect(label.headers()["content-type"]).toContain("application/pdf");
    const runs = pdfRuns(new Uint8Array(await label.body()));
    const text = runs.map((r) => r.text);

    expect(text, "the sheet has no drop-off code").toContain(shipment.dropOffPin);
    expect(text.join(" · "), "the sheet does not name the order").toContain(number);
    expect(text.join(" · "), "the sheet does not say where the parcel goes").toMatch(/Куда/);
    expect(text.join(" · "), "the sheet does not say who is waiting for it").toContain("E2E Buyer");
    expect(text.join(" · "), "the sheet has no tracking number").toContain(shipment.trackingCode);

    // the code is the biggest thing on the sheet — it is read standing at a machine
    const pin = runs.find((r) => r.text === shipment.dropOffPin)!;
    for (const r of runs) if (r !== pin) expect(r.size).toBeLessThan(pin.size);

    // …and the thermal sticker is untouched: none of the shop's faces are on it
    const a6 = await page.request.get(`/api/admin/shipments/${number}/label/?size=A6`);
    expect(a6.status()).toBe(200);
    for (const r of pdfRuns(new Uint8Array(await a6.body()))) {
      expect(r.font, "the A6 sticker carries the slip").not.toMatch(/Oswald|GolosText|PTMono/);
    }
  });
});
