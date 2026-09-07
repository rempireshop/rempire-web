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

/** Every test here signs in once, and the login route allows five sign-ins
 *  a minute per address (src/lib/auth.ts rateLimit) — six tests in a row
 *  from one address would trip it on the sixth. So each test is its own
 *  describe with its own address (docs/testing.md, "Rate limits"). */
function scenario(octet: number, title: string, fn: (args: { page: Page }) => Promise<void>): void {
  test.describe(`ip .${octet}`, () => {
    test.use({ extraHTTPHeaders: ipHeaders(octet) });
    test(title, fn);
  });
}

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

/** …and the other way round, for the specs that need a size to arrive with a
 *  code already on it. */
async function bind(page: Page, productId: string, variant: string, ean: string): Promise<void> {
  const res = await page.request.put("/api/admin/inventory/", { data: { productId, variant, ean } });
  expect(res.ok(), `could not put ${ean} on ${productId} ${variant}`).toBe(true);
}

/** The code the warehouse holds for a size — "" while there is none. */
async function stockEan(page: Page, productId: string, variant: string): Promise<string> {
  const res = await page.request.get(`/api/admin/inventory/?filter=all&q=${encodeURIComponent(productId)}`);
  const rows = (await res.json()).levels as Array<{ productId: string; variant: string; ean: string | null }>;
  const row = rows.find((r) => r.productId === productId && (r.variant || "") === variant);
  return (row && row.ean) || "";
}

/** How many pixels the page pushes past its own width. The mobile project is
 *  375 px, narrower than the owner's 390, so anything above ~1 here is a
 *  sideways scroll on his phone. */
async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** The zoom the lens was last told to hold, out of everything the fake track
 *  had applyConstraints() called with. */
function lastZoom(applied: Array<Record<string, unknown>>): number {
  let z = 0;
  for (const a of applied) if (typeof a.zoom === "number") z = a.zoom as number;
  return z;
}

/** Two fingers on the viewfinder, moving from `from` px apart to `to`.
 *  Synthesised rather than driven through page.touchscreen, which does one
 *  finger at a time — a pinch is by definition two. */
async function pinch(page: Page, from: number, to: number): Promise<void> {
  await page.evaluate(({ from, to }) => {
    const box = document.querySelector("[data-scanzoombox]") as HTMLElement | null;
    if (!box) throw new Error("the viewfinder has no pinch target");
    const r = box.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const pair = (half: number) => [
      new Touch({ identifier: 1, target: box, clientX: cx - half, clientY: cy }),
      new Touch({ identifier: 2, target: box, clientX: cx + half, clientY: cy }),
    ];
    const fire = (type: string, touches: Touch[]) => box.dispatchEvent(
      new TouchEvent(type, { touches, targetTouches: touches, changedTouches: touches, bubbles: true, cancelable: true }));
    fire("touchstart", pair(from / 2));
    fire("touchmove", pair(to / 2));
    fire("touchend", []);
  }, { from, to });
}

/** …and the one-handed version of the same control. */
async function doubleTap(page: Page): Promise<void> {
  await page.evaluate(() => {
    const box = document.querySelector("[data-scanzoombox]") as HTMLElement | null;
    if (!box) throw new Error("the viewfinder has no pinch target");
    const r = box.getBoundingClientRect();
    const one = () => [new Touch({ identifier: 9, target: box, clientX: r.left + 20, clientY: r.top + 20 })];
    const tap = () => {
      const t = one();
      box.dispatchEvent(new TouchEvent("touchstart", { touches: t, targetTouches: t, changedTouches: t, bubbles: true, cancelable: true }));
      box.dispatchEvent(new TouchEvent("touchend", { touches: [], targetTouches: [], changedTouches: t, bubbles: true, cancelable: true }));
    };
    tap(); tap();
  });
}

/** «Товары» → the product → «Размеры и цены» (admin-editor.spec.ts's own two
 *  helpers, kept local so the two specs do not share a fixture). */
async function openSizes(page: Page, id: string): Promise<void> {
  await tab(page, "goods");
  await page.locator("[data-goodsq]").fill(id);
  await page.locator(`[data-admgoods="${id}"]`).click();
  await expect(page.locator("[data-admsavegoods]")).toBeVisible();
  await page.locator('[data-edtab="sizes"]').click();
  await expect(page.locator('[data-edtab="sizes"][aria-current="true"]')).toBeVisible();
}

test.describe("scanner app", () => {
  scenario(190, "unknown code → bound to a product and size → scanned again → +3 приход lands in «Склад»", async ({ page }) => {
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
  scenario(191, "«Склад» overlay: the code bound and the +2 taken show on the list behind it, no reload", async ({ page }) => {
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

    // ---- a wrong binding is undone on the card itself -----------------------
    await page.locator("[data-scanopen]").first().click();
    await page.locator("[data-scanmanual]").fill(ean);
    await page.locator("[data-scanmanualsubmit]").click();
    await expect(page.locator('[data-scanmove="in"]')).toBeVisible();
    await page.locator("[data-scanunbind]").click();
    expect(await toastText(page), "unlinking said nothing").toMatch(/отвязан/i);
    await clearToast(page);
    // the code is free again, and the search card follows so it can be re-bound at once
    await expect(page.locator("#scanpanel")).toContainText("К какому товару?");
    await page.locator("[data-scanclose]").click();
    await expect(page.locator(".scanoverlay")).toHaveCount(0);
    await expect(row).toContainText("штрихкод не привязан");
    await expect(row, "unlinking touched the count").toContainText(String(before + 2));
    await assertClean(page, w, "code unlinked from the card");
  });

  /* Dim: «keyboard jumps out too often when scanning». Every render() — the
     panel's own fetches landing, the stock list refreshing — re-drew
     #scanpanel from scratch, and with it the search box the owner was typing
     into: the node was replaced under the finger, the keyboard closed and
     re-opened. The panel must only be redrawn when its own state changes.
     And a bluetooth/USB scanner types into whatever is focused — with nothing
     focused (the owner closed the keyboard), its digits went to the page and
     nothing happened. */
  scenario(192, "the search box survives a background render; a handheld scanner's keystrokes count with nothing focused", async ({ page }) => {
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
  scenario(193, "a lookup that fails says so in Russian, and the next attempt works", async ({ page }) => {
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
  scenario(194, "the search takes words in any order, dots or not, «ml» for «мл» and a size; a size with a code asks twice", async ({ page }) => {
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

  /* The camera itself, on a phone that is not here: a fake BarcodeDetector
     and a fake getUserMedia stand in for Chrome on the owner's Samsung.
     Three things went wrong there (Dim: «scanning was hard and almost
     impossible»): `facingMode: environment` landed on the wide lens; the
     native detector answered nothing (Play Services' barcode module missing)
     and the page waited on it forever; and the manual field pulled the
     keyboard over the viewfinder. */
  scenario(195, "camera: the main back lens is picked, a code the camera reads twice is a hit, a silent or broken native detector hands over to zxing", async ({ page }) => {
    test.setTimeout(150_000);
    const w = watch(page);
    await page.addInitScript(() => {
      const fake = { next: "", detects: 0, mode: "empty", gum: [] as unknown[], vibrated: 0,
        formats: [] as string[], applied: [] as Array<Record<string, unknown>> };
      (window as unknown as { __scanFake: typeof fake }).__scanFake = fake;
      class FakeDetector {
        constructor(o?: { formats?: string[] }) { fake.formats = (o && o.formats) || []; }
        static getSupportedFormats() { return Promise.resolve(["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"]); }
        detect() {
          fake.detects++;
          if (fake.mode === "throw") return Promise.reject(new DOMException("Barcode detection service unavailable", "NotSupportedError"));
          return Promise.resolve(fake.next ? [{ rawValue: fake.next, format: "ean_13" }] : []);
        }
      }
      (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = FakeDetector;
      // two "cameras": a 640×480 wide lens and a 1920×1080 main one, both painting
      const mk = (w: number, h: number) => {
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const ctx = c.getContext("2d")!; let t = 0;
        setInterval(() => { ctx.fillStyle = t++ % 2 ? "#333" : "#444"; ctx.fillRect(0, 0, w, h); }, 100);
        return c;
      };
      const cams: Record<string, HTMLCanvasElement> = { wide: mk(640, 480), main: mk(1920, 1080) };
      // …and a lens that can focus, zoom and light up, so the tuning the
      // scanner does on a real Samsung is exercised rather than skipped
      const caps = { focusMode: ["continuous", "manual"], zoom: { min: 1, max: 8, step: 0.1 }, torch: true };
      const devices = [
        { kind: "videoinput", deviceId: "front", label: "camera2 1, facing front", groupId: "g" },
        { kind: "videoinput", deviceId: "wide", label: "camera2 2, facing back", groupId: "g" },
        { kind: "videoinput", deviceId: "main", label: "camera2 0, facing back", groupId: "g" },
      ];
      navigator.mediaDevices.enumerateDevices = () => Promise.resolve(devices as unknown as MediaDeviceInfo[]);
      navigator.mediaDevices.getUserMedia = (c?: MediaStreamConstraints) => {
        fake.gum.push(c);
        const v = c && (c.video as MediaTrackConstraints);
        const d = v && v.deviceId;
        const id = d && typeof d === "object" ? ((d as { exact?: string }).exact || (d as { ideal?: string }).ideal) : (d as string | undefined);
        // facingMode alone lands on the wide lens, the way Samsung's does
        const which = id === "main" ? "main" : "wide";
        const s = cams[which].captureStream(10);
        const tr = s.getVideoTracks()[0];
        const settings = tr.getSettings.bind(tr);
        tr.getSettings = () => Object.assign({}, settings(), { deviceId: which, width: cams[which].width, height: cams[which].height });
        tr.getCapabilities = () => caps as MediaTrackCapabilities;
        tr.applyConstraints = (c?: MediaTrackConstraints) => {
          const adv = (c && (c as { advanced?: Array<Record<string, unknown>> }).advanced) || [];
          adv.forEach((a) => fake.applied.push(a));
          return Promise.resolve();
        };
        return Promise.resolve(s);
      };
      navigator.vibrate = () => { fake.vibrated++; return true; };
    });
    type Applied = Record<string, unknown>;
    type FakeWin = Window & { __scanFake: { next: string; detects: number; mode: string; gum: unknown[]; vibrated: number; formats: string[]; applied: Applied[] } };
    const fake = () => page.evaluate(() => (window as unknown as FakeWin).__scanFake);
    const overlay = page.locator(".scanoverlay");

    await openAdmin(page);
    await page.goto(shopUrl("", "/scan/"));
    await waitForScreen(page, "scan");
    await expect(overlay).toBeVisible({ timeout: 30_000 });
    await expect(overlay).toHaveAttribute("data-scanengine", "native", { timeout: 15_000 });
    // the lens: the stream the viewfinder shows comes from the main camera
    await expect.poll(() => page.evaluate(() => {
      const v = document.querySelector("video") as HTMLVideoElement | null;
      const s = v && (v.srcObject as MediaStream | null);
      return s ? s.getVideoTracks()[0].getSettings().deviceId : "";
    }), { timeout: 15_000, message: "the viewfinder is not on the main back lens" }).toBe("main");
    // the native detector was asked for every retail and internal format
    expect((await fake()).formats).toEqual(expect.arrayContaining(["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"]));
    // with a camera running, the keyboard must stay down: nothing is focused
    await expect(page.locator("[data-scanmanual]")).not.toBeFocused();
    await expect(page.locator("[data-scanassignq]")).toHaveCount(0);

    // the lens is told to focus continuously and to start at the zoom the
    // pinch takes over from
    await expect.poll(async () => (await fake()).applied.some((a) => a.focusMode === "continuous"),
      { timeout: 10_000, message: "continuous autofocus was never asked for" }).toBe(true);
    expect(lastZoom((await fake()).applied), "the camera did not start at a usable zoom").toBeGreaterThan(1);

    /* Dim asked for a pinch, and it has to work with one hand. Two fingers
       on the viewfinder is the ordinary camera gesture; a double tap on it is
       the same thing for a thumb, which is what the owner has spare while the
       other hand holds the bottle. Neither may reach the page: only the
       viewfinder is bound, and it is `touch-action: none`. */
    const zoomBefore = lastZoom((await fake()).applied);
    await pinch(page, 80, 240);
    await expect.poll(async () => lastZoom((await fake()).applied),
      { timeout: 10_000, message: "a pinch on the viewfinder did not zoom the lens" }).toBeGreaterThan(zoomBefore);
    await expect(page.locator("[data-scanzoom]"), "the pinch said nothing on screen").toBeVisible();
    await expect(page.locator("[data-scanzoom]")).toContainText("×");
    // …and it stays inside what the lens can actually do (max 8× here)
    await pinch(page, 40, 4000);
    expect(lastZoom((await fake()).applied), "the pinch went past the lens's limit").toBeLessThanOrEqual(8);

    const zoomWide = lastZoom((await fake()).applied);
    await doubleTap(page);
    await expect.poll(async () => lastZoom((await fake()).applied),
      { timeout: 10_000, message: "a double tap on the viewfinder did nothing" }).not.toBe(zoomWide);

    /* A dark stockroom is where this was reported failing, and darkness is
       measurable: the fake camera paints a near-black frame, so the torch has
       to come on by itself — once, leaving the owner's own 🔦 the last word. */
    await expect(page.locator("[data-scantorch]"), "the torch button never appeared").toBeVisible();
    await expect.poll(async () => (await fake()).applied.some((a) => a.torch === true),
      { timeout: 15_000, message: "a dark frame did not light the torch" }).toBe(true);
    await expect(page.locator("[data-scantorch]")).toHaveAttribute("aria-pressed", "true");

    // a code in front of the lens is a hit — an EAN-13 checks out by itself,
    // so it counts on the first frame it is read on
    const ean = `21${Date.now().toString().slice(-10)}`;
    await page.evaluate((code) => { (window as unknown as FakeWin).__scanFake.next = code; }, ean);
    await expect(page.locator("#scanpanel")).toContainText(ean, { timeout: 10_000 });
    await expect(page.locator("#scanpanel")).toContainText("К какому товару?");
    expect((await fake()).vibrated, "no vibration on the hit").toBeGreaterThan(0);
    await page.evaluate(() => { (window as unknown as FakeWin).__scanFake.next = ""; });
    await assertClean(page, w, "camera hit");

    /* The native detector breaks (Play Services missing): zxing takes over at
       once. It used to say so on screen — «Камера читает через запасной
       декодер» — and Dim said no: that is a fact about the phone, not about
       the bottle. It is recorded where we can find it instead. */
    await page.evaluate(() => { (window as unknown as FakeWin).__scanFake.mode = "throw"; });
    await expect(overlay).toHaveAttribute("data-scanengine", "zxing", { timeout: 15_000 });
    await expect(overlay).toHaveAttribute("data-scanfallback", "error", { timeout: 10_000 });
    await expect(page.locator(".scanoverlay"), "the owner is still shown the decoder's news").not.toContainText("запасной");
    await expect(page.locator("[data-scannote]")).toBeHidden();
    await assertClean(page, w, "zxing after a broken detector");

    // …and a detector that merely stays silent for six seconds is not waited on either
    await page.goto(shopUrl("", "/scan/"));
    await waitForScreen(page, "scan");
    await expect(overlay).toHaveAttribute("data-scanengine", "native", { timeout: 15_000 });
    await expect(overlay).toHaveAttribute("data-scanengine", "zxing", { timeout: 15_000 });
    await expect(overlay).toHaveAttribute("data-scanfallback", "silent", { timeout: 10_000 });
    await expect(page.locator(".scanoverlay")).not.toContainText("запасной");
    await assertClean(page, w, "zxing after a silent detector");
  });

  /* «Товар» → «Размеры и цены»: the barcode column. An empty box said nothing
     at all — a size no code was ever bound to looked exactly like one whose
     code had not loaded yet, which is the other half of «it seemed to be
     impossible for existing products to scan the code» (Dim). */
  scenario(196, "the editor names the code a size carries, «Отвязать» frees it on save, and a size without one says so", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    const ean = `22${Date.now().toString().slice(-10)}`;
    const cell = page.locator(`[data-edean="${PRODUCT_2.id} ${VARIANT}"]`);
    const unbindBtn = page.locator(`[data-edunbind="${PRODUCT_2.id} ${VARIANT}"]`);

    await openAdmin(page);
    await bind(page, PRODUCT_2.id, VARIANT, ean);

    // the size carries a code: the box names it and «Отвязать» is beside it
    await openSizes(page, PRODUCT_2.id);
    await expect(cell, "the editor does not show the code the size carries").toHaveValue(ean);
    await expect(unbindBtn, "a bound size has no «Отвязать»").toBeVisible();
    await assertClean(page, w, "editor: a size with a code");

    // «Отвязать» only empties the box — nothing is freed until «Сохранить»
    await unbindBtn.click();
    await expect(cell).toHaveValue("");
    expect(await toastText(page), "«Отвязать» said nothing about saving").toMatch(/Сохранить/);
    await clearToast(page);
    expect(await stockEan(page, PRODUCT_2.id, VARIANT),
      "«Отвязать» freed the code before «Сохранить» was pressed").toBe(ean);

    await page.locator(`[data-admsavegoods="${PRODUCT_2.id}"]`).click();
    expect(await toastText(page)).toMatch(/Сохранено/);
    await clearToast(page);
    await expect.poll(async () => stockEan(page, PRODUCT_2.id, VARIANT),
      { timeout: 15_000, message: "«Сохранить» after «Отвязать» left the code on the size" }).toBe("");

    // …and now it says so, instead of sitting empty and mute
    await openSizes(page, PRODUCT_2.id);
    await expect(cell).toHaveValue("");
    await expect(cell).toHaveAttribute("placeholder", /не привязан/);
    await expect(unbindBtn, "a size with no code still offers «Отвязать»").toHaveCount(0);
    await expect(page.locator('[data-edpane="sizes"]'),
      "the grid never says where a barcode comes from").toContainText("Штрихкод привязывается сканером на складе");
    await assertClean(page, w, "editor: a size with no code");

    /* Dim was asked whether this cell should go read-only now that the
       scanner binds codes properly, and said no: it stays hand-typable. A
       code read off a bottle with the naked eye, on a phone whose camera has
       given up, is the last way in — so it has to actually save. */
    const typed = `28${Date.now().toString().slice(-10)}`;
    await cell.fill(typed);
    await page.locator(`[data-admsavegoods="${PRODUCT_2.id}"]`).click();
    expect(await toastText(page)).toMatch(/Сохранено/);
    await clearToast(page);
    await expect.poll(async () => stockEan(page, PRODUCT_2.id, VARIANT),
      { timeout: 15_000, message: "a barcode typed into the editor by hand never reached the warehouse" }).toBe(typed);
    // …and the scanner finds the bottle by it, which is the whole point
    const found = await page.request.get(`/api/admin/inventory/lookup/?ean=${typed}`);
    expect((await found.json()).hit?.productId, "a hand-typed code does not find its bottle").toBe(PRODUCT_2.id);
    await assertClean(page, w, "editor: a code typed by hand");
  });

  /* «We need all» (Dim). The list stopped dead at 60 of the ~320 rows the
     catalogue makes, and the tail was reachable only by guessing a search
     term — which is no way to walk a shelf. */
  scenario(198, "«Склад» reaches every row: a page at a time, by button and by scrolling to the end", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);

    await openAdmin(page);
    await tab(page, "stock");
    await expect(page.locator("#stocklist")).toBeVisible();

    const all = await page.request.get("/api/admin/inventory/?filter=all&limit=1000")
      .then(async (r) => ((await r.json()).levels as unknown[]).length);
    expect(all, "the e2e catalogue is too small to page — this test would prove nothing").toBeGreaterThan(60);

    const rows = page.locator("#stocklist .adm-row--stock");
    await expect(rows).toHaveCount(60);
    await expect(page.locator("[data-stockcount]")).toHaveText(new RegExp(`Показаны первые 60 из ${all}`));
    const more = page.locator("[data-stockmore]");
    await expect(more, "the list stops at 60 with no way to see the rest").toBeVisible();

    /* A page is APPENDED, never re-rendered. Marking the first row proves it:
       a rebuild would replace that node, take the scroll position with it and
       — as this test caught the first time round — pull the very button out
       of the DOM in the middle of the press that asked for more. */
    await rows.first().evaluate((el) => { (el as HTMLElement).dataset.mark = "kept"; });
    await more.click();
    await expect.poll(() => rows.count(), { timeout: 15_000, message: "«Показать ещё» added nothing" }).toBeGreaterThan(60);
    await expect(rows.first(), "the list was rebuilt from the top instead of grown").toHaveAttribute("data-mark", "kept");
    expect(await page.locator("[data-stockcount]").textContent(),
      "the count line does not agree with the rows on screen").toContain(`Показаны первые ${await rows.count()} из ${all}`);

    /* …and the same thing unasked, because on a phone six taps to reach the
       end of a shelf list is five too many. */
    const grown = await rows.count();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => rows.count(), { timeout: 15_000, message: "scrolling to the end did not load more rows" })
      .toBeGreaterThan(grown);
    await expect(rows.first(), "scrolling for more rebuilt the list").toHaveAttribute("data-mark", "kept");

    // every row is reachable in the end, and then the list says so plainly
    for (let i = 0; i < 12 && (await more.count()); i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(120);
    }
    await expect(rows).toHaveCount(all);
    await expect(page.locator("[data-stockcount]"), "the finished list still talks about a first page")
      .not.toContainText("Показаны первые");
    await expect(page.locator("[data-stockmore]"), "the list is complete and still asks for more").toHaveCount(0);

    // a search starts from the first page again rather than 320 rows in
    await page.locator("[data-stockq]").fill("murphy");
    await expect(page.locator("#stocklist")).toContainText("murphy");
    expect(await rows.count(), "a search after paging kept the whole list").toBeLessThan(all);
    expect(await sidewaysOverflow(page), "«Склад» scrolls sideways once the whole warehouse is on screen").toBeLessThanOrEqual(1);
    await assertClean(page, w, "«Склад» paged to the end");
  });

  /* Nothing in the catalogue has a barcode, so the first pass over the
     shelves is ~220 bottles one at a time, across several evenings. Dim asked
     for a plain «привязано N из M» so Renat can see where he stopped. */
  scenario(199, "«привязано N из M» counts the bound sizes, on «Склад» and on the scanner, and goes up after a bind", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    const ean = `20${Date.now().toString().slice(-10)}`;
    // the last scenario in the file, so it is free to take «150 мл» back off
    // whatever the ones before it left on it
    const variant = "150 мл";

    await openAdmin(page);
    await unbind(page, PRODUCT_2.id, variant);
    await tab(page, "stock");
    await expect(page.locator("#stocklist")).toBeVisible();

    const line = page.locator("[data-stockbound]");
    await expect(line).toBeVisible();
    const read = async (): Promise<[number, number]> => {
      const m = /(\d+)\D+(\d+)/.exec((await line.textContent()) || "");
      expect(m, `«привязано N из M» does not read as two numbers: ${await line.textContent()}`).toBeTruthy();
      return [Number(m![1]), Number(m![2])];
    };
    const [boundWas, totalWas] = await read();
    expect(totalWas, "the counter's total is not the whole warehouse").toBeGreaterThan(60);
    expect(boundWas).toBeLessThanOrEqual(totalWas);

    // the same count is on the scanner itself, which is the screen he is
    // holding while he does it
    await page.locator("[data-scanopen]").first().click();
    await expect(page.locator(".scanoverlay")).toBeVisible();
    await expect(page.locator("#scanpanel"), "the scanner does not say how far the binding has got")
      .toContainText(`привязано ${boundWas} из ${totalWas}`);

    // bind one code: one more bottle done
    await page.locator("[data-scanmanual]").fill(ean);
    await page.locator("[data-scanmanualsubmit]").click();
    await expect(page.locator("#scanpanel")).toContainText("К какому товару?");
    await page.locator("[data-scanassignq]").fill("tangled");
    await page.locator(`[data-scanbind="${PRODUCT_2.id}|${variant}"]`).click();
    expect(await toastText(page)).toMatch(/привязан/i);
    await clearToast(page);
    await page.locator("[data-scanclose]").click();
    await expect(page.locator(".scanoverlay")).toHaveCount(0);

    await expect.poll(async () => (await read())[0],
      { timeout: 15_000, message: "binding a code did not move the counter" }).toBe(boundWas + 1);
    expect((await read())[1], "the total moved when only a binding changed").toBe(totalWas);

    // …and freeing the code takes it back down again
    await unbind(page, PRODUCT_2.id, variant);
    await page.reload();
    await waitForScreen(page, "admin");
    await tab(page, "stock");
    await expect.poll(async () => (await read())[0],
      { timeout: 20_000, message: "freeing a code did not move the counter back" }).toBe(boundWas);
    await assertClean(page, w, "«привязано N из M»");
  });

  /* «Склад» itself — the list the owner searches on to fix a shelf. Its
     search was one literal substring, so «kevin murphy» found nothing (the
     catalogue writes «Kevin.Murphy»); «Порог «мало»» took «abc» as a number
     and saved it as «no threshold» under a «Сохранено ✓»; and the history
     answered a 500 with «Пока пусто». */
  scenario(197, "«Склад»: the search takes the owner's spelling, a bad «Порог «мало»» is refused, and a history that fails says so", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    const key = `${PRODUCT_2.id} ${VARIANT}`;
    const row = page.locator(`[data-stockedit="${key}"]`).locator("xpath=..");

    await openAdmin(page);
    await tab(page, "stock");
    await expect(page.locator("#stocklist")).toBeVisible();

    // the phone: nothing may push the page sideways
    expect(await sidewaysOverflow(page), "«Склад» scrolls sideways on a phone").toBeLessThanOrEqual(1);

    // …the way the owner types it: no dot, words in the order he says them
    await page.locator("[data-stockq]").fill("murphy kevin");
    await expect(row, "«Склад» cannot find «Kevin.Murphy» typed as «murphy kevin»").toBeVisible();
    // …and a size word narrows it to the one bottle
    await page.locator("[data-stockq]").fill("kevin murphy 40");
    await expect(row, "a size word threw the row away").toBeVisible();
    await expect(page.locator("#stocklist"), "the count line lost what was typed").toContainText("murphy");
    await assertClean(page, w, "«Склад» search");

    // «Порог «мало»» is a number or nothing — «abc» must not travel as null
    const lowWas = await page.request.get(`/api/admin/inventory/?filter=all&q=${encodeURIComponent(PRODUCT_2.id)}`)
      .then(async (r) => ((await r.json()).levels as Array<{ productId: string; variant: string; lowThreshold: number }>)
        .find((l) => l.productId === PRODUCT_2.id && (l.variant || "") === VARIANT)?.lowThreshold);
    await page.locator(`[data-stockedit="${key}"]`).click();
    await page.locator("[data-stocklowinput]").fill("abc");
    await page.locator(`[data-stocksave="${key}"]`).click();
    expect(await toastText(page), "«abc» was taken as a threshold").toMatch(/Порог/);
    await clearToast(page);
    await expect(page.locator("[data-stocklowinput]"), "the form closed on a refusal").toBeVisible();
    const lowNow = await page.request.get(`/api/admin/inventory/?filter=all&q=${encodeURIComponent(PRODUCT_2.id)}`)
      .then(async (r) => ((await r.json()).levels as Array<{ productId: string; variant: string; lowThreshold: number }>)
        .find((l) => l.productId === PRODUCT_2.id && (l.variant || "") === VARIANT)?.lowThreshold);
    expect(lowNow, "«abc» reached the warehouse as a threshold").toBe(lowWas);
    await page.locator('[data-stockedit=""]').first().click();   // Отмена
    await assertClean(page, w, "«Склад» refused a bad threshold");

    // the history: a route that fails says so and offers another go
    w.allow.push(/\/api\/admin\/inventory\/moves\//);
    await page.route("**/api/admin/inventory/moves/**", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "db_unavailable" }) }));
    await page.locator('[data-stockmovesopen="1"]').click();
    await expect(page.locator(".adm-error"), "a history that failed said nothing").toBeVisible();
    await expect(page.locator('[data-admreload="moves"]')).toBeVisible();
    await expect(page.locator(".adm-empty"), "a failed history still claims to be empty").toHaveCount(0);
    await page.unroute("**/api/admin/inventory/moves/**");

    // …and «Повторить» actually asks again
    await page.locator('[data-admreload="moves"]').click();
    await expect(page.locator(".adm-error"), "«Повторить» left the error on screen").toHaveCount(0);
    expect(await sidewaysOverflow(page), "the history scrolls sideways on a phone").toBeLessThanOrEqual(1);
    w.serverErrors.length = 0;   // the mocked 503 above, forgiven
    await assertClean(page, w, "«Склад» history after a failure");
  });
});
