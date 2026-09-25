import { expect, type Page, test } from "@playwright/test";
import { adminLang, adminSection, cardBack, ipHeaders } from "./fixtures";
import { assertClean, clearToast, openAdmin, tab, toastText, watch } from "./sweep-helpers";
import { openCard, settled, typeAndLeave } from "./goods-helpers";

/**
 * Renat's acceptance run, 13.09.2026 — the two findings about the change log
 * and the one about the banner editor on a phone.
 *
 *   «Price change is logged, but written only, although my admin is in
 *    english — "Товар «Davines — Cheap price» изменён". I can not restore
 *    the price.»
 *
 * Two faults in one line. It said that something changed and not what, not
 * from what; and it had no «Вернуть», because a price change made in the goods
 * form was filed with journalNote(), which stores an entry with no `prev`.
 * On top of that the whole journal was exempt from the dictionary, so an owner
 * reading the panel in English read his own history in Russian.
 *
 *   «Clicking on edit, opens the edit pane somewhere below, so on mobile you
 *    might not even notice or understand if the pane is open or not to
 *    modify.»
 *
 * The banner editor draws a slide's form under the whole list of slides, which
 * on a 375-px screen is off the bottom of the phone.
 */

/** «Настройки» → one of its pages. */
async function settings(page: Page, sub: string): Promise<void> {
  await adminSection(page, "setup");
  // (on a phone the way back is the top bar's «← Настройки» — fixtures.cardBack)
  const back = cardBack(page, "[data-admsetback]", "Настройки");
  if (await back.count()) await back.click();
  await page.locator(`[data-admsetpage="${sub}"]`).click();
  await expect(cardBack(page, "[data-admsetback]", "Настройки")).toBeVisible();
}

/** The row of this browser's own list, by its position. */
const jrow = (page: Page, i: number) => page.locator(".adm-narrow .adm-jrow").nth(i);

async function rowPrice(page: Page, id: string): Promise<number | undefined> {
  const res = await page.request.get("/api/admin/products/");
  const list = (await res.json()).products as Array<{ id: string; price: number }>;
  return list.find((p) => p.id === id)?.price;
}

test.describe("admin — a price change on the owner's own product is in the journal, undoable, and in his language", () => {
  test.use({ extraHTTPHeaders: ipHeaders(191) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one write per action is enough — desktop runs it");
  });

  test("the line names the old price and the new one, «Вернуть» puts the old one back", async ({ page }) => {
    test.setTimeout(240_000);
    const w = watch(page);
    const stamp = Date.now().toString().slice(-6);
    const BRAND = `Davines ${stamp}`;
    let id = "";

    await openAdmin(page);
    await tab(page, "goods");
    await page.locator("[data-admgoodsnew]").click();
    await page.locator("[data-edbrand]").fill(BRAND);
    await page.locator("[data-edname]").fill("Cheap price");
    await page.locator("[data-edcat]").selectOption("beard");
    await page.locator("[data-edprice]").fill("14,90");
    await page.locator('[data-admsavegoods="new"]').click();
    expect(await toastText(page)).toMatch(/Товар добавлен/);
    await clearToast(page);
    id = (await page.locator("[data-edfor]:not([data-edfor='new'])").getAttribute("data-edfor")) || "";
    expect(id, "the card did not open on the created product").toMatch(/^c-davines-/);

    try {
      // ---- the price change the owner made — saved when the box is left (1a) ----
      await typeAndLeave(page, page.locator("[data-edprice]"), "9,90");
      await expect.poll(() => rowPrice(page, id), { timeout: 20_000 }).toBe(9.9);
      await clearToast(page);

      await settings(page, "journal");
      const top = jrow(page, 0);
      await expect(top, "the journal does not name the product").toContainText(`${BRAND} — Cheap price`);
      await expect(top, "the journal does not say what the price was, or what it became")
        .toContainText("цена: 14,90 € → 9,90 €");
      await expect(top.locator("[data-admundo]"), "a price change has no «Вернуть»").toBeVisible();
      /* A change is one line per field now, and the owner reads this on an
         iPhone — so the row has to hold at 375 px without spilling sideways.
         Checked here rather than by a second full run of this test on the
         mobile project: it is the layout that is in question, not the flow. */
      const wide = page.viewportSize();
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(top).toContainText("цена: 14,90 € → 9,90 €");
      expect(await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      "the journal scrolls sideways on a 375-px screen").toBeLessThanOrEqual(1);
      if (wide) await page.setViewportSize(wide);
      await assertClean(page, w, "the journal after a price change");

      // ---- «Вернуть» really puts the price back --------------------------
      await top.locator("[data-admundo]").click();
      // the toast first: it leaves after 2,6 s, and a slow server's write can take longer
      expect(await toastText(page)).toMatch(/Отменено/);
      await expect.poll(() => rowPrice(page, id), {
        timeout: 20_000, message: "«Вернуть» did not put the price back",
      }).toBe(14.9);
      await clearToast(page);

      // ---- and a box left as it was leaves no line at all ------------------
      await settings(page, "journal");
      const topWas = (await jrow(page, 0).textContent()) || "";
      await openCard(page, id);
      await page.locator("[data-edprice]").focus();
      await page.locator("[data-edprice]").blur();
      await settled(page);
      await settings(page, "journal");
      expect((await jrow(page, 0).textContent()) || "", "a box left as it was still wrote a journal line").toBe(topWas);
    } finally {
      // off the shelf, so the specs that count the catalogue never see it
      await page.request.delete(`/api/admin/products/${encodeURIComponent(id)}/`);
    }
  });

  test("the panel in English reads English — both lists", async ({ page }) => {
    test.setTimeout(240_000);
    const w = watch(page);
    const stamp = Date.now().toString().slice(-6);
    const BRAND = `Davines ${stamp}`;
    let id = "";

    await openAdmin(page);
    await tab(page, "goods");
    await page.locator("[data-admgoodsnew]").click();
    await page.locator("[data-edbrand]").fill(BRAND);
    await page.locator("[data-edname]").fill("Cheap price");
    await page.locator("[data-edcat]").selectOption("beard");
    await page.locator("[data-edprice]").fill("14,90");
    await page.locator('[data-admsavegoods="new"]').click();
    await clearToast(page);
    id = (await page.locator("[data-edfor]:not([data-edfor='new'])").getAttribute("data-edfor")) || "";

    try {
      /* One list since 1a (q7): a server row that is this browser's own line
         is shown once, as that line — so the shop's-log half is checked on a
         change this browser never saw, made straight through the route
         (before the price change, so the price stays the newest line). */
      // the suite's shop always has its pricing stored (e2e bootstrap) — written back as it is
      const pricing = (await (await page.request.get("/api/admin/settings/")).json()).settings.pricing;
      expect(pricing, "the suite's shop has no stored pricing to write back").toBeTruthy();
      expect((await page.request.put("/api/admin/settings/", { data: { pricing } })).ok()).toBe(true);

      // the price change the owner made — saved when the box is left (1a)
      await typeAndLeave(page, page.locator("[data-edprice]"), "9,90");
      await expect.poll(() => rowPrice(page, id), { timeout: 20_000 }).toBe(9.9);
      await clearToast(page);

      await settings(page, "journal");
      await adminLang(page, "EN");

      const top = jrow(page, 0);
      await expect(top, "the journal's own line is still Russian on an English panel")
        .toContainText("price: 14,90 € → 9,90 €");
      await expect(top).toContainText(`Product “${BRAND} — Cheap price”`);
      await expect(top.locator("[data-admundo]")).toHaveText("Restore");

      /* …and the shop's own rows among them: their words ARE dictionary keys,
         but a row once glued the word to what it named, and translateTree only
         rewrites a text node whose whole value it knows. */
      const server = page.locator(".adm-narrow .adm-jrow", { has: page.locator(".adm-jrow__who") });
      await expect(server.first(), "the server log did not arrive").toBeVisible({ timeout: 15_000 });
      await expect(page.locator(".adm-narrow"), "the shop's log is still Russian on an English panel")
        .toContainText("A setting changed");
      await expect(page.locator(".adm-narrow")).not.toContainText("Настройка изменена");
      await expect(page.locator(".adm-narrow")).not.toContainText("Свой товар изменён");
      await assertClean(page, w, "the journal in English");

      await adminLang(page, "RU");
    } finally {
      await page.request.delete(`/api/admin/products/${encodeURIComponent(id)}/`);
    }
  });
});

test.describe("admin — the banner editor opens where the owner can see it", () => {
  test.use({ extraHTTPHeaders: ipHeaders(192) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name === "tablet" || testInfo.project.name === "mobile-safari",
      "banner editor — desktop and mobile projects only");
  });

  test("a slide's title opens its form right under it, in view, and folds it away again", async ({ page }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    await openAdmin(page);
    const before = (await (await page.request.get("/api/admin/settings/")).json()).settings;
    try {
      await settings(page, "home");

      /* 1a (README § 5): a slide is a row — picture, its title (the button
         that opens it), ↑ ↓ and its switch — and its form opens INLINE, under
         that row, not under the whole list. */
      const row = page.locator('[data-herorow="0"]');
      const button = page.locator('[data-heroedit="0"]');
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await expect(button).toHaveAttribute("aria-controls", "heroform");

      // open it from the top of the page, the way a phone meets this screen
      await page.evaluate(() => window.scrollTo({ top: 0 }));
      await button.click();

      const form = page.locator("#heroform");
      await expect(form, "the slide's form was not drawn").toBeVisible();
      await expect(row.locator("#heroform"), "the form opened away from its slide").toHaveCount(1);
      /* In view, not «somewhere below»: the pane's top edge has to be inside the
         window after the render that opened it — that is the whole finding. */
      const view = page.viewportSize()!;
      const top = await page.evaluate(() => document.getElementById("heroform")!.getBoundingClientRect().top);
      expect(top, "the form opened below the fold — the tap looks like it did nothing").toBeLessThan(view.height);
      expect(top, "the form opened above the top of the screen").toBeGreaterThan(-1);

      // which slide is open, and how to close it
      await expect(row, "the open slide's row is not marked").toHaveClass(/is-open/);
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await expect(form.locator("[data-heroclose]").first(), "no way to fold the form").toBeVisible();
      expect(await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      "the open banner editor scrolls sideways").toBeLessThanOrEqual(1);
      await assertClean(page, w, "the banner editor with a slide open");

      /* Nothing INSIDE the pane may move the page — a previous round made
         picking a picture deliberately still (paintHeroPick), and that must
         survive this one. The tile is brought into view before the page's
         position is read (Playwright's pre-click scroll honours the root's
         scroll-padding; measured 23.09.2026). */
      const list = page.locator("#heroimglist");
      const other = await list.locator('[data-heroimg]:not([aria-current="true"])').first().getAttribute("data-heroimg");
      await list.locator(`[data-heroimg="${other}"]`).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const y0 = await page.evaluate(() => window.scrollY);
      await list.locator(`[data-heroimg="${other}"]`).click();
      await expect(list.locator(`[data-heroimg="${other}"]`)).toHaveAttribute("aria-current", "true");
      await page.waitForTimeout(300);
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - y0),
        "picking a picture moved the page again").toBeLessThan(4);

      // «Свернуть» folds it away and leaves the phone near the slide it was editing
      await form.locator("[data-heroclose]").first().click();
      await expect(page.locator("#heroform")).toHaveCount(0);
      await expect(page.locator('[data-heroedit="0"]')).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator('[data-herorow="0"]')).not.toHaveClass(/is-open/);
      const rowTop = await page.evaluate(() => {
        const el = document.querySelector('[data-herorow="0"]');
        return el ? el.getBoundingClientRect().top : 1e6;
      });
      expect(rowTop, "closing left the phone nowhere near the slide it was editing").toBeLessThan(view.height);

      // …and the slide's own button toggles, so a second tap folds it too
      await page.locator('[data-heroedit="0"]').click();
      await expect(page.locator("#heroform")).toBeVisible();
      await page.locator('[data-heroedit="0"]').click();
      await expect(page.locator("#heroform")).toHaveCount(0);
      await assertClean(page, w, "the banner editor after closing");
    } finally {
      // the picked picture saved itself (1a) — put the banner back as found
      await page.request.put("/api/admin/settings/", { data: { hero: before.hero ?? null } });
    }
  });
});
