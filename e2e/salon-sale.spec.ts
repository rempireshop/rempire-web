/**
 * «Продажа в салоне» — the till, end to end, for the one thing it used to get
 * wrong: a sale rung up in the room is a purchase like any other.
 *
 * Until 07.09.2026 POST /api/admin/pos-orders/ created the order, marked it
 * paid and took the stock by hand, bypassing settlePayment() — so a salon sale
 * earned no loyalty points, wrote no `purchase` row for «Аналитика» and sent
 * the customer nothing at all, while the screen next to the e-mail box implied
 * a receipt. This walks the cashier's own path and checks the outcome the
 * customer sees: the receipt screen says the letter went, and the e2e mail
 * sink has it.
 *
 * Chromium only, like every other admin spec (docs/testing.md «Safari»).
 */
import { expect, test } from "@playwright/test";
import { freshEmail, ipHeaders, PRODUCT } from "./fixtures";
import { assertClean, clearToast, openAdmin, tab, watch } from "./sweep-helpers";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === "mobile-safari", "the admin panel is Chromium-only, see docs/testing.md");
});

test.describe("the salon till", () => {
  test.use({ extraHTTPHeaders: ipHeaders(201) });

  test("a sale with an e-mail is settled like a payment: the receipt says the letter went, and it did", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    const email = freshEmail("salon-buyer");

    await openAdmin(page);
    await tab(page, "pos");

    // one chip is the whole «add»: search, tap the size, it is in the basket
    await page.locator("[data-posq]").fill(PRODUCT.id);
    await page.locator(`[data-posadd^="${PRODUCT.id}:"]`).first().click();
    await expect(page.locator(".adm-posline")).toHaveCount(1);

    /* The promise being tested is the one the e-mail box makes (1a: its
       placeholder; the sentence itself is behind «?»): type an address and
       the letter with the receipt goes to it. */
    await expect(page.locator("[data-posemail]")).toHaveAttribute("placeholder", "придёт чек и баллы");
    await page.locator("[data-posemail]").fill(email);

    /* money goes through the confirm sheet, here as everywhere in the panel —
       «К оплате» is the one dark button and carries the method picked above
       it, cash unless changed: chip, «К оплате», «Оформить» */
    await page.locator('[data-possend="cash"]').click();
    await expect(page.locator(".adm-confirm__t")).toHaveText("Оформить продажу?");
    await expect(page.locator(".adm-confirm__d")).toContainText("наличные");
    await page.locator("[data-admapply]").click();

    await expect(page.locator("[data-posnew]"), "the sale never reached a receipt").toBeVisible();
    const number = ((await page.locator(".adm-receipt__id").first().textContent()) || "").trim();
    expect(number, "the receipt has no order number").toMatch(/^R-/);
    // «1 поз. · наличные · остатки списаны · чек ушёл на почту» — the last
    // clause only appears because the server really answered `mailed: true`
    await expect(page.locator(".adm-receipt")).toContainText("наличные");
    await expect(page.locator(".adm-receipt")).toContainText("чек ушёл на почту");
    await assertClean(page, w, "salon receipt");

    /* The letter itself, in the e2e mail sink: the RECEIPT, to the address the
       cashier typed, exactly once. This is the whole point — the old path sent
       nothing at all, and then (07.09.2026) sent «Заказ принят», which
       promises to write again when the order is ready about goods the customer
       carried out of the room. Renat, 13.09.2026: «The receipt should also
       land in the users e-mail.» */
    const sink = async (template: string, to: string) =>
      (await (await page.request.get(`/api/e2e/mail/?template=${template}&to=${encodeURIComponent(to)}`)).json())
        .mails as Array<{ subject: string }>;
    await expect.poll(async () => (await sink("pos-receipt", email)).length).toBe(1);
    expect((await sink("pos-receipt", email))[0].subject).toContain(number);
    expect(await sink("order-confirmed", email)).toHaveLength(0);

    /* …and the order behind it is a paid order like any other: the salon chip
       finds it, the card says «Оплачен», and the payment blob still carries
       the method the cashier pressed rather than only the provider. */
    await tab(page, "orders");
    /* Found by its number, not by a «Салон» chip: the six order chips became
       four on 07.09.2026 («Отправить · В пути · По счёту · Все», Dim's answer),
       and the till's own chip went with them. The `salon` filter still exists
       behind admOrderMatches() for the assistant's deep links; nothing in the
       panel draws it any more. Searching is what the owner would do anyway, and
       the search deliberately looks past whichever chip is lit. */
    await page.locator("[data-admorderq]").fill(number);
    const row = page.locator(`[data-admorder]:has-text("${number}")`).first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.locator(".adm-head__kicker--code")).toContainText(number);
    // the badge on a till sale is «Салон» — where it was sold, not its status;
    // the status is asserted on the row the panel itself reads, just below
    await expect(page.locator(".adm-badge--big")).toHaveText("Салон");

    const found = (await (await page.request.get(`/api/admin/orders/?q=${encodeURIComponent(number)}`)).json()) as {
      orders: Array<{ number: string; status: string; payment: Record<string, unknown> }>;
    };
    const order = found.orders.find((o) => o.number === number)!;
    expect(order.status).toBe("paid");
    expect(order.payment).toMatchObject({ provider: "pos", method: "cash", status: "paid" });
    await assertClean(page, w, "salon order card");
  });

  test("a walk-in with no e-mail goes through and promises no letter", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);

    await openAdmin(page);
    await tab(page, "pos");
    await page.locator("[data-posq]").fill(PRODUCT.id);
    await page.locator(`[data-posadd^="${PRODUCT.id}:"]`).first().click();
    // «Терминал» is a pick now; the one «К оплате» then sends a terminal sale
    await page.locator('[data-pospay="terminal"]').click();
    await page.locator('[data-possend="terminal"]').click();
    await page.locator("[data-admapply]").click();

    await expect(page.locator("[data-posnew]")).toBeVisible();
    await expect(page.locator(".adm-receipt")).toContainText("остатки списаны");
    // nobody was told anything, and the screen does not pretend otherwise
    await expect(page.locator(".adm-receipt")).not.toContainText("чек ушёл на почту");
    await assertClean(page, w, "walk-in receipt");

    await page.locator("[data-posnew]").click();
    await clearToast(page);
  });

  /* 1a (the design's «USB-сканер работает прямо в поле поиска»): a handheld
     scanner types the code into the box and ends it with Enter. A bound code
     names one bottle, so Enter rings that bottle up — and the box empties, so
     the next code is not typed onto the end of this one. */
  test("a handheld scanner: a code and Enter in the search box ring up that bottle", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    const ean = `29${Date.now().toString().slice(-10)}`;
    const variant = PRODUCT.sizes[1];

    await openAdmin(page);
    const bound = await page.request.put("/api/admin/inventory/", { data: { productId: PRODUCT.id, variant, ean } });
    expect(bound.ok(), "could not bind the test code").toBe(true);
    // the register reads the shelf copy for its codes: the owner's next visit
    await page.reload();
    await tab(page, "pos");

    const box = page.locator("[data-posq]");
    await box.fill(ean);
    await expect(page.locator(`#poslist [data-posadd]`)).toHaveCount(1);
    await box.press("Enter");
    await expect(page.locator(".adm-posline")).toHaveCount(1);
    await expect(page.locator(".adm-posline").first()).toContainText(variant);
    await expect(box, "the box kept the code, so the next scan would be glued onto it").toHaveValue("");
    // the same bottle again is the same line, one more
    await box.fill(ean);
    await box.press("Enter");
    await expect(page.locator(".adm-posline .adm-step-qty__v").first()).toHaveText("2");
    await assertClean(page, w, "salon Enter from a handheld scanner");

    await page.locator("[data-posremove]").first().click();
    await expect(page.locator(".adm-posline")).toHaveCount(0);
  });
});
