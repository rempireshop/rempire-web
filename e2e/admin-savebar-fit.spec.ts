import { expect, type Page, test } from "@playwright/test";
import { adminLang, adminSection, cardBack, loginAsAdmin } from "./fixtures";

/**
 * **Does every word fit on the phone's delivery page, in all three languages?**
 *
 * Ренат, 14.09.2026: «Have you tested it in each language and all letters fit
 * everywhere on mobile as well? I'm not sure about on mobile if everything
 * fits in the upper save bar in each language, are you sure? Check the sizes
 * of the letters.»
 *
 * It did not fit then, and nobody could have seen it by looking: a status word
 * is `text-overflow: ellipsis`, so a word too wide for its box is not a broken
 * layout, it is a slightly shorter word. So this test measures rather than
 * looks: the NATURAL width of each visible word (a Range over its text)
 * against the box it has to sit in.
 *
 * 1a (25.09.2026) took the save bar off «Настройки» — every box saves itself,
 * and the phone's top bar says «Сохраняем… / Сохранено ✓ / Не сохранилось»
 * (.adm-savest--top). What the owner has to read on this page now is that
 * status, and the two new words under a price below Montonio's tariff: the
 * rust «Ниже тарифа Montonio: …» and «Оставить так» (q4). All of it measured
 * here, with the rest of the old contract: nothing sideways, nothing sticking
 * out, no control under 44 × 44.
 *
 * The subject is «Настройки → Доставка и оплата», still the widest thing the
 * panel asks a phone to hold. 360 px as well as 375: the smallest phone the
 * shop sees and the iPhone the owner actually holds.
 */

const WIDTHS = [375, 360];
const LANGS = ["RU", "ET", "EN"] as const;

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the phone's delivery page — mobile project only");
});

async function openDelivery(page: Page): Promise<void> {
  await adminSection(page, "setup");
  const back = cardBack(page, "[data-admsetback]", "Настройки");
  if (await back.count()) await back.click();
  await page.locator('[data-admsetpage="delivery"]').first().click();
  await expect(page.locator('[data-shiprule="c:omniva:EE"]')).toBeVisible();
}

interface Fit {
  /** The phone's top bar — one row: it must not grow a second line. */
  topHeight: number;
  /** The page, sideways. A rate screen that scrolls sideways hides a price. */
  sideways: boolean;
  /** Every word under test, with the room it has and the room it needs. */
  words: Array<{ what: string; box: number; needs: number }>;
  /** Anything inside the viewport that sticks out of it. */
  overflowing: string[];
  /** Controls under 44 × 44 — text and size, so a failure names the culprit. */
  small: string[];
}

/** One reading of the whole screen, taken in the browser in one go. */
async function fit(page: Page, selectors: string[]): Promise<Fit> {
  return await page.evaluate((sels) => {
    /** The natural width of an element's own text, box be damned. */
    const textWidth = (el: Element): number => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return +r.getBoundingClientRect().width.toFixed(1);
    };
    const words: Fit["words"] = [];
    for (const sel of sels) {
      document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
        if (el.offsetParent === null) return;
        /* A word that is allowed to wrap onto two lines is not cut: the box
           it must fit is its own width on one line only when it does not
           wrap — so measure a single-line word against its box, and a
           wrapped one against the page. */
        const cs = getComputedStyle(el);
        const oneLine = cs.whiteSpace === "nowrap" || cs.textOverflow === "ellipsis";
        words.push({
          what: (el.textContent || "").trim(),
          box: oneLine ? el.clientWidth : document.documentElement.clientWidth,
          needs: Math.ceil(oneLine ? textWidth(el) : Math.min(textWidth(el), el.scrollWidth)),
        });
      });
    }

    const vw = document.documentElement.clientWidth;
    const overflowing: string[] = [];
    const small: string[] = [];
    document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.right > vw + 0.5 || r.left < -0.5) {
        overflowing.push(`${el.tagName}.${el.className} right=${r.right.toFixed(1)} > ${vw}`);
      }
    });
    document.querySelectorAll<HTMLElement>(".adm-page button, .adm-page input, .adm-page select, .adm-top button").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (getComputedStyle(el).visibility === "hidden") return;
      if (r.width < 43.5 || r.height < 43.5) {
        small.push(`${r.width.toFixed(0)}×${r.height.toFixed(0)} «${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}»`);
      }
    });
    const top = document.querySelector<HTMLElement>(".adm-top");
    return {
      topHeight: top ? top.offsetHeight : 0,
      sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 0.5,
      words,
      overflowing,
      small,
    };
  }, selectors);
}

/** Asserts one reading, naming the state so a failure says which one. */
function assertFits(f: Fit, state: string): void {
  expect(f.sideways, `${state}: the page scrolls sideways`).toBe(false);
  expect(f.topHeight, `${state}: the top bar wrapped to a second row`).toBeLessThanOrEqual(64);
  for (const w of f.words) {
    expect(w.needs, `${state}: «${w.what}» needs ${w.needs} px and has ${w.box}`).toBeLessThanOrEqual(w.box);
  }
  expect(f.overflowing, `${state}: something is wider than the screen`).toEqual([]);
  expect(f.small, `${state}: a control smaller than 44 × 44`).toEqual([]);
}

const STATUS = ".adm-savest--top .adm-savest__t";
const HELD = ['[data-rtrow="EE"] .adm-hint--loss', '[data-rtrow="EE"] .adm-rt__keep', "[data-shipheld] div"];

for (const width of WIDTHS) {
  for (const lang of LANGS) {
    test(`the delivery page holds every word at ${width} px in ${lang}`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 812 });
      await loginAsAdmin(page);
      const stored = async () => (await (await page.request.get("/api/admin/settings/")).json()).settings.shipping_rules ?? null;
      const original = await stored();
      try {
        await adminLang(page, lang);
        await openDelivery(page);

        // untouched: nothing held, nothing to say
        assertFits(await fit(page, [STATUS]), `${width}/${lang}/clean`);

        /* A price under Montonio's tariff: the box turns rust, «Ниже тарифа
           Montonio: 3,19 €» and «Оставить так» under it, a line at the top of
           the page — the widest state this page has. Nothing is sent yet. */
        const cell = page.locator('[data-shiprule="c:omniva:EE"]');
        await cell.fill("1");
        await cell.press("Tab");
        await expect(page.locator('[data-shipaccept="c:omniva:EE"]')).toBeVisible();
        assertFits(await fit(page, [STATUS, ...HELD]), `${width}/${lang}/held`);

        // «Оставить так»: saved with the accept flag, «Сохранено ✓» on top
        const put = page.waitForResponse((r) => r.url().includes("/api/admin/settings/") && r.request().method() === "PUT");
        await page.locator('[data-shipaccept="c:omniva:EE"]').click();
        expect((await put).ok()).toBe(true);
        await expect(page.locator(".adm-savest--top .adm-savest__t--ok")).toBeAttached();
        assertFits(await fit(page, [STATUS, '[data-rtrow="EE"] .adm-hint--loss']), `${width}/${lang}/saved`);

        /* Take Estonia's Omniva override back out: «вернуть» under the box
           empties it and saves — after which the stored row no longer carries
           the cell at all (cleanShippingRules(), r22), and the box is EMPTY. */
        await page.locator('[data-shipclear="c:omniva:EE"]').first().click();
        await expect(page.locator('[data-shiprule="c:omniva:EE"]')).toHaveValue("");
        await expect.poll(async () => (await stored())?.carriers?.omniva?.EE,
          { timeout: 20_000, message: "the 1 € override outlived the test" }).toBeUndefined();
      } finally {
        await page.request.put("/api/admin/settings/", { data: { shipping_rules: original ?? {} } });
      }
    });
  }
}
