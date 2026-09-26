import { expect, type Page, test } from "@playwright/test";
import { adminSection, cardBack, ipHeaders, loginAsAdmin } from "./fixtures";

/**
 * The panel on a phone is the phone's width, and its search boxes are one box.
 *
 * Dim, 25.09.2026, on his phone: «The "Главная страница" page seems to be too
 * wide» and «in search the magnifying glass seems a bit off». The first was a
 * page as wide as its widest content (427 px on a 390-px phone) that .adm2's
 * clip then cut — so nothing scrolled and nothing said it was cut: the
 * switches' «Вкл» and the ET/EN tabs were simply not on screen. The second
 * was two screens' rules both lifting the glass. A document-level scrollWidth
 * cannot see the first (the clip hides it), so this reads the boxes
 * themselves; the polish pass's full sweep (every screen, 360–414 px, three
 * languages) found the rest, and this keeps the two that were reported.
 */
test.describe("admin on a phone — nothing wider than the screen", () => {
  test.use({ extraHTTPHeaders: ipHeaders(244) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the phone's single column");
  });

  /** Elements of `scope` that reach past the viewport's right edge — except
   *  inside a box that scrolls sideways on purpose (the chip rows). */
  async function sticksOut(page: Page, scope: string): Promise<string[]> {
    return page.evaluate((sel) => {
      const vw = document.documentElement.clientWidth;
      const root = document.querySelector(sel);
      if (!root) return [`${sel} is not on the page`];
      const scrolls = (el: Element) => {
        for (let e = el.parentElement; e && e !== root.parentElement; e = e.parentElement) {
          const o = getComputedStyle(e).overflowX;
          if (o === "auto" || o === "scroll") return true;
        }
        return false;
      };
      return Array.from(root.querySelectorAll("*"))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 1 && r.height > 1 && r.right > vw + 1 && !el.closest(".vh") && !scrolls(el);
        })
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ").join(".")} ends at ${Math.round(el.getBoundingClientRect().right)} of ${vw}`);
    }, scope);
  }

  test("every «Настройки» page fits, «Главная страница» included", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await adminSection(page, "setup");
      for (const key of ["delivery", "home", "company", "prices", "push", "journal"]) {
        await page.locator(`[data-admsetpage="${key}"]`).click();
        const main = page.locator(`.adm-set__main[data-setpage="${key}"]`);
        await expect(main).toBeVisible();
        // the page is the screen's width, not its content's
        const w = await main.evaluate((el) => Math.round(el.getBoundingClientRect().width));
        expect(w, `«${key}» @${width}: the page is wider than the phone's column`).toBeLessThanOrEqual(width - 32);
        expect(await sticksOut(page, `.adm-set__main[data-setpage="${key}"]`), `«${key}» @${width}`).toEqual([]);
        await cardBack(page, "[data-admsetback]", "Настройки").click();
      }
    }
  });

  test("the magnifier sits halfway up every search box, clear of the words", async ({ page }) => {
    test.setTimeout(90_000);
    await loginAsAdmin(page);
    const boxes: Array<[string, string | undefined, string]> = [
      ["orders", undefined, "[data-admorderq]"],
      ["goods", undefined, "[data-goodsq]"],
      ["goods", "stock", "[data-stockq]"],
      ["pos", undefined, "[data-posq]"],
      ["people", undefined, "[data-admcustq]"],
    ];
    for (const [section, sub, sel] of boxes) {
      await adminSection(page, section, sub);
      const box = page.locator(sel);
      await expect(box).toBeVisible();
      const m = await box.evaluate((input) => {
        const glass = input.parentElement?.querySelector(".adm-search__i");
        const b = input.getBoundingClientRect();
        if (!glass || getComputedStyle(glass).display === "none") return null;
        const g = glass.getBoundingClientRect();
        return {
          off: (g.top + g.height / 2) - (b.top + b.height / 2),
          clear: b.left + parseFloat(getComputedStyle(input).paddingLeft) - g.right,
          font: parseFloat(getComputedStyle(input).fontSize),
        };
      });
      // «Салон» keeps its glass down to 360 px since its placeholder became «Товар или штрихкод» (26.09.2026)
      expect(m, `${sel}: no magnifier`).not.toBeNull();
      expect(Math.abs(m!.off), `${sel}: the glass is ${m!.off.toFixed(1)} px off the middle`).toBeLessThanOrEqual(1);
      expect(m!.clear, `${sel}: the words start under the glass`).toBeGreaterThanOrEqual(8);
      // 16 px or iOS zooms the page in when the box is tapped
      expect(m!.font, `${sel}: under 16 px`).toBeGreaterThanOrEqual(16);
    }
  });
});
