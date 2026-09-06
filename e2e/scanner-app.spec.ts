import { expect, type Page, test } from "@playwright/test";
import { ipHeaders, PRODUCT_2, shopUrl, waitForScreen } from "./fixtures";
import { assertClean, clearToast, isRussian, openAdmin, tab, toastText, watch } from "./sweep-helpers";

/**
 * The scanner app — /shop2/scan/, the owner's third home-screen icon
 * (docs/inventory.md → "Сканер как отдельное приложение").
 *
 * Headless Chromium has no camera, so this drives the manual-entry path —
 * which is not a workaround but the same door a bluetooth/USB handheld
 * scanner types into (docs/inventory.md), and the one the owner falls back to
 * when a barcode is scuffed. Everything after the code arrives — the lookup,
 * the binding, the stepper, the move — is byte-for-byte what a camera hit
 * runs through (`handleScanCode()`).
 *
 * Both jobs the icon exists for, end to end:
 *   1. an unknown code → «К какому товару?» → search → one tap on product+size;
 *   2. that same code again → the product card → +3 приход → the warehouse
 *      holds three more than it did.
 *
 * Runs on desktop AND mobile: the whole point of the route is a phone.
 */
test.use({ extraHTTPHeaders: ipHeaders(98) });

/* Desktop + mobile, not the whole matrix: the phone is the point, the desktop
   run is the one that shares a database with the rest of the suite, and a
   tablet adds a third write to the same warehouse row for no new coverage
   (docs/testing.md, "Why most specs run on desktop only"). */
test.beforeEach(async ({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop" && testInfo.project.name !== "mobile",
    "scanner app — desktop and mobile only, see docs/testing.md",
  );
});

/** PRODUCT_2's first size — the row this spec counts (fixtures.ts: PRODUCT is
 *  deliberately never counted, PRODUCT_2 is the one that may be). */
const VARIANT = "40 мл";

/** The count the warehouse actually holds, read from the route the panel
 *  itself reads — `null` while the row is still untracked. */
async function stockQty(page: Page, productId: string, variant: string): Promise<number | null> {
  const res = await page.request.get(`/api/admin/inventory/?filter=all&q=${encodeURIComponent(productId)}`);
  const rows = (await res.json()).levels as Array<{ productId: string; variant: string; tracked: boolean; qty: number }>;
  const row = rows.find((r) => r.productId === productId && (r.variant || "") === variant);
  return row && row.tracked ? row.qty : null;
}

/** Takes the code off a size — the state a fresh database has. A size that
 *  already carries a code asks for a second tap before it is replaced
 *  (scanAssignResultsHTML), so a spec that binds must start from none. */
async function unbind(page: Page, productId: string, variant: string): Promise<void> {
  const res = await page.request.put("/api/admin/inventory/", { data: { productId, variant, ean: null } });
  expect(res.ok(), `could not clear the code on ${productId} ${variant}`).toBe(true);
}

test.describe("scanner app", () => {
  test("unknown code → bound to a product and size → scanned again → +3 приход lands in «Склад»", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);

    // A code no shop has ever seen: digits only, 8–14 of them (normEan()),
    // and different on every run so a re-run can never hit `ean_taken`.
    const ean = `29${Date.now().toString().slice(-10)}`;

    await openAdmin(page);
    await unbind(page, PRODUCT_2.id, VARIANT);
    await page.goto(shopUrl("", "/scan/"));
    await waitForScreen(page, "scan");

    // The route IS the scanner: no button to press, the overlay is already up
    // with its own bar, and the manual field is ready for a code.
    await expect(page.locator(".scanoverlay")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".scan__brand")).toHaveText("Rempire · Сканер");
    await expect(page.locator("[data-scanmanual]")).toBeVisible();
    // No camera here, and that has to be said in Russian rather than thrown.
    await assertClean(page, w, "scanner app opened without a camera");

    // ---- job 2: an unknown code, bound to a product and a size -------------
    await page.locator("[data-scanmanual]").fill(ean);
    await page.locator("[data-scanmanualsubmit]").click();
    await expect(page.locator("#scanpanel")).toContainText("Код не привязан");
    await expect(page.locator("#scanpanel")).toContainText("К какому товару?");
    await assertClean(page, w, "unknown code");

    // two or three letters is all it should take
    await page.locator("[data-scanassignq]").fill("tangled");
    /* The camera keeps reading the code that is already on screen for as long
       as the bottle stays in view. A re-read of THAT code must leave the
       search alone — it used to rebuild the panel every 1.5 s, wiping the
       query, closing the keyboard and pulling the list from under the finger.
       The manual field stands in for the camera here. */
    await page.locator("[data-scanmanual]").fill(ean);
    await page.locator("[data-scanmanualsubmit]").click();
    await expect(page.locator("[data-scanassignq]"), "a re-read of the code on screen wiped the search").toHaveValue("tangled");
    // the rows carry a price so two same-named bottles can be told apart
    await expect(page.locator(".scan__cand .num").first()).toContainText("€");
    /* One tap binds since the redesign: the candidate list is flat — one row
       per product AND size — because a barcode belongs to one bottle, and
       asking «какой объём?» after «какой товар?» was a second tap for a
       decision the owner had already made (README § Сканер). */
    const assign = page.locator(`[data-scanbind="${PRODUCT_2.id}|${VARIANT}"]`);
    await expect(assign).toBeVisible();
    await assign.click();
    expect(await toastText(page), "binding the code said nothing").toMatch(/привязан/i);
    await clearToast(page);
    // the binding re-looks the code up itself: the product card takes over
    await expect(page.locator("#scanpanel")).toContainText("Un.Tangled");
    await assertClean(page, w, "code bound to a product and size");

    // ---- job 1: the same code again, now a known product ------------------
    const before = (await stockQty(page, PRODUCT_2.id, VARIANT)) ?? 0;
    await page.locator("[data-scanmanual]").fill(ean);
    await page.locator("[data-scanmanualsubmit]").click();
    await expect(page.locator("#scanpanel")).toContainText("Un.Tangled");
    await expect(page.locator('[data-scanmove="in"]')).toBeVisible();
    await expect(page.locator('[data-scanmove="out"]')).toBeVisible();

    // the stepper starts at 1, so «+3» is two taps and one confirm
    await expect(page.locator("[data-scanqtyinput]")).toHaveValue("1");
    await page.locator('[data-scanqty="1"]').click();
    await page.locator('[data-scanqty="1"]').click();
    await expect(page.locator("[data-scanqtyinput]")).toHaveValue("3");
    // the two buttons carry the number they promise, so the stepper and the
    // promise can never disagree
    await expect(page.locator('[data-scanmove="in"]')).toHaveText("Принять +3");
    await expect(page.locator('[data-scanmove="out"]')).toHaveText("Списать −3");
    await page.locator('[data-scanmove="in"]').click();
    expect(await toastText(page), "the goods-in confirm said nothing").toMatch(/Приход \+3/);
    await clearToast(page);

    // auto-resume: the card comes back with the new remainder, the stepper is
    // back at 1 and the scanner is ready for the next code with nothing to tap
    await expect(page.locator("#scanpanel")).toContainText(`на складе ${before + 3}`);
    await expect(page.locator("#scanpanel")).toContainText("сканируйте следующий код");
    await expect(page.locator("[data-scanqtyinput]")).toHaveValue("1");
    expect(await stockQty(page, PRODUCT_2.id, VARIANT), "the move did not reach the warehouse").toBe(before + 3);
    await assertClean(page, w, "+3 приход");

    // ---- and the warehouse table agrees -----------------------------------
    await page.locator("[data-scanadmin]").click();
    await waitForScreen(page, "admin");
    await expect(page.locator(".scanoverlay")).toHaveCount(0);
    await tab(page, "stock");
    await expect(page.locator("#stocklist")).toBeVisible();
    // searching by the barcode itself proves the binding stuck as well
    await page.locator("[data-stockq]").fill(ean);
    const row = page.locator(`[data-stockedit="${PRODUCT_2.id} ${VARIANT}"]`).locator("xpath=..");
    await expect(row).toContainText(ean);
    await expect(row).toContainText(String(before + 3));
    await assertClean(page, w, "«Склад» shows what the scanner wrote");
  });

  /* The other door: «Склад» → «Сканировать» raises the same scanner as an
     overlay OVER the list. The list was fetched once (loadStockLevels) and
     the scanner wrote straight to the warehouse, so closing the overlay used
     to show the row exactly as it was — «штрихкод не привязан», the old
     count — until a reload. The owner read that as «nothing got added». */
  test("«Склад» overlay: the code bound and the +2 taken show on the list behind it, no reload", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    const ean = `27${Date.now().toString().slice(-10)}`;
    const variant = "150 мл";   // PRODUCT_2's other size — the first test owns «40 мл»

    await openAdmin(page);
    await unbind(page, PRODUCT_2.id, variant);
    await tab(page, "stock");
    await expect(page.locator("#stocklist")).toBeVisible();
    await page.locator("[data-stockq]").fill(PRODUCT_2.id);
    const row = page.locator(`[data-stockedit="${PRODUCT_2.id} ${variant}"]`).locator("xpath=..");
    await expect(row).toBeVisible();
    await expect(row).toContainText("штрихкод не привязан");
    const before = (await stockQty(page, PRODUCT_2.id, variant)) ?? 0;

    await page.locator("[data-scanopen]").first().click();
    await expect(page.locator(".scanoverlay")).toBeVisible();
    await page.locator("[data-scanmanual]").fill(ean);
    await page.locator("[data-scanmanualsubmit]").click();
    await expect(page.locator("#scanpanel")).toContainText("К какому товару?");
    await page.locator("[data-scanassignq]").fill("tangled");
    await page.locator(`[data-scanbind="${PRODUCT_2.id}|${variant}"]`).click();
    expect(await toastText(page)).toMatch(/привязан/i);
    await clearToast(page);
    await expect(page.locator('[data-scanmove="in"]')).toBeVisible();
    await page.locator('[data-scanqty="1"]').click();
    await expect(page.locator('[data-scanmove="in"]')).toHaveText("Принять +2");
    await page.locator('[data-scanmove="in"]').click();
    expect(await toastText(page)).toMatch(/Приход \+2/);
    await clearToast(page);
    await expect(page.locator("#scanpanel")).toContainText(`на складе ${before + 2}`);

    // back to the list: what the scanner just wrote is on the row already
    await page.locator("[data-scanclose]").click();
    await expect(page.locator(".scanoverlay")).toHaveCount(0);
    await expect(row, "the list behind the overlay still shows the row as unbound").toContainText(ean);
    await expect(row, "the list behind the overlay still shows the old count").toContainText(String(before + 2));
    await assertClean(page, w, "«Склад» list after the overlay");
  });

  /* Dim: «keyboard jumps out too often when scanning». Every render() — the
     panel's own fetches landing, the stock list refreshing — re-drew
     #scanpanel from scratch, and with it the search box the owner was typing
     into: the node was replaced under the finger, the keyboard closed and
     re-opened. The panel must only be redrawn when its own state changes.
     And a bluetooth/USB scanner types into whatever is focused — with nothing
     focused (the owner closed the keyboard), its digits went to the page and
     nothing happened. */
  test("the search box survives a background render; a handheld scanner's keystrokes count with nothing focused", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    const ean = `26${Date.now().toString().slice(-10)}`;
    const ean2 = `25${Date.now().toString().slice(-10)}`;

    await openAdmin(page);
    await tab(page, "stock");
    await expect(page.locator("#stocklist")).toBeVisible();
    /* The stock list re-reads when the scanner opens (the «без кода» marks
       on the candidate rows must be current). Held back for a second here,
       so it lands squarely while the owner is typing — the fetch that used to
       redraw the panel. */
    let held = 0;
    await page.route("**/api/admin/inventory/?filter=all&limit=1000", async (route) => {
      held++;
      await new Promise((r) => setTimeout(r, 1000));
      await route.continue();
    });

    await page.locator("[data-scanopen]").first().click();
    await expect(page.locator(".scanoverlay")).toBeVisible();
    await page.locator("[data-scanmanual]").fill(ean);
    await page.locator("[data-scanmanualsubmit]").click();
    await expect(page.locator("#scanpanel")).toContainText("К какому товару?");
    const search = page.locator("[data-scanassignq]");
    await search.fill("tangled");
    await search.evaluate((el) => { (el as HTMLElement).dataset.mark = "kept"; });
    await expect(page.locator(".scan__cand").first()).toBeVisible();
    await expect.poll(() => held, { timeout: 15_000 }).toBeGreaterThan(0);
    // the held-back answer lands now: render() runs, the panel must not
    await page.waitForResponse((r) => r.url().includes("/api/admin/inventory/?filter=all&limit=1000"));
    await page.waitForTimeout(300);
    await expect(search, "the search box was rebuilt under the finger").toHaveAttribute("data-mark", "kept");
    await expect(search).toHaveValue("tangled");
    await expect(search).toBeFocused();
    await expect(page.locator(".scan__cand").first()).toBeVisible();

    // a handheld scanner: digits + Enter, keyboard closed, nothing focused
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.type(ean2, { delay: 15 });
    await page.keyboard.press("Enter");
    await expect(page.locator("#scanpanel"), "the handheld scanner's code went nowhere").toContainText(ean2);
    await assertClean(page, w, "background render and the keyboard wedge");
    await page.unroute("**/api/admin/inventory/?filter=all&limit=1000");
  });

  /* A lookup that fails — the shop's connection dropping in the stockroom —
     used to be swallowed: the code was read, nothing appeared, and the same
     code was not even retried for 1.5 s. It has to say so, and the next
     attempt has to count. */
  test("a lookup that fails says so in Russian, and the next attempt works", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    const ean = `24${Date.now().toString().slice(-10)}`;

    await openAdmin(page);
    await page.goto(shopUrl("", "/scan/"));
    await waitForScreen(page, "scan");
    await expect(page.locator("[data-scanmanual]")).toBeVisible();

    // this step provokes a 503 on purpose; what counts is the sentence below
    w.allow.push(/\/api\/admin\/inventory\/lookup\//);
    await page.route("**/api/admin/inventory/lookup/**", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "db_unavailable" }) }));
    await page.locator("[data-scanmanual]").fill(ean);
    await page.locator("[data-scanmanualsubmit]").click();
    const msg = await toastText(page);
    expect(msg, "a failed lookup said nothing").not.toBe("");
    expect(isRussian(msg), `the failure is not in Russian — "${msg}"`).toBe(true);
    await clearToast(page);
    await page.unroute("**/api/admin/inventory/lookup/**");

    // the very same code, straight away: the failure must not be cached
    await page.locator("[data-scanmanual]").fill(ean);
    await page.locator("[data-scanmanualsubmit]").click();
    await expect(page.locator("#scanpanel")).toContainText("К какому товару?");
    w.serverErrors.length = 0;   // the mocked 503 above, forgiven
    await assertClean(page, w, "lookup after a failure");
  });

  /* Dim scanned a 300 ml bottle, typed what was on it and got nowhere: the
     search was one substring over «brand name id», so «kevin murphy» (no
     dot), «un tangled 150», «300 ml» (Latin) or «спрей 150» found nothing —
     and a size that already had a code took a second one silently, the old
     binding gone with no warning. */
  test("the search takes words in any order, dots or not, «ml» for «мл» and a size; a size with a code asks twice", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    const codeA = `23${Date.now().toString().slice(-10)}`;
    const codeB = `22${Date.now().toString().slice(-10)}`;
    const variant = "150 мл";

    await openAdmin(page);
    // «150 мл» already carries a code — bound the way the «Править» form does
    const put = await page.request.put("/api/admin/inventory/", { data: { productId: PRODUCT_2.id, variant, ean: codeA } });
    expect(put.ok(), "could not bind the first code").toBe(true);

    await page.goto(shopUrl("", "/scan/"));
    await waitForScreen(page, "scan");
    await page.locator("[data-scanmanual]").fill(codeB);
    await page.locator("[data-scanmanualsubmit]").click();
    await expect(page.locator("#scanpanel")).toContainText("К какому товару?");
    const search = page.locator("[data-scanassignq]");
    const cands = page.locator(".scan__cand");

    // words in any order, the brand without its dot, the size in Latin
    await search.fill("murphy kevin tangled 150 ml");
    await expect(cands).toHaveCount(1);
    await expect(cands.first()).toHaveAttribute("data-scanbind", `${PRODUCT_2.id}|${variant}`);
    // …and that row says it already has a code, by its last digits
    await expect(cands.first()).toContainText(`есть код ···${codeA.slice(-4)}`);

    // the size in Cyrillic, the Russian half of the name («— спрей для волос»)
    await search.fill("un tangled спрей 150 мл");
    await expect(cands).toHaveCount(1);
    await expect(cands.first()).toHaveAttribute("data-scanbind", `${PRODUCT_2.id}|${variant}`);
    // the name without its dot, no size: every size of the product
    await search.fill("un tangled");
    await expect(page.locator(`[data-scanbind="${PRODUCT_2.id}|40 мл"]`)).toBeVisible();
    await expect(page.locator(`[data-scanbind="${PRODUCT_2.id}|${variant}"]`)).toBeVisible();
    await assertClean(page, w, "candidate search");

    // a size that already has a code: the first tap asks, the second binds
    const row = page.locator(`[data-scanbind="${PRODUCT_2.id}|${variant}"]`);
    await row.click();
    await expect(row).toContainText("Заменить код?");
    await expect(page.locator("#scanpanel"), "one tap replaced a bound code").toContainText("К какому товару?");
    await row.click();
    expect(await toastText(page)).toMatch(/привязан/i);
    await clearToast(page);
    await expect(page.locator("#scanpanel")).toContainText("Un.Tangled");
    await expect(page.locator("#scanpanel")).toContainText(variant);
    // the old code is gone, the new one is the row's
    const res = await page.request.get(`/api/admin/inventory/lookup/?ean=${codeA}`);
    expect((await res.json()).hit, "the replaced code still finds the product").toBeNull();
    await assertClean(page, w, "code replaced after a second tap");
  });
});
