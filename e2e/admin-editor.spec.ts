import { expect, type Page, test } from "@playwright/test";
import { eur, ipHeaders, PRODUCT_2, shopUrl, waitForScreen } from "./fixtures";
import { closeCard, openCard, settled, toSection, typeAndLeave } from "./goods-helpers";
import { assertClean, clearToast, freshShop, openAdmin, tab, toastText, watch } from "./sweep-helpers";

/**
 * «Товар» — the product card of direction 1a (design_handoff_admin_ux README
 * § 5, screen 02).
 *
 * What were five tabs over one form with a sticky «Сохранить» is ONE page:
 * В магазине → Объёмы и цены → Фото → Фото по объёмам → Видео → Описание →
 * Для Google (folded). There is no «Сохранить»: a price, a salon price, a
 * count and a barcode go when the owner leaves the box, the texts a second
 * after the last keystroke, a switch or a photo button at once — each with
 * «Сохраняем… → Сохранено ✓» in the panel's one status (goods-helpers.ts).
 *
 * What is checked end to end, because it is what the owner is actually doing:
 *   · a price and a salon price typed in «Объёмы и цены» reach the shop;
 *   · a count typed in the same grid reaches «Склад» (a relative move, as ± is);
 *   · a barcode typed in the same grid binds to that size;
 *   · the photo grid tags its first picture «главное», and the sizes that show it;
 *   · a video link round-trips;
 *   · «Не продавать» stops the sale at once and «Вернуть» on the toast undoes it.
 *
 * PRODUCT_2, not PRODUCT: this spec counts a shelf and moves a price, and
 * fixtures.ts reserves PRODUCT for the specs that must never see either.
 * Everything it changes is put back in `finally`.
 */

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop" && testInfo.project.name !== "mobile",
    "product editor — desktop and mobile only, see docs/testing.md");
});

/** The count the warehouse actually holds — read from the route the panel
 *  itself reads. `null` while the row is still untracked. */
async function stockQty(page: Page, productId: string, variant: string): Promise<number | null> {
  const res = await page.request.get(`/api/admin/inventory/?filter=all&q=${encodeURIComponent(productId)}`);
  const rows = (await res.json()).levels as Array<{ productId: string; variant: string; tracked: boolean; qty: number; ean: string | null }>;
  const row = rows.find((r) => r.productId === productId && (r.variant || "") === variant);
  return row && row.tracked ? row.qty : null;
}
async function stockEan(page: Page, productId: string, variant: string): Promise<string> {
  const res = await page.request.get(`/api/admin/inventory/?filter=all&q=${encodeURIComponent(productId)}`);
  const rows = (await res.json()).levels as Array<{ productId: string; variant: string; ean: string | null }>;
  const row = rows.find((r) => r.productId === productId && (r.variant || "") === variant);
  return (row && row.ean) || "";
}
async function feed(page: Page, id: string): Promise<Record<string, any>> {
  const body = await (await page.request.get("/api/overrides/")).json();
  return (body.overrides || {})[id] || {};
}

test.describe("admin — the product editor", () => {
  test.use({ extraHTTPHeaders: ipHeaders(171) });

  test("one page, no «Сохранить», and what is typed reaches the shop and the warehouse", async ({ page, browser }) => {
    test.setTimeout(200_000);
    const w = watch(page);
    const id = PRODUCT_2.id;
    const VARIANT = "40 мл";
    let priceWas = "";

    await openAdmin(page);
    await openCard(page, id);

    // ---- the frame ---------------------------------------------------------
    await expect(page.locator(".adm-head__kicker").first()).toContainText(PRODUCT_2.brand);
    await expect(page.locator(`[data-go-product="${id}"]`), "the one dark button").toHaveText("Открыть в магазине ↗");
    await expect(page.locator("[data-admsavegoods]"), "a «Сохранить» is left on the card").toHaveCount(0);
    await expect(page.locator("[data-edtab]"), "the card still has tabs").toHaveCount(0);
    // every section, one under the other, in the design's order
    const order = await page.locator("[data-edsec]").evaluateAll((els) => els.map((el) => el.getAttribute("data-edsec")));
    expect(order.filter((k) => k !== "bysize")).toEqual(["shop", "sizes", "photos", "video", "desc", "seo"]);
    // what the catalogue owns is not a box here — the «?» says who changes it
    await page.locator('[data-admhelp="ed-lock"]').click();
    await expect(page.locator("#admhelp-ed-lock")).toContainText("приходят из каталога");
    await assertClean(page, w, "the card");

    const status = page.locator("[data-admsavest]").first();
    try {
      // ---- Объёмы и цены: price, salon price, stock, barcode ---------------
      await toSection(page, "sizes");
      priceWas = await page.locator("[data-edprice]").inputValue();
      const stockWas = (await stockQty(page, id, VARIANT)) ?? 0;
      const ean = `28${Date.now().toString().slice(-10)}`;

      // a price is sent when the box is LEFT — «2» on the way to «20» never is
      await page.locator("[data-edprice]").fill("2");
      await page.waitForTimeout(700);
      await expect(status, "a keystroke went to the shop").not.toHaveAttribute("data-st", "saving");
      await page.locator("[data-edprice]").fill("20");
      // the salon price follows as its placeholder — an empty box is «the discount»
      const auto = Number(String(await page.locator("[data-edproprice]").getAttribute("placeholder")).replace(",", "."));
      expect(auto, "the salon price did not follow the retail one").toBeGreaterThan(0);
      expect(auto, "the salon price is not below the retail one").toBeLessThan(20);
      expect(await page.locator("[data-edproprice]").inputValue(), "the discount was written in as a price of its own").toBe("");
      await page.locator("[data-edprice]").blur();
      await settled(page, "the price");
      await expect.poll(async () => Number((await feed(page, id)).price), { timeout: 15_000 }).toBe(20);

      // a salon price typed by hand is the owner's, and a later retail edit leaves it alone
      await typeAndLeave(page, page.locator("[data-edproprice]"), "11");
      await typeAndLeave(page, page.locator("[data-edprice]"), "19");
      expect(await page.locator("[data-edproprice]").inputValue(),
        "a deliberate salon price was overwritten by a retail edit").toBe("11");

      // Остаток and Штрихкод are the warehouse, in the same grid
      await typeAndLeave(page, page.locator(`[data-edqty="${id} ${VARIANT}"]`), String(stockWas + 7));
      await typeAndLeave(page, page.locator(`[data-edean="${id} ${VARIANT}"]`), ean);
      await assertClean(page, w, "the card saved price + salon + stock + ean");

      // ---- …and all four of them landed -------------------------------------
      await expect.poll(async () => stockQty(page, id, VARIANT),
        { timeout: 15_000, message: "the stock typed in the card never reached the warehouse" })
        .toBe(stockWas + 7);
      await expect.poll(async () => stockEan(page, id, VARIANT),
        { timeout: 15_000, message: "the barcode typed in the card never bound" }).toBe(ean);

      // «Склад» shows the same two numbers — it is the same rows.
      await tab(page, "stock");
      await page.locator("[data-stockq]").fill(ean);
      await expect(page.locator("#stocklist"), "«Склад» does not show the barcode the card bound").toContainText(ean);
      await expect(page.locator("#stocklist"), "«Склад» does not show the count the card set").toContainText(String(stockWas + 7));
      await assertClean(page, w, "«Склад» agrees with the card");

      // The storefront charges what the card says.
      await expect.poll(async () => Number((await feed(page, id)).price),
        { timeout: 15_000, message: "the overrides feed never carried the new price" }).toBe(19);
      const shop = await freshShop(browser);
      await shop.page.goto(shopUrl("", `/p/${id}/`));
      await waitForScreen(shop.page, "product");
      await expect(shop.page.locator("[data-price]")).toHaveText(eur(19, "RU"));
      await assertClean(shop.page, shop.w, "product page after the card");
      await shop.close();

      // ---- Фото и видео ------------------------------------------------------
      await openCard(page, id);
      await toSection(page, "photos");
      /* the first photo is the main one and wears the tag that says so — and
         (0a8e2fa) the sizes that show it; the word is a node of its own */
      const mainTag = page.locator(".adm-photo__tag--ink").first();
      await expect(mainTag.locator("span").first()).toHaveText("главное");
      await expect(mainTag, "the main photo does not say which sizes show it").toContainText(VARIANT);
      await expect(page.locator(`[data-galup="${id}"]`), "no «+ Фото»").toBeVisible();
      await toSection(page, "video");
      for (const kind of ["yt", "ig", "up"]) await expect(page.locator(`[data-edvidkind="${kind}"]`)).toBeVisible();
      await typeAndLeave(page, page.locator("[data-edvideo]"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      await closeCard(page);
      await openCard(page, id);
      expect(await page.locator("[data-edvideo]").inputValue(), "the video link did not round-trip").toContain("dQw4w9WgXcQ");
      await assertClean(page, w, "the card's video");

      // ---- Описание: the language tabs and the AI buttons ----------------------
      await toSection(page, "desc");
      await expect(page.locator("[data-eddescru]")).toBeVisible();
      await expect(page.locator(`[data-admdescgen="${id}"]`)).toHaveText("Написать черновик");
      await expect(page.locator(`[data-admtranslate="${id}"]`), "the Russian tab translates into both").toHaveText("Перевести на ET и EN");
      await page.locator('[data-eddesclang="et"]').click();
      await expect(page.locator("[data-eddescet]"), "the Estonian box did not open").toBeVisible();
      await expect(page.locator("[data-eddescru]"), "two languages were on screen at once").toBeHidden();
      await expect(page.locator(`[data-admtranslate="${id}"]`), "the Estonian tab translates only itself").toHaveText("Перевести с русского");
      await page.locator('[data-eddesclang="ru"]').click();
      await assertClean(page, w, "the card's description");

      // ---- «Наличие»: a counted product has one switch, «Не продавать» (q22) ---
      await toSection(page, "shop");
      const stop = page.locator("[data-edstock]");
      await expect(stop, "a counted product still offers «в наличии / мало»").toHaveCount(1);
      await expect(stop).toContainText("Не продавать");
      await stop.click();
      expect(await toastText(page)).toMatch(/Продажа остановлена/);
      await settled(page, "«Не продавать»");
      await expect.poll(async () => (await feed(page, id)).stock, { timeout: 15_000 }).toBe("out");
      // the undo the toast offers is the safety net the README asks for
      await page.locator(".adm-toast__undo").click();
      await expect(page.getByRole("status")).toContainText("Отменено");
      await clearToast(page);
      await expect.poll(async () => (await feed(page, id)).stock || "in", { timeout: 15_000, message: "«Вернуть» did not put the product back on sale" })
        .not.toBe("out");
      await assertClean(page, w, "«Не продавать» and its undo");
    } finally {
      // Price back to the catalogue's own, the salon override cleared, the shelf
      // left well stocked — every other spec that buys this product decrements
      // the same count (fixtures.ts, PRODUCT_2) — and no video.
      await openCard(page, id);
      if (priceWas) await typeAndLeave(page, page.locator("[data-edprice]"), priceWas);
      await typeAndLeave(page, page.locator("[data-edproprice]"), "");
      await typeAndLeave(page, page.locator(`[data-edqty="${PRODUCT_2.id} ${VARIANT}"]`), "500");
      if (await page.locator("[data-edvidclear]").count()) { await page.locator("[data-edvidclear]").click(); await settled(page); }
      await clearToast(page);
    }
  });

  /**
   * «Для Google»: folded; inside, one title/description pair per language
   * behind the same tabs «Описание» has. The design keeps one AI button —
   * «все три языка» (B50) — and what it writes saves itself like typed text.
   * What is saved comes back per language, and the shop's own <title> reads
   * the page's language with the Russian pair as the fallback. The model is
   * stubbed at the network edge.
   */
  test("«Для Google»: one pair per language, the AI fills all three, the shop reads the right one", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    const id = PRODUCT_2.id;
    const asked: string[] = [];
    await page.route("**/api/admin/ai/text/", async (route) => {
      const body = route.request().postDataJSON() as { task: string; lang: string };
      asked.push(`${body.task}:${body.lang}`);
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, text: { title: `Title ${body.lang}`, description: `Snippet ${body.lang}` } }),
      });
    });

    await openAdmin(page);
    await openCard(page, id);
    await toSection(page, "seo");

    // Russian first, the other two behind the tabs — one language on screen
    await expect(page.locator('[data-edseolang="ru"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator("[data-edseot]")).toBeVisible();
    await expect(page.locator("[data-edseotet]")).toBeHidden();
    await page.locator('[data-edseolang="et"]').click();
    await expect(page.locator("[data-edseotet]")).toBeVisible();
    await expect(page.locator("[data-edseot]")).toBeHidden();

    try {
      // «все три языка»: three questions, three pairs — saved without a button
      await page.locator(`[data-admseoall="${id}"]`).click();
      await expect(page.locator("[data-edseotet]")).toHaveValue("Title ET");
      expect(asked.sort()).toEqual(["seo:EN", "seo:ET", "seo:RU"]);
      expect(await toastText(page)).toMatch(/Заполнено на трёх языках/);
      await settled(page, "the AI's Google texts");
      await expect.poll(async () => (await feed(page, id)).seo || null, { timeout: 15_000 })
        .toEqual({ RU: { title: "Title RU", desc: "Snippet RU" }, ET: { title: "Title ET", desc: "Snippet ET" }, EN: { title: "Title EN", desc: "Snippet EN" } });
      await clearToast(page);
      await assertClean(page, w, "Google AI fill");

      // the owner's own words: Russian and Estonian, English left empty
      await page.locator('[data-edseolang="ru"]').click();
      await typeAndLeave(page, page.locator("[data-edseot]"), "Русский заголовок для Google");
      await typeAndLeave(page, page.locator("[data-edseod]"), "Русское описание");
      await page.locator('[data-edseolang="et"]').click();
      await typeAndLeave(page, page.locator("[data-edseotet]"), "Eesti pealkiri Google'ile");
      await typeAndLeave(page, page.locator("[data-edseodet]"), "");
      await page.locator('[data-edseolang="en"]').click();
      await typeAndLeave(page, page.locator("[data-edseoten]"), "");
      await typeAndLeave(page, page.locator("[data-edseoden]"), "");
      await assertClean(page, w, "Google texts saved");

      // the public feed carries the set per language, the Russian pair in the legacy fields too
      await expect.poll(async () => (await feed(page, id)).seo || null,
        { timeout: 15_000, message: "the overrides feed never carried the per-language pairs" })
        .toEqual({ RU: { title: "Русский заголовок для Google", desc: "Русское описание" }, ET: { title: "Eesti pealkiri Google'ile" } });
      expect((await feed(page, id)).seoTitle).toBe("Русский заголовок для Google");

      // …and the card shows each pair where it belongs
      await closeCard(page);
      await openCard(page, id);
      await toSection(page, "seo");
      expect(await page.locator("[data-edseot]").inputValue()).toBe("Русский заголовок для Google");
      await page.locator('[data-edseolang="et"]').click();
      expect(await page.locator("[data-edseotet]").inputValue()).toBe("Eesti pealkiri Google'ile");
      await page.locator('[data-edseolang="en"]').click();
      expect(await page.locator("[data-edseoten]").inputValue()).toBe("");

      // the shop: the Estonian page reads its own title, the English one — with
      // nothing of its own — the Russian pair, and the Russian page its own
      const shop = await freshShop(browser);
      await shop.page.goto(shopUrl("/et", `/p/${id}/`));
      await waitForScreen(shop.page, "product");
      await expect(shop.page).toHaveTitle(/Eesti pealkiri Google'ile/);
      await shop.page.goto(shopUrl("/en", `/p/${id}/`));
      await waitForScreen(shop.page, "product");
      await expect(shop.page).toHaveTitle(/Русский заголовок для Google/);
      expect(await shop.page.locator('meta[name="description"]').getAttribute("content")).toBe("Русское описание");
      await shop.page.goto(shopUrl("", `/p/${id}/`));
      await waitForScreen(shop.page, "product");
      await expect(shop.page).toHaveTitle(/Русский заголовок для Google/);
      await assertClean(shop.page, shop.w, "product page titles per language");
      await shop.close();
    } finally {
      // every pair emptied = the override is gone, not stored as blanks
      await openCard(page, id);
      await toSection(page, "seo");
      for (const [lang, t, d] of [["ru", "[data-edseot]", "[data-edseod]"], ["et", "[data-edseotet]", "[data-edseodet]"], ["en", "[data-edseoten]", "[data-edseoden]"]]) {
        await page.locator(`[data-edseolang="${lang}"]`).click();
        await typeAndLeave(page, page.locator(t), "");
        await typeAndLeave(page, page.locator(d), "");
      }
      await expect.poll(async () => (await feed(page, id)).seo || null, { timeout: 15_000 }).toBeNull();
    }
  });

  /**
   * The phone (1a, screen 02 phone). The save bar that used to be the header
   * is gone with «Сохранить»: the panel's own top bar says «← Товары» and the
   * save status, the ONE dark button — «Открыть в магазине ↗» — is pinned
   * above the tab bar, and the form ends above it. Pinned as geometry, with
   * and without an iPhone's insets (the CDP emulation Chromium has for
   * exactly this):
   *   · the top bar at the very top, the tab bar at the very bottom, the dark
   *     button on the tab bar and the form's last row above the button;
   *   · every photo button lies inside its own row and crosses no other;
   *   · «Сканер» beside a size's barcode box binds the code it reads to THAT
   *     size at once — «Вернуть» on the toast unbinds it — and Back closes the
   *     scanner alone.
   */
  test("phone: the top bar and the pinned button frame the card; photo buttons stay in their rows; «Сканер» binds the code", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the phone layout — the desktop has no bottom nav");
    test.setTimeout(150_000);
    const w = watch(page);
    const id = PRODUCT_2.id;
    const VARIANT = "40 мл", OTHER = "150 мл";
    type Box = { l: number; t: number; r: number; b: number };
    const overlaps = (a: Box, b: Box) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    const inside = (a: Box, b: Box) => a.l >= b.l - 0.5 && a.r <= b.r + 0.5 && a.t >= b.t - 0.5 && a.b <= b.b + 0.5;

    await openAdmin(page);
    await openCard(page, id);

    const frame = async (label: string, inset: number, where: "top" | "end") => {
      const r = await page.evaluate(() => {
        const box = (el: Element) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        const q = (sel: string) => box(document.querySelector(sel)!);
        const secs = Array.from(document.querySelectorAll("[data-edsec]"));
        return {
          vw: window.innerWidth, vh: window.innerHeight,
          top: q(".adm-top"), nav: q(".adm-bar"), pin: q(".adm-pin"), last: box(secs[secs.length - 1]),
          back: (document.querySelector("[data-admtopback]")?.textContent || "").trim(),
          savebar: !!document.querySelector(".adm-savebar"),
        };
      });
      expect(r.savebar, `${label}: a save bar is still on the card`).toBe(false);
      expect(r.back, `${label}: the top bar does not lead back to the list`).toBe("← Товары");
      expect(Math.abs(r.top.t), `${label}: the top bar is off the top of the screen`).toBeLessThanOrEqual(0.5);
      expect(r.top.b, `${label}: the top bar is shorter than its row plus the inset`).toBeGreaterThanOrEqual(52 + inset - 0.5);
      expect(r.nav.b, `${label}: the tab bar is not at the bottom of the screen`).toBe(r.vh);
      expect(r.pin.b, `${label}: «Открыть в магазине ↗» sits on the tab bar, not above it`).toBeLessThanOrEqual(r.nav.t + 0.5);
      expect(r.pin.l).toBeLessThanOrEqual(0.5);
      expect(r.pin.r).toBeGreaterThanOrEqual(r.vw - 0.5);
      // at the end of the scroll the last section clears the dark button
      if (where === "end") expect(r.last.b, `${label}: the card's end is under the dark button`).toBeLessThanOrEqual(r.pin.t + 0.5);
    };
    await page.evaluate(() => window.scrollTo(0, 0));
    await frame("no inset, top of the scroll", 0, "top");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await frame("no inset, end of the scroll", 0, "end");
    // an iPhone 14: 47 px of notch above, 34 px of home indicator below
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 47, left: 0, bottom: 34, right: 0 } });
    await expect.poll(() => page.locator(".adm-bar").evaluate((el) => el.getBoundingClientRect().height),
      { message: "the nav did not grow by the inset" }).toBeGreaterThanOrEqual(98);
    await page.evaluate(() => window.scrollTo(0, 0));
    await frame("iPhone insets, top of the scroll", 47, "top");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await frame("iPhone insets, end of the scroll", 47, "end");
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, left: 0, bottom: 0, right: 0 } });
    await cdp.detach();

    // ---- the photo rows -----------------------------------------------------
    await toSection(page, "photos");
    const photos = await page.evaluate(() => {
      const box = (el: Element) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
      return Array.from(document.querySelectorAll(".adm-photo:not(.adm-photo--add)")).map((t) => ({
        tile: box(t),
        ops: Array.from(t.querySelectorAll(".adm-photo__op")).map((o) => ({ name: o.getAttribute("aria-label") || "", ...box(o) })),
      }));
    });
    expect(photos.length, "PRODUCT_2 has two catalogue photos").toBeGreaterThanOrEqual(2);
    photos.forEach((p, i) => {
      expect(p.ops.length, `photo ${i + 1} has no buttons`).toBeGreaterThanOrEqual(3);
      for (const op of p.ops) {
        expect(inside(op, p.tile), `photo ${i + 1}: «${op.name}» sticks out of its own tile`).toBe(true);
        expect(Math.min(op.r - op.l, op.b - op.t), `photo ${i + 1}: «${op.name}» is under a thumb's size`).toBeGreaterThanOrEqual(43.5);
        for (const other of p.ops) if (other !== op) expect(overlaps(op, other), `photo ${i + 1}: «${op.name}» overlaps «${other.name}»`).toBe(false);
        photos.forEach((q, j) => { if (j !== i) expect(overlaps(op, q.tile), `photo ${i + 1}: «${op.name}» lies over photo ${j + 1}`).toBe(false); });
      }
    });
    await assertClean(page, w, "phone card: frame and photos");

    // ---- «Сканер» binds the code to the size it was opened from --------------
    await toSection(page, "sizes");
    const box = page.locator(`[data-edean="${id} ${VARIANT}"]`);
    const other = page.locator(`[data-edean="${id} ${OTHER}"]`);
    const otherWas = await other.inputValue();
    const eanWas = await stockEan(page, id, VARIANT);
    await page.locator(`[data-edscan="${id} ${VARIANT}"]`).click();
    await expect(page.locator(".scanoverlay")).toBeVisible();
    await expect(page.locator(".scan__mode")).toHaveText("Товар: код встанет в поле «Штрихкод»");
    // Back while it is up: the scanner goes, the card stays, the panel stays
    await page.goBack();
    await expect(page.locator(".scanoverlay"), "Back did not close the scanner").toHaveCount(0);
    await expect(page.locator(`[data-edfor="${id}"]`), "Back closed the card along with the scanner").toBeVisible();
    await expect(page.locator('body[data-screen="admin"]')).toBeAttached();
    // again, and this time a code arrives — the manual field is the camera's
    // stand-in in headless Chromium, the same path a camera hit takes
    await page.locator(`[data-edscan="${id} ${VARIANT}"]`).click();
    await expect(page.locator(".scanoverlay")).toBeVisible();
    const code = `27${Date.now().toString().slice(-10)}`;
    await page.locator("[data-scanmanual]").fill(code);
    await page.locator("[data-scanmanualsubmit]").click();
    await expect(page.locator(".scanoverlay"), "the scanner stayed open after the read").toHaveCount(0);
    await expect(page.locator(`[data-edfor="${id}"]`), "the card closed with the scanner").toBeVisible();
    await expect(box, "the code did not land in the box the scanner was opened from").toHaveValue(code);
    expect(await other.inputValue(), "the code landed in the other size's box too").toBe(otherWas);
    await settled(page, "the scanned code");
    // bound at once (q20 / E25), and the toast can take it back
    expect(await toastText(page)).toMatch(/Код считан и привязан/);
    await expect.poll(async () => stockEan(page, id, VARIANT), { timeout: 15_000, message: "the scanned code was not bound" }).toBe(code);
    await page.locator(".adm-toast__undo").click();
    await expect.poll(async () => stockEan(page, id, VARIANT), { timeout: 15_000, message: "«Вернуть» did not unbind it" }).toBe(eanWas);
    await clearToast(page);
    // nothing is left unsaved, so Back closes the card at once and stays in the panel
    await page.goBack();
    await expect(page.locator(`[data-edfor="${id}"]`), "Back did not close the card").toHaveCount(0);
    await expect(page.locator("[data-admbackyes]"), "Back asked about a card with nothing unsaved").toHaveCount(0);
    await expect(page.locator('body[data-screen="admin"]'), "Back left the admin").toBeAttached();
    await assertClean(page, w, "phone card: the scanner into the box");
  });

  /**
   * Round 12 (Dim, 10.09.2026). The brand box of «+ Товар» was an <input
   * list> over a <datalist>, and Chrome drew the OS's own popup for it. It is
   * the panel's own list: the shop's brands with the most products first, at
   * most eight rows, filtered as you type with the typed part marked, ↑ ↓
   * Enter Escape, a press outside closes it, and «Новый бренд «…»» is the one
   * row when nothing matches. 1a: on «Новый товар», one page — and its draft
   * is cleared at the end («Начать заново»), so no other spec meets it.
   */
  test("«+ Товар»: the brand box is the panel's own list — filtered, keyboard-driven, a new brand when nothing matches", async ({ page }) => {
    const w = watch(page);
    await openAdmin(page);
    await tab(page, "goods");
    await page.locator("[data-admgoodsnew]").click();
    const box = page.locator("[data-edbrand]");
    const list = page.locator("#edbrandlist");
    const opts = list.locator('[role="option"]');
    await expect(box).toBeVisible();
    await expect(page.locator("datalist"), "the <datalist> is still there").toHaveCount(0);
    await expect(box).toHaveAttribute("role", "combobox");
    await expect(list).toHaveAttribute("role", "listbox");

    // opens on focus — «+ Товар» puts the caret there — and survives the
    // background render the media probe's answer causes
    await expect(list, "the list did not open with the focus").toBeVisible();
    await page.waitForTimeout(700);
    await expect(list, "a background render closed the list").toBeVisible();
    await box.click();
    await expect(list).toBeVisible();
    await expect(box).toHaveAttribute("aria-expanded", "true");
    expect(await opts.count()).toBeGreaterThanOrEqual(2);
    expect(await opts.count()).toBeLessThanOrEqual(8);
    for (const h of await opts.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
      expect(h, "a brand row is under a thumb's size").toBeGreaterThanOrEqual(43.5);
    }

    // typed → filtered, the typed part marked in each name
    await box.fill("pror");
    await expect(opts.first()).toContainText("Proraso");
    await expect(opts.first().locator("mark")).toHaveText(/^pror$/i);
    for (const name of await opts.allTextContents()) expect(name.toLowerCase()).toContain("pror");

    // ↓ then Enter picks the marked row and closes the list
    await box.press("ArrowDown");
    await expect(box).toHaveAttribute("aria-activedescendant", "edbrandopt-0");
    await expect(opts.first()).toHaveAttribute("aria-selected", "true");
    await box.press("Enter");
    await expect(box).toHaveValue("Proraso");
    await expect(list).toBeHidden();
    await expect(box).toHaveAttribute("aria-expanded", "false");

    // nothing matches → the one row offers what was typed as a new brand
    await box.fill("Zeta Beard Co");
    await expect(opts).toHaveCount(1);
    await expect(opts.first()).toContainText("Новый бренд «Zeta Beard Co»");
    await opts.first().click();
    await expect(box).toHaveValue("Zeta Beard Co");
    await expect(list).toBeHidden();

    // Escape closes the list and nothing else; a press outside closes it too
    await box.press("ArrowDown");
    await expect(list).toBeVisible();
    await box.press("Escape");
    await expect(list).toBeHidden();
    await expect(page.locator('[data-edfor="new"]'), "Escape closed more than the list").toBeVisible();
    await box.press("ArrowDown");
    await expect(list).toBeVisible();
    await page.locator("h1.adm-h1").click();
    await expect(list).toBeHidden();
    expect(await box.inputValue(), "closing the list changed the typed brand").toBe("Zeta Beard Co");
    await assertClean(page, w, "the brand list");

    // the draft keeps it — and «Начать заново» (with its question) lets it go
    await closeCard(page);
    await page.locator("[data-admgoodsnew]").click();
    await expect(page.locator("[data-edbrand]"), "the draft did not keep the brand").toHaveValue("Zeta Beard Co");
    await page.locator("[data-goodsnewreset]").click();
    await expect(page.locator(".adm-confirm")).toContainText("Начать заново?");
    await page.locator("[data-admapply]").click();
    await expect(page.locator("[data-edbrand]")).toHaveValue("");
    await closeCard(page);
  });

  /**
   * Round 12 (Dim, 10.09.2026): the desktop photo tile. Its buttons stand
   * under the picture, on paper, in one row, named and big enough to hit;
   * the «главное» tag reads at 12 px. 1a draws up to four tiles to a row.
   */
  test("desktop: photo buttons stand in one row under the picture, big enough to hit, inside their own tile", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the desktop tile — the phone has its own row layout");
    const w = watch(page);
    type Box = { l: number; t: number; r: number; b: number };
    const overlaps = (a: Box, b: Box) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    const inside = (a: Box, b: Box) => a.l >= b.l - 0.5 && a.r <= b.r + 0.5 && a.t >= b.t - 0.5 && a.b <= b.b + 0.5;

    await stubCutout(page, { hold: false });   // ✂ on: the widest row a tile carries
    await openAdmin(page);
    await openCard(page, PRODUCT_2.id);
    await toSection(page, "photos");
    const photos = await page.evaluate(() => {
      const box = (el: Element) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
      return Array.from(document.querySelectorAll(".adm-photo:not(.adm-photo--add)")).map((t) => {
        const tag = t.querySelector(".adm-photo__tag");
        return {
          tile: box(t), img: box(t.querySelector(".adm-photo__img")!),
          tag: tag ? { text: (tag.textContent || "").trim(), size: parseFloat(getComputedStyle(tag).fontSize) } : null,
          ops: Array.from(t.querySelectorAll(".adm-photo__op")).map((o) => ({ name: o.getAttribute("aria-label") || "", title: o.getAttribute("title") || "", ...box(o) })),
        };
      });
    });
    expect(photos.length, "PRODUCT_2 has two catalogue photos").toBeGreaterThanOrEqual(2);
    photos.forEach((p, i) => {
      expect(p.tile.r - p.tile.l, `tile ${i + 1} is narrower than 160 px`).toBeGreaterThanOrEqual(160);
      expect(p.ops.length, `tile ${i + 1} has no buttons`).toBeGreaterThanOrEqual(4);
      for (const op of p.ops) {
        expect(op.name && op.title, `tile ${i + 1}: a button with no name`).toBeTruthy();
        expect(inside(op, p.tile), `tile ${i + 1}: «${op.name}» sticks out of its tile`).toBe(true);
        expect(Math.min(op.r - op.l, op.b - op.t), `tile ${i + 1}: «${op.name}» is under 32 px`).toBeGreaterThanOrEqual(32);
        expect(op.t, `tile ${i + 1}: «${op.name}» lies over the picture`).toBeGreaterThanOrEqual(p.img.b - 0.5);
        for (const other of p.ops) if (other !== op) expect(overlaps(op, other), `tile ${i + 1}: «${op.name}» overlaps «${other.name}»`).toBe(false);
      }
      expect(new Set(p.ops.map((o) => Math.round(o.t))).size, `tile ${i + 1}: the buttons wrapped onto two lines`).toBe(1);
    });
    expect(photos[0].tag?.text, "the first photo does not say «главное»").toMatch(/^главное(?: · |$)/);
    expect(photos[0].tag!.size, "the «главное» tag is too small to read").toBeGreaterThanOrEqual(12);
    await assertClean(page, w, "desktop photo tiles");
  });
});

/* ==========================================================================
   The acceptance run, 12.09.2026 — things the owner found on his phone, and
   what each of them turned out to be. His words are quoted on the test they
   belong to.
   ========================================================================== */

/** A photo in the bucket, and the cut-out of it the server answers with. */
const CUT_SRC = "/shop/img/system-4-bio-botanical-shampoo-0.webp?v=5";
const CUT_OUT = "/shop/img/system-4-bio-botanical-serum-0.webp?v=5";

/**
 * No bucket in this suite (playwright.config.ts), so the media routes answer
 * from here. `hold: true` keeps the cut-out in flight until release() is
 * called — on the real server a cut-out is a model round trip the route
 * allows up to 90 seconds (src/lib/photo-cutout.ts), and what this pins is
 * everything the owner can do to the gallery in that time.
 */
async function stubCutout(page: Page, opts: { hold: boolean }) {
  const asked: string[] = [];
  let release: (() => void) | null = null;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route("**/api/admin/upload/**", async (route) => {
    const r = route.request();
    if (r.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, configured: true, cutout: true, maxBytes: 12 * 1024 * 1024, maxVideoBytes: 60 * 1024 * 1024 }) });
      return;
    }
    if (r.url().includes("/cutout/")) {
      asked.push(String((r.postDataJSON() as { url?: string }).url || ""));
      if (opts.hold) await gate;
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, key: "products/e2e/cut.png", url: CUT_OUT, thumbUrl: CUT_OUT, bytes: 10 }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, key: "products/e2e/1.webp", url: CUT_SRC, thumbUrl: CUT_SRC, width: 1, height: 1, bytes: 10, alt: "" }) });
  });
  return { asked, release: () => release && release() };
}

/** Every photo tile as the owner sees it: its picture, its label, and whether it says it is busy. */
function photoState(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".adm-photo:not(.adm-photo--add)")).map((t) => ({
      img: ((t.querySelector(".adm-photo__img") as HTMLElement | null)?.style.backgroundImage || "").replace(/^url\(['"]?|['"]?\)$/g, ""),
      tag: (t.querySelector(".adm-photo__tag")?.textContent || "").trim(),
      busy: t.classList.contains("adm-photo--busy"),
    })),
  );
}

test.describe("admin — what the acceptance run found", () => {
  /**
   * Renat, 12.09.2026: «Photo is loaded. When I click "remove background" and
   * move it to main, then actually the photo which it replaced is lost.»
   * The cut-out is written to the PHOTO it was asked for, wherever that photo
   * has moved to meanwhile, and the tile says it is being worked on. 1a: the
   * ★ in between saves at once, and so does the cut-out when it lands.
   */
  test("a cut-out that lands after the photo has been moved replaces that photo and no other, and the tile says it is being worked on", async ({ page }, ti) => {
    test.skip(ti.project.name !== "desktop", "one gallery, one engine — the phone layout is the test below");
    test.setTimeout(120_000);
    const w = watch(page);
    const cut = await stubCutout(page, { hold: true });
    await openAdmin(page);
    await openCard(page, PRODUCT_2.id);
    await toSection(page, "photos");
    const before = await photoState(page);
    expect(before.length, "this product needs two photos for the test to mean anything").toBeGreaterThanOrEqual(2);
    try {
      // ✂ on the second photo — and, while the server works, ★ to make it the main one
      await page.locator('[data-galcut="1"]').click();
      await expect.poll(async () => (await photoState(page))[1].busy,
        { message: "nothing on the tile says this photo is still being worked on" }).toBe(true);
      expect((await photoState(page))[1].tag).toContain("Убираем фон");
      await page.locator('[data-galmain="1"]').click();
      const moved = await photoState(page);
      expect(moved[0].busy, "«Убираем фон…» stayed behind on the slot instead of following the photo").toBe(true);
      expect(moved[1].busy).toBe(false);

      cut.release();
      await expect.poll(async () => (await photoState(page))[0].img, { timeout: 20_000 }).toContain(CUT_OUT);
      const after = await photoState(page);
      expect(after.length, "a photo went missing while a background was being removed").toBe(before.length);
      expect(after[1].img, "the cut-out landed on the wrong photo and replaced it").toContain(before[0].img.split("?")[0]);
      expect(after.some((p) => p.busy), "a tile is still marked busy after the answer").toBe(false);
      expect(cut.asked[0], "the wrong photo was sent to be cut out")
        .toContain(before[1].img.split("?")[0].replace(/^https?:\/\/[^/]+/, ""));
      await settled(page, "the gallery");
      await clearToast(page);
      await assertClean(page, w, "a cut-out while the gallery is being reordered");
    } finally {
      // the catalogue's own photos back — the link the design dropped and the owner keeps (q6)
      const reset = page.locator(`[data-galreset="${PRODUCT_2.id}"]`);
      if (await reset.count()) { await reset.click(); await settled(page, "the catalogue photos"); }
      await clearToast(page);
    }
  });

  /**
   * Renat, 12.09.2026: «The buttons and each photo have a square around them,
   * but the buttons are overflowing there.» Five 44-px buttons must stay in
   * their own tile on a 375- and a 360-px phone.
   */
  test("phone: all five photo buttons stay inside their own tile, at 375 and at 360", async ({ page }, ti) => {
    test.skip(ti.project.name !== "mobile", "the phone layout");
    test.setTimeout(120_000);
    const w = watch(page);
    await stubCutout(page, { hold: false });
    await openAdmin(page);
    await openCard(page, PRODUCT_2.id);
    await toSection(page, "photos");

    for (const width of [375, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(150);
      const shot = await page.evaluate(() => {
        const box = (el: Element) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        return {
          docW: document.documentElement.scrollWidth, winW: window.innerWidth,
          tiles: Array.from(document.querySelectorAll(".adm-photo:not(.adm-photo--add)")).map((t) => {
            const cs = getComputedStyle(t), b = t.getBoundingClientRect();
            return {
              pad: { r: b.right - parseFloat(cs.paddingRight), b: b.bottom - parseFloat(cs.paddingBottom) },
              ops: Array.from(t.querySelectorAll(".adm-photo__op")).map((o) => ({ name: o.getAttribute("aria-label") || "", ...box(o) })),
            };
          }),
        };
      });
      expect(shot.docW, `${width}px: the panel scrolls sideways`).toBeLessThanOrEqual(shot.winW + 0.5);
      shot.tiles.forEach((t, i) => {
        expect(t.ops.length, `${width}px: photo ${i + 1} lost its buttons`).toBeGreaterThanOrEqual(4);
        for (const op of t.ops) {
          expect(op.r, `${width}px: photo ${i + 1}: «${op.name}» sticks out of its own tile`).toBeLessThanOrEqual(t.pad.r + 0.5);
          expect(op.b, `${width}px: photo ${i + 1}: «${op.name}» hangs out of the bottom of its own tile`).toBeLessThanOrEqual(t.pad.b + 0.5);
          expect(Math.min(op.r - op.l, op.b - op.t), `${width}px: «${op.name}» is under a thumb's size`).toBeGreaterThanOrEqual(43.5);
        }
      });
      expect(shot.tiles[1].ops.length, `${width}px: a photo that is not the main one carries all five buttons`).toBe(5);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await assertClean(page, w, "the photo tiles at 375 and at 360");
  });

  /**
   * Renat, 12.09.2026, on removing a size: «The deletion does not trigger or
   * inform that it needs to be saved.» 1a (README rule 4): removing a size is
   * one of the few things that ASKS — the sheet names the size and says the
   * shelf keeps its count — then it is saved at once, and «Вернуть» on the
   * toast puts the size back.
   */
  test("«×» on a size asks first, saves at once, and «Вернуть» brings the size back", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    const id = PRODUCT_2.id;
    await openAdmin(page);
    await openCard(page, id);
    await toSection(page, "sizes");
    const dels = page.locator("[data-edsizedel]");
    const n = await dels.count();
    expect(n, "this product needs two sizes for «×» to be pressable").toBeGreaterThanOrEqual(2);
    const sizesBefore = (await feed(page, id)).sizes || null;

    // «Не надо» keeps everything
    await dels.nth(n - 1).click();
    const sheet = page.locator(".adm-confirm");
    await expect(sheet, "«×» removed a size without asking").toBeVisible();
    await expect(sheet).toContainText("Убрать 150 мл?");
    await expect(sheet).toContainText("Остаток и штрихкод останутся на складе");
    await page.locator("[data-admcancel]").click();
    await expect(page.locator("[data-edsizedel]")).toHaveCount(n);

    // «Убрать» removes and saves — the shop has one size fewer
    await page.locator("[data-edsizedel]").nth(n - 1).click();
    await page.locator("[data-admapply]").click();
    await expect(page.locator("[data-edsizedel]")).toHaveCount(n - 1);
    expect(await toastText(page)).toMatch(/Объём 150 мл убран/);
    await settled(page, "the shorter ladder");
    await expect.poll(async () => ((await feed(page, id)).sizes || []).length, { timeout: 15_000 }).toBe(n - 1);

    // «Вернуть» — the ladder as it was
    await page.locator(".adm-toast__undo").click();
    await expect(page.getByRole("status")).toContainText("Отменено");
    await expect.poll(async () => (await feed(page, id)).sizes || null, { timeout: 15_000, message: "«Вернуть» did not put the size back" })
      .toEqual(sizesBefore);
    await clearToast(page);
    await assertClean(page, w, "a size removed and brought back");
  });

  /**
   * Renat, 12.09.2026, twice: «after each save, when I am put back into the
   * list, I am put back to the bottom of the list.» The way out of the card
   * remembers the way in: the row he came from is on the screen.
   */
  test("leaving a product puts the list back on the row it came from", async ({ page }, ti) => {
    test.skip(ti.project.name !== "desktop", "one list, one rule — measured where the list is longest");
    test.setTimeout(150_000);
    const w = watch(page);
    await openAdmin(page);
    await tab(page, "goods");
    await page.locator("[data-goodsq]").fill("");
    const rows = page.locator("#goodslist [data-admgoods]");
    await expect(rows.first()).toBeVisible();
    /* «Показать ещё» pressed in the page, not by the mouse: bringing it into
       view IS the next page (goodsScrollMore), so a mouse click lands on a row. */
    const before = await rows.count();
    if (await page.locator("[data-admgoodsmore]").count()) {
      await page.evaluate(() => document.querySelector<HTMLElement>("[data-admgoodsmore]")?.click());
      await expect.poll(() => rows.count(), { message: "«Показать ещё» did not lengthen the list" }).toBeGreaterThan(before);
    }
    const n = await rows.count();
    expect(n, "the list is too short for this to mean anything").toBeGreaterThan(12);
    const target = rows.nth(Math.min(25, n - 1));
    const id = await target.getAttribute("data-admgoods");
    await target.scrollIntoViewIfNeeded();
    await target.click();
    await expect(page.locator(`[data-edfor="${id}"]`)).toBeVisible();
    // he reads down the card, then goes back
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await closeCard(page);
    await expect(page.locator("#goodslist")).toBeVisible();
    await page.waitForTimeout(600);
    const where = await page.evaluate((pid) => {
      const row = document.querySelector(`#goodslist [data-admgoods="${pid}"]`);
      if (!row) return null;
      const b = row.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, vh: window.innerHeight };
    }, id);
    expect(where, "the row is gone from the list").not.toBeNull();
    expect(where!.bottom, "the row of the product just left is above the screen").toBeGreaterThan(0);
    expect(where!.top, "the row of the product just left is below the screen — «I am put back to the bottom of the list»")
      .toBeLessThan(where!.vh);
    await assertClean(page, w, "back to the row it came from");
  });

  /**
   * Renat, 12.09.2026: «it lands somewhere at the end of the list, so it's
   * hard to find it again. Maybe some sort of a filter would be good.» Four
   * chips — Все · В магазине · Скрытые · Кончаются (q17) — each with its count.
   */
  test("the products list filters by status, and a product taken off sale is two taps away", async ({ page }, ti) => {
    test.skip(ti.project.name !== "desktop", "the chips are the same at both widths; driven once");
    test.setTimeout(150_000);
    const w = watch(page);
    await openAdmin(page);
    await tab(page, "goods");
    await expect(page.locator("[data-goodsfilter]"), "the products list has no status chips").toHaveCount(4);
    await expect(page.locator('[data-goodsfilter="all"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator('[data-goodsfilter="low"]')).toContainText("Кончаются");

    /* A catalogue product no other spec names — switched off here, back on in `finally`. */
    const HIDE_ID = "system-4-hydro-care-conditioner-h";
    await openCard(page, HIDE_ID);
    await page.locator("[data-edhidden]").click();
    expect(await toastText(page)).toMatch(/скрыт из магазина/);
    await settled(page, "the switch");
    await clearToast(page);
    try {
      await tab(page, "goods");
      await page.locator("[data-goodsq]").fill("");
      await page.locator('[data-goodsfilter="off"]').click();
      await expect(page.locator('[data-goodsfilter="off"]')).toHaveAttribute("aria-current", "true");
      await expect(page.locator(`[data-admgoods="${HIDE_ID}"]`),
        "the product taken off sale is not under «Скрытые»").toBeVisible();
      await expect(page.locator(`[data-goodsrow="${HIDE_ID}"] .adm-tag`).first()).toHaveText("Скрыт");
      await page.locator('[data-goodsfilter="on"]').click();
      await expect(page.locator(`[data-admgoods="${HIDE_ID}"]`),
        "a product that is off sale is still listed under «В магазине»").toHaveCount(0);
      await assertClean(page, w, "the status chips");
    } finally {
      await page.locator('[data-goodsfilter="all"]').click();
      /* the row's own «Виден» switch (desktop) puts it back */
      await page.locator("[data-goodsq]").fill(HIDE_ID);
      await page.locator(`[data-goodsvis="${HIDE_ID}"]`).click();
      await settled(page, "«Виден»");
      await clearToast(page);
      await expect(page.locator(`[data-goodsvis="${HIDE_ID}"]`)).toHaveAttribute("aria-checked", "true");
    }
  });
});
