import { expect, type Page, test } from "@playwright/test";
import { ipHeaders, PRODUCT_2, shopUrl, waitForScreen } from "./fixtures";
import { assertClean, clearToast, openAdmin, tab, toastText, watch } from "./sweep-helpers";

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

test.describe("scanner app", () => {
  test("unknown code → bound to a product and size → scanned again → +3 приход lands in «Склад»", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);

    // A code no shop has ever seen: digits only, 8–14 of them (normEan()),
    // and different on every run so a re-run can never hit `ean_taken`.
    const ean = `29${Date.now().toString().slice(-10)}`;

    await openAdmin(page);
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
});
