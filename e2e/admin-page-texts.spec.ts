import { expect, test } from "@playwright/test";
import { adminSection, ipHeaders, loginAsAdmin, shopUrl } from "./fixtures";

/**
 * «Настройки → Тексты страниц» (Dim, 26.10.2026: «Brand and section intros
 * should be in Settings — follow same design rules as for others»).
 *
 * A section's line under its heading is typed into its fold, saves itself
 * (no «Сохранить»), lands in settings.page_texts, and the shop draws it under
 * the section's heading; the box shows the standard text in grey in every
 * language, and emptying the box gives the standard back. On a phone the page
 * only has to draw: one write per action is enough, the desktop makes it.
 */
test.describe("«Тексты страниц»", () => {
  test.use({ extraHTTPHeaders: ipHeaders(227) });

  test("a section's line saves itself, shows in the shop, and an empty box gives the standard back", async ({ page, browser }, info) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await loginAsAdmin(page);
    const stored = async () => (await (await page.request.get("/api/admin/settings/")).json()).settings;
    const line = `E2E борода ${Date.now().toString().slice(-6)}`;
    try {
      await adminSection(page, "setup");
      await page.locator('[data-admsetpage="texts"]').click();
      const fold = page.locator('[data-admfold="pt:cat:beard"]');
      if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();
      const intro = page.locator('[data-autosave="pt:cat:beard:RU:intro"]');
      // empty, with the shop's own line in grey
      await expect(intro).toHaveValue("");
      await expect(intro).toHaveAttribute("placeholder", /Масло для бороды/);
      if (info.project.name !== "desktop") {
        expect(errors).toEqual([]);
        return;
      }

      await intro.fill(line);
      await expect(page.getByRole("status")).toContainText("Тексты страниц сохранены", { timeout: 15_000 });
      await expect.poll(async () => (await stored()).page_texts?.cat?.beard?.RU?.intro,
        { timeout: 20_000, message: "the line never reached settings.page_texts" }).toBe(line);

      /* a second line over it, then «Вернуть» on its toast: the first line
         on the server AND in the box (live test 26.10.2026 — the box kept
         the undone words). A render first, as any tap makes one: it draws
         the saved line into the box's markup, the state the bug needed. */
      await page.locator('[data-ptlang="ET"]').click();
      await page.locator('[data-ptlang="RU"]').click();
      await expect(intro).toHaveValue(line);
      await intro.fill(`${line} — вторая`);
      await expect.poll(async () => (await stored()).page_texts?.cat?.beard?.RU?.intro,
        { timeout: 20_000 }).toBe(`${line} — вторая`);
      await page.locator(".adm-toast__undo").click();
      await expect.poll(async () => (await stored()).page_texts?.cat?.beard?.RU?.intro,
        { timeout: 20_000, message: "«Вернуть» did not put the first line back" }).toBe(line);
      await expect(intro).toHaveValue(line);
      await intro.blur();
      await expect(intro, "the undone words came back into the box").toHaveValue(line);
      // …and the journal's row of the second line reads «вернули» (no «Вернуть» of its own)
      type Row = { id: number; payload?: { ref?: string; undoRef?: string }; undone?: true };
      const rows = ((await (await page.request.get("/api/admin/audit/?limit=20")).json()) as { audit: Row[] }).audit;
      const undoRow = rows.find((r) => r.payload?.undoRef);
      expect(undoRow, "the toast's «Вернуть» did not name the row it took back").toBeTruthy();
      expect(rows.find((r) => r.payload?.ref === undoRow!.payload!.undoRef)?.undone).toBe(true);

      // Estonian has its own standard text, not the Russian one
      await page.locator('[data-ptlang="ET"]').click();
      await expect(page.locator('[data-autosave="pt:cat:beard:ET:intro"]')).toHaveAttribute("placeholder", /Habemehooldusvahendid/);

      // the shop draws it under the section's heading
      const shop = await browser.newPage();
      await shop.goto(shopUrl("", "/c/beard/"));
      await expect(shop.locator(".sec__intro").first()).toHaveText(line, { timeout: 20_000 });
      await shop.close();

      // emptied: the standard line again
      await page.locator('[data-ptlang="RU"]').click();
      await page.locator('[data-autosave="pt:cat:beard:RU:intro"]').fill("");
      await expect.poll(async () => (await stored()).page_texts?.cat?.beard?.RU?.intro ?? "",
        { timeout: 20_000 }).toBe("");
      expect(errors).toEqual([]);
    } finally {
      await page.request.put("/api/admin/settings/", { data: { page_texts: { cat: {}, brand: {} } } });
    }
  });
});
