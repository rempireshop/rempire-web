import { expect, type Page, test } from "@playwright/test";
import { freshEmail, ipHeaders, payOrder, PRODUCT, PRODUCT_2, shopUrl, waitForScreen } from "./fixtures";
import {
  assertClean, clearToast, EMOJI, freshShop, HTML_BOMB, isRussian, LONG, openAdmin, tab, toastText, watch,
} from "./sweep-helpers";

/**
 * Admin panel fuzz sweep, part 3: the warehouse, the in-salon register, the
 * customer cards and the blog — every screen that writes straight to a route
 * with no draft/undo layer in front of it (docs/inventory.md, docs/blog.md),
 * so a bad value here is immediately real.
 *
 * See sweep-admin.spec.ts's header for the house rules this file follows too.
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "admin sweep — desktop project only, see docs/testing.md");
});

/**
 * A warehouse row is a product×VARIANT (`data-stockedit="<id> <size>"`, see
 * catalogueUniverse() in src/lib/inventory.ts) — PRODUCT_2 alone has two.
 * Everything below therefore works from one row key rather than a product id,
 * so "the count went up" and "the count came back down" are about the same
 * shelf.
 */
async function firstStockKey(page: Page, query: string): Promise<string> {
  await tab(page, "stock");
  await expect(page.locator("#stocklist")).toBeVisible();
  await page.locator("[data-stockq]").fill(query);
  const edit = page.locator('[data-stockedit]:not([data-stockedit=""])').first();
  await expect(edit, `nothing in the warehouse matches "${query}"`).toBeVisible();
  const key = await edit.getAttribute("data-stockedit");
  if (!key) throw new Error(`no row key for "${query}"`);
  return key;
}

/**
 * Opens the row edit form for one exact key — or leaves it open if it already
 * is. stockRowHTML() blanks the row's own `data-stockedit` while its form is
 * showing (the link turns into «Свернуть»), so "click the row" is only right
 * when the form is closed; `data-stocksave` is what carries the key either way.
 */
async function openStockRow(page: Page, key: string): Promise<void> {
  await tab(page, "stock");
  await page.locator("[data-stockq]").fill(key.split(" ")[0]);
  if (!(await page.locator(`[data-stocksave="${key}"]`).count())) {
    await page.locator(`[data-stockedit="${key}"]`).click();
  }
  await expect(page.locator(`[data-stocksave="${key}"]`)).toBeVisible();
}

/**
 * The count the warehouse actually holds for one row, read from the route the
 * panel itself reads — the assertion is about the number that was stored, not
 * about which grid cell it landed in.
 */
async function stockQty(page: Page, key: string): Promise<number | null> {
  const productId = key.split(" ")[0];
  const variant = key.slice(productId.length + 1);
  const res = await page.request.get(`/api/admin/inventory/?filter=all&q=${encodeURIComponent(productId)}`);
  const rows = (await res.json()).levels as Array<{ productId: string; variant: string; tracked: boolean; qty: number }>;
  const row = rows.find((r) => r.productId === productId && (r.variant || "") === variant);
  return row && row.tracked ? row.qty : null;
}

test.describe("sweep — warehouse", () => {
  test.use({ extraHTTPHeaders: ipHeaders(160) });

  test("counts refuse garbage instead of zeroing themselves, EANs round-trip, the ledger and the scanner open", async ({ page }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    await openAdmin(page);

    // A real count to work against — everything below has to leave it alone.
    const key = await firstStockKey(page, PRODUCT_2.id);
    await openStockRow(page, key);
    await page.locator("[data-stockqtyinput]").fill("5");
    await page.locator("[data-stockreasoninput]").fill("пересчёт на полке");
    await page.locator("[data-stocksave]").click();
    await clearToast(page);
    expect(await stockQty(page, key), "setting the count to 5 did not take").toBe(5);
    // …and the grid shows the same number the route holds.
    await tab(page, "stock");
    await page.locator("[data-stockq]").fill(PRODUCT_2.id);
    await expect(page.locator(`[data-stockedit="${key}"]`).locator("xpath=..")).toContainText("5");
    await assertClean(page, w, "stock set to 5");

    // The dangerous ones. A count is money on a shelf: a value the panel
    // cannot read must be refused out loud, never quietly turned into 0.
    for (const bad of ["abc", "-1", "1e9"]) {
      await openStockRow(page, key);
      await page.locator("[data-stockqtyinput]").fill(bad);
      await page.locator("[data-stocksave]").click();
      const msg = await toastText(page);
      expect(msg, `count "${bad}" was accepted with no message at all`).not.toBe("");
      expect(isRussian(msg), `count "${bad}": message is not Russian — "${msg}"`).toBe(true);
      expect(msg, `count "${bad}" reported success`).not.toMatch(/Сохранено/);
      await clearToast(page);
      expect(await stockQty(page, key), `count "${bad}" changed the real quantity`).toBe(5);
      await assertClean(page, w, `stock qty "${bad}"`);
    }

    // 2.5 bottles is not a thing — whole units either way, never a crash.
    await openStockRow(page, key);
    await page.locator("[data-stockqtyinput]").fill("2.5");
    await page.locator("[data-stocksave]").click();
    await clearToast(page);
    const after = await stockQty(page, key);
    expect(Number.isInteger(after), `a fractional count was stored as ${after}`).toBe(true);
    await assertClean(page, w, "stock qty 2.5");

    // 0 is a legitimate count — sold out is a fact, not an error.
    await openStockRow(page, key);
    await page.locator("[data-stockqtyinput]").fill("0");
    await page.locator("[data-stocksave]").click();
    await clearToast(page);
    expect(await stockQty(page, key)).toBe(0);
    await openStockRow(page, key);
    await page.locator("[data-stockqtyinput]").fill("8");
    await page.locator("[data-stocksave]").click();
    await clearToast(page);

    // ---- EAN --------------------------------------------------------------
    const ean = `47400${Date.now().toString().slice(-8)}`;
    await openStockRow(page, key);
    await page.locator("[data-stockeaninput]").fill(ean);
    await page.locator("[data-stocksave]").click();
    await clearToast(page);
    await openStockRow(page, key);
    expect(await page.locator("[data-stockeaninput]").inputValue(), "the EAN did not round-trip").toBe(ean);
    await assertClean(page, w, "EAN bound");

    // The same code on a different product must be refused — two products
    // sharing a barcode makes every future scan a coin toss — and the refusal
    // has to say so, in Russian.
    // A different product — the sweep deliberately crosses the product
    // boundary, not just the variant one.
    const otherKey = await firstStockKey(page, PRODUCT.id);
    expect(otherKey.split(" ")[0], "picked the same product twice").not.toBe(PRODUCT_2.id);
    // This step provokes the route's own `ean_taken` 400 on purpose; the
    // assertion that counts is the sentence the owner sees, just below.
    w.allow.push(/\/api\/admin\/inventory\//);
    await openStockRow(page, otherKey);
    await page.locator("[data-stockeaninput]").fill(ean);
    await page.locator("[data-stocksave]").click();
    const dupMsg = await toastText(page);
    expect(dupMsg, "a duplicate EAN was accepted silently").not.toBe("");
    expect(isRussian(dupMsg), `duplicate EAN message is not Russian — "${dupMsg}"`).toBe(true);
    expect(dupMsg, "a duplicate EAN reported success").not.toMatch(/^Сохранено/);
    expect(dupMsg, "the refusal does not say the code belongs to another product")
      .toMatch(/штрихкод|код/i);
    await clearToast(page);
    await assertClean(page, w, "duplicate EAN refused");

    // Whatever the shop chooses to accept as a barcode, it must come back
    // exactly as typed rather than half-stored.
    await openStockRow(page, key);
    await page.locator("[data-stockeaninput]").fill("abc");
    await page.locator("[data-stocksave]").click();
    await clearToast(page);
    await openStockRow(page, key);
    const round = await page.locator("[data-stockeaninput]").inputValue();
    expect(["abc", ean, ""], `a barcode came back as "${round}"`).toContain(round);
    await page.locator("[data-stockeaninput]").fill("");
    await page.locator("[data-stocksave]").click();
    await clearToast(page);
    await assertClean(page, w, "EAN cleared");

    // ---- the ledger --------------------------------------------------------
    await tab(page, "stock");
    await page.locator('[data-stockmovesopen="1"]').click();
    await expect(page.getByText("История приёмок и продаж")).toBeVisible();
    for (const reason of ["", "goods_in", "sale_pos", "adjust", "return"]) {
      await page.locator(`[data-stockmovesreason="${reason}"]`).click();
      await assertClean(page, w, `moves filtered by "${reason || "all"}"`);
    }
    await page.locator('[data-stockmovesopen=""]').click();
    await expect(page.locator("#stocklist")).toBeVisible();

    // ---- the scanner --------------------------------------------------------
    // Headless Chromium has no camera. The overlay must still open, say so in
    // Russian, and leave the manual field usable — that is the keyboard-wedge
    // path a USB scanner uses anyway (docs/inventory.md).
    /* Two controls open the scanner on «Склад» since the redesign — the
       header's «Приёмка» and the screen's own «Сканировать» (README § Товары);
       either does, so take the first. */
    await page.locator("[data-scanopen]").first().click();
    await expect(page.locator("[data-scanmanual]")).toBeVisible();
    await assertClean(page, w, "scanner opened without a camera");
    await page.locator("[data-scanmanual]").fill("нет-такого-кода");
    await page.locator("[data-scanmanualsubmit]").click();
    await expect(page.locator("#scanpanel")).toContainText(/не привязан|Найдите товар/);
    await assertClean(page, w, "scanner manual entry, unknown code");
    await page.locator("[data-scanclose]").click();
    await expect(page.locator("[data-scanmanual]")).toHaveCount(0);
    await assertClean(page, w, "scanner closed");
  });
});

test.describe("sweep — the in-salon register", () => {
  test.use({ extraHTTPHeaders: ipHeaders(161) });

  test("an empty sale cannot be sent, quantities clamp, both payment methods work, stock follows", async ({ page }) => {
    test.setTimeout(150_000);
    const w = watch(page);
    await openAdmin(page);

    await tab(page, "pos");
    // «Наличные» / «Терминал» are the two ways to finish a sale since the
    // redesign — an empty cart must leave both of them dead.
    await expect(page.locator('[data-possend="cash"]'), "an empty sale could be submitted").toBeDisabled();
    await expect(page.locator('[data-possend="terminal"]'), "an empty sale could be submitted").toBeDisabled();
    await assertClean(page, w, "register, empty cart");

    // One 44-h chip per size — the chip IS the «add», and it carries the size
    // index so the register never has to guess which bottle was meant.
    await page.locator("[data-posq]").fill(PRODUCT_2.id);
    await page.locator(`[data-posadd^="${PRODUCT_2.id}:"]`).first().click();

    // The line's own quantity cell — the number between the two ± buttons.
    const line = page.locator(".adm-posline", { has: page.locator('[data-posqty="0:-1"]') });
    const qty = line.locator(".adm-step-qty__v").first();

    // The chip that was tapped is the product's first size; give THAT shelf a
    // known count, so "the sale decremented it" is a fact and not an inference.
    const sub = ((await line.locator(".adm-row__sub").first().textContent()) || "").trim();
    const variant = sub.split("·")[0].trim();
    const key = `${PRODUCT_2.id} ${variant}`;
    await openStockRow(page, key);
    await page.locator("[data-stockqtyinput]").fill("20");
    await page.locator("[data-stocksave]").click();
    await clearToast(page);
    expect(await stockQty(page, key), "the register's shelf was not set to 20").toBe(20);
    await tab(page, "pos");

    // − at one must stay at one, never 0 or −1: a line worth nothing is a
    // receipt the owner cannot explain.
    await page.locator('[data-posqty="0:-1"]').click();
    await page.locator('[data-posqty="0:-1"]').click();
    await expect(qty, "the register let a line drop below one").toHaveText("1");
    for (let i = 0; i < 3; i++) await page.locator('[data-posqty="0:1"]').click();
    await expect(qty).toHaveText("4");
    await assertClean(page, w, "register quantity clamps");

    // Discount: letters are not a percentage, and the total on screen has to
    // be the total that is charged.
    await page.locator("[data-posdiscount]").fill("abc");
    expect(await page.locator("[data-posdiscount]").inputValue(), "letters got into the discount box").toBe("");
    await page.locator("[data-posdiscount]").fill("999");
    const typed = await page.locator("[data-posdiscount]").inputValue();
    expect(Number(typed), "the discount box accepted more than 100 %").toBeLessThanOrEqual(99);
    await page.locator("[data-posdiscount]").fill("10");
    await assertClean(page, w, "register discount");

    // Remove a line, then rebuild the sale.
    await page.locator("[data-posremove]").first().click();
    await expect(page.locator('[data-possend="terminal"]')).toBeDisabled();
    await page.locator("[data-posq]").fill(PRODUCT_2.id);
    await page.locator(`[data-posadd^="${PRODUCT_2.id}:"]`).first().click();
    await page.locator("[data-posemail]").fill(freshEmail("sweep-pos"));

    // What the screen promises and what the receipt says have to agree — the
    // discount is applied twice over, once here and once on the server.
    const shownTotal = ((await page.locator(".adm-total__v").first().textContent()) || "").trim();
    // money goes through the confirm card, and the card lists what is about
    // to be charged before anything is charged
    await page.locator('[data-possend="terminal"]').click();
    await expect(page.locator(".adm-confirm__d")).toContainText(shownTotal);
    await page.locator("[data-admapply]").click();
    await expect(page.locator("[data-posnew]"), "the sale never reached a receipt").toBeVisible();
    const number = ((await page.locator(".adm-receipt__id").first().textContent()) || "").trim();
    expect(number, "the receipt has no order number").toMatch(/^R-/);
    const receiptTotal = ((await page.locator(".adm-receipt__sum").first().textContent()) || "").trim();
    expect(receiptTotal, "the receipt total is not the total that was on screen").toBe(shownTotal);
    // «N поз. · терминал · остатки списаны» — the method the owner pressed
    await expect(page.locator(".adm-receipt")).toContainText("терминал");
    await assertClean(page, w, "register receipt");

    // The printable receipt is a real document, not a dead link.
    const href = await page.locator("[href*='/receipt/']").getAttribute("href");
    const receipt = await page.request.get(href!);
    expect(receipt.status(), "the printable receipt 404s").toBe(200);
    expect(receipt.headers()["content-type"]).toContain("text/html");

    /* The sale is an order like any other, tagged as a shop-floor one — and
       «Заказы» opens on «Новые» (paid web orders waiting to go out), so the
       salon chip is what brings it into view. */
    await tab(page, "orders");
    await page.locator('[data-admfilter="salon"]').click();
    const salonRow = page.locator(`[data-admorder]:has-text("${number}")`).first();
    await expect(salonRow).toBeVisible();
    await expect(page.locator(".adm-badge--tint").first()).toHaveText("Салон");
    await salonRow.click();
    // the redesigned card: the order number is the mono kicker above the title
    await expect(page.locator(".adm-head__kicker--code")).toContainText(number);
    await assertClean(page, w, "register order in Заказы");

    // …and one unit left the shelf.
    expect(await stockQty(page, key), "the shelf count did not follow the sale").toBe(19);
    await assertClean(page, w, "stock after the register sale");

    await tab(page, "pos");
    if (await page.locator("[data-posnew]").count()) await page.locator("[data-posnew]").click();
    // Leave the shelf well stocked: this product is now *tracked*, and every
    // other spec that buys it (admin.spec.ts, checkout.spec.ts) decrements
    // the same count — at zero it would stop being addable at all.
    await openStockRow(page, key);
    await page.locator("[data-stockqtyinput]").fill("500");
    await page.locator("[data-stocksave]").click();
    await clearToast(page);
  });
});

test.describe("sweep — customers", () => {
  test.use({ extraHTTPHeaders: ipHeaders(162) });

  test("a real customer: partner request rejected, then approved, points bounded, notes escaped", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const w = watch(page);

    // A customer only exists once somebody buys something.
    const email = freshEmail("sweep-cust");
    const shopCtx = await browser.newContext({ extraHTTPHeaders: ipHeaders(163) });
    const shopper = await shopCtx.newPage();
    await shopper.goto(shopUrl("", `/p/${PRODUCT_2.id}/`));
    await waitForScreen(shopper, "product");
    await shopper.locator(`.pdp__add[data-add="${PRODUCT_2.id}"]`).click();
    await expect(shopper.getByRole("status")).toBeVisible();
    await shopper.goto(shopUrl("", "/checkout/"));
    await waitForScreen(shopper, "checkout");
    await payOrder(shopper, email, "paid");

    // Sign that customer in and file a partner request, so the owner has one
    // to act on. Done over the same API the account screen calls, because
    // this test is about the ADMIN side of the queue, not the request form.
    await shopper.goto(shopUrl("", "/account/"));
    await waitForScreen(shopper, "account");
    await shopper.locator("[data-email]").fill(email);
    const codeRes = shopper.waitForResponse((r) => r.url().includes("/api/account/code/"));
    await shopper.locator("[data-login]").click();
    const code = (await (await codeRes).json()).code as string;
    await shopper.locator("[data-acctcode]").fill(code);
    await shopper.locator("[data-logincode]").click();
    await expect(shopper.locator("[data-logout]")).toBeVisible();
    const proReq = await shopper.request.post("/api/account/pro-request/", {
      data: { company: "Salon Sweep OÜ", regCode: "12345678", phone: "+372 5550002" },
    });
    expect(proReq.ok()).toBe(true);

    await openAdmin(page);
    await tab(page, "people");
    await page.locator("[data-admcustq]").fill(email);
    const open = page.locator("[data-admcustopen]").first();
    await expect(open).toBeVisible();
    await open.click();
    // The address is on the card twice (heading + contact line) — the
    // heading is the one that says the right customer is open.
    await expect(page.getByRole("heading", { name: email })).toBeVisible();
    await assertClean(page, w, "customer card");

    // Reject, then let them ask again, then approve — both halves of the queue.
    await page.locator("[data-admcustreject]").click();
    expect(await toastText(page)).toMatch(/[Оо]тклон/);
    await clearToast(page);
    await assertClean(page, w, "partner request rejected");

    expect((await shopper.request.post("/api/account/pro-request/", {
      data: { company: "Salon Sweep OÜ", regCode: "12345678", phone: "+372 5550002" },
    })).ok()).toBe(true);
    await page.reload();
    await waitForScreen(page, "admin");
    await tab(page, "people");
    await page.locator("[data-admcustq]").fill(email);
    await page.locator("[data-admcustopen]").first().click();
    await page.locator("[data-admcustapprove]").click();
    expect(await toastText(page)).toMatch(/[Оо]добрен/);
    await clearToast(page);
    await expect(page.locator(".chip", { hasText: "партнёр" }).first()).toBeVisible();
    await assertClean(page, w, "partner approved");

    // ---- points ------------------------------------------------------------
    const balance = async () => {
      const res = await page.request.get(`/api/admin/customers/${encodeURIComponent(email)}/`);
      return Number((await res.json()).customer.pointsBalance);
    };

    await page.locator("[data-admcustpoints]").fill("abc");
    await page.locator("[data-admcustadjust]").click();
    const badMsg = await toastText(page);
    expect(isRussian(badMsg), `points "abc": message is not Russian — "${badMsg}"`).toBe(true);
    await clearToast(page);
    expect(await balance(), "«abc» moved the balance").toBe(0);
    await assertClean(page, w, "points abc");

    // ±1e9 is meant to be refused; the route answers 400 and Chromium logs
    // it. What has to hold is the balance and the message, both below.
    w.allow.push(/\/api\/admin\/customers\//);
    for (const huge of ["1000000000", "-1000000000"]) {
      await page.locator("[data-admcustpoints]").fill(huge);
      await page.locator("[data-admcustnote]").fill("fuzz");
      await page.locator("[data-admcustadjust]").click();
      const msg = await toastText(page);
      expect(msg, `points "${huge}" happened with no message`).not.toBe("");
      expect(isRussian(msg), `points "${huge}": message is not Russian — "${msg}"`).toBe(true);
      await clearToast(page);
      // A billion loyalty points is a billion euros of liability on a shop
      // that does three orders a month — a typo, not an intention.
      expect(Math.abs(await balance()), `a balance of ±1e9 was written for "${huge}"`).toBeLessThan(1e6);
      await assertClean(page, w, `points "${huge}"`);
    }

    // A real, small adjustment still has to work.
    await page.locator("[data-admcustpoints]").fill("15");
    await page.locator("[data-admcustnote]").fill("извинение за задержку");
    await page.locator("[data-admcustadjust]").click();
    expect(await toastText(page)).toMatch(/[Бб]аллы/);
    await clearToast(page);
    await expect.poll(balance, { timeout: 8000 }).toBe(15);
    await assertClean(page, w, "points adjusted");

    // ---- notes -------------------------------------------------------------
    await page.locator("[data-admcustnotesf]").fill(`Заметка ${HTML_BOMB} ${EMOJI}`);
    await page.locator("[data-admcustsavenotes]").click();
    expect(await toastText(page)).toMatch(/[Зз]аметка/);
    await clearToast(page);
    await page.reload();
    await waitForScreen(page, "admin");
    await tab(page, "people");
    await page.locator("[data-admcustq]").fill(email);
    await page.locator("[data-admcustopen]").first().click();
    await expect(page.locator("[data-admcustnotesf]")).toHaveValue(/Заметка <script>/);
    expect(await page.locator(".adm-page script").count(), "the note ran as script in the panel").toBe(0);
    await assertClean(page, w, "customer note with HTML");

    // Leave the customer as a plain retail one again.
    await page.locator("[data-admcustdemote]").click();
    await clearToast(page);
    await shopCtx.close();
  });
});

test.describe("sweep — blog", () => {
  test.use({ extraHTTPHeaders: ipHeaders(164) });

  test("a post with garbage in every field is refused, published, escaped in the shop, then withdrawn", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const w = watch(page);
    await openAdmin(page);
    await tab(page, "blog");

    await page.locator("[data-admblognew]").click();
    await expect(page.locator('[data-blogf="title"]')).toBeVisible();

    // No title at all is not a post — and the panel has to say why rather
    // than posting a blank row into the shop's blog.
    await page.locator("[data-admblogsave]").click();
    // the editor is adm- markup since the phase-3 redesign
    const err = page.locator(".adm-err[role=alert]");
    await expect(err, "an untitled post saved without complaint").toBeVisible();
    expect(isRussian((await err.textContent()) || "")).toBe(true);
    await assertClean(page, w, "blog, empty title");

    const marker = `Свип ${Date.now().toString().slice(-6)}`;
    await page.locator('[data-blogf="title"]').fill(`${marker} ${HTML_BOMB}`);
    // the address, the author and the Google text sit in a fold-out now
    await page.locator("[data-blogmore]").click();
    await page.locator("[data-blogslug]").fill("Привет Мир!!/../%2e%2e");
    const slug = await page.locator("[data-blogslug]").inputValue();
    expect(slug, "a slug kept characters that cannot be in a URL").toMatch(/^[a-z0-9-]*$/);
    await page.locator('[data-blogf="excerpt"]').fill(EMOJI);
    /* The body is a contenteditable now (docs/blog.md — the visual editor),
       so the bomb is TYPED into it, exactly as the owner would paste it in.
       Typed markup is text: the box holds it escaped, and the shop below has
       to print it rather than run it. */
    await page.locator("[data-blogbody]").click();
    await page.keyboard.type(`${HTML_BOMB} Обычный абзац.`);
    expect(await page.locator("[data-blogbody] script").count(), "the editor ran the owner's paste").toBe(0);
    await page.locator('[data-blogf="seoTitle"]').fill(LONG);
    expect((await page.locator('[data-blogf="seoTitle"]').inputValue()).length).toBeLessThanOrEqual(70);
    await page.locator("[data-admblogq]").fill(PRODUCT_2.id);
    await page.locator(`[data-admblogproductadd="${PRODUCT_2.id}"]`).click();
    await assertClean(page, w, "blog draft filled");

    await page.locator("[data-admblogsave]").click();
    expect(await toastText(page)).toMatch(/[Чч]ерновик|[Сс]охранен/);
    await clearToast(page);
    await assertClean(page, w, "blog draft saved");

    /* What the public feed itself carries. Asserting on the DOM alone is a
       race: /shop2/blog/ renders its «Статей пока нет» empty state first and
       only fills in when GET /api/blog/ lands, so an immediate read always
       looks empty. This is the authoritative answer; the page below is then
       checked for how it PRINTS what the feed carries. */
    const publicTitles = async (): Promise<string[]> => {
      const res = await page.request.get("/api/blog/?lang=RU&page=1");
      expect(res.status(), "the public blog feed is down").toBe(200);
      return ((await res.json()).posts || []).map((p: { title: string }) => p.title || "");
    };
    const listed = async () => (await publicTitles()).some((t) => t.includes(marker));

    // A draft is invisible to the shop. That is the whole point of a draft.
    expect(await listed(), "an unpublished draft was on the public blog").toBe(false);

    await page.locator("[data-admblogpublish]").click();
    await clearToast(page);
    // the state is a sentence in the «Публикация» card now, not a chip
    await expect(page.getByText("Опубликована. Изменения появятся")).toBeVisible();
    await assertClean(page, w, "blog published");
    expect(await listed(), "a published post never reached the public blog").toBe(true);

    // …and the shop prints the owner's paste as text, not as markup. Its own
    // context: GET /api/blog/ answers `public, max-age=60`, so a second visit
    // in an already-used context would be served from the browser cache.
    const shop = await freshShop(browser);
    await shop.page.goto(shopUrl("", "/blog/"));
    await waitForScreen(shop.page, "blog");
    await expect(shop.page.locator("main")).toContainText(marker);
    await expect(shop.page.locator("main")).toContainText("<script>");
    expect(await shop.page.locator("main script").count(), "the blog ran the owner's paste").toBe(0);
    expect(await shop.page.locator("img[onerror]").count()).toBe(0);
    await assertClean(shop.page, shop.w, "public blog with the post");
    await shop.close();

    await page.locator("[data-admblogunpublish]").click();
    await clearToast(page);
    await expect(page.getByText("Черновик. В магазине его пока не видно.")).toBeVisible();
    expect(await listed(), "an unpublished post stayed on the public blog").toBe(false);

    // Delete asks first, and the answer is undoable only by re-publishing —
    // docs/blog.md is explicit that posts skip the undo journal.
    await page.locator("[data-admblogdel]").click();
    await expect(page.locator("[data-admblogdelno]")).toBeVisible();
    await page.locator("[data-admblogdelno]").click();
    await expect(page.locator("[data-admblogdelno]")).toHaveCount(0);
    await page.locator("[data-admblogdel]").click();
    await page.locator("[data-admblogdelyes]").click();
    await clearToast(page);
    await assertClean(page, w, "blog post deleted");
  });
});
