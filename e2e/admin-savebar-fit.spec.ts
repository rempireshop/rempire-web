import { expect, type Page, test } from "@playwright/test";
import { adminLang, adminSection, loginAsAdmin } from "./fixtures";

/**
 * **Does every word fit in the phone's save bar, in all three languages?**
 *
 * Ренат, 14.09.2026: «Have you tested it in each language and all letters fit
 * everywhere on mobile as well? I'm not sure about on mobile if everything
 * fits in the upper save bar in each language, are you sure? Check the sizes
 * of the letters.»
 *
 * It did not fit, and nobody could have seen it by looking: the bar's status
 * word is `text-overflow: ellipsis`, so a word too wide for its box is not a
 * broken layout, it is a slightly shorter word. At 360 px the Russian «Не
 * сохранено» had 75 px for 89 and the Estonian «Salvestamata» 70 for 86 —
 * both cut mid-word — and at 375 px Russian cleared by 0,7 px and Estonian by
 * nothing at all. So this test measures rather than looks, and it measures the
 * one thing a screenshot cannot show: the NATURAL width of the visible word
 * (a Range over its text) against the box it has to sit in.
 *
 * The subject is «Настройки → Доставка и оплата», which is the widest thing
 * the panel asks a phone to hold — one row per country, a column per carrier
 * (five from 14.09.2026, four since Nova Post left the home columns on
 * 22.09.2026), plus the courier and the
 * free-from threshold. The BAR, though, is every admin screen's: .adm-savebar
 * in admin.css is the phone's top header on the product editor, the mail
 * texts, a newsletter and all four settings pages. A fix for one is a fix for
 * all, and so is a regression.
 *
 * 360 px as well as 375: the smallest phone the shop sees (Galaxy A-series,
 * iPhone SE in landscape-safe mode) and the iPhone the owner actually holds.
 */

const WIDTHS = [375, 360];
const LANGS = ["RU", "ET", "EN"] as const;

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the phone's save bar — mobile project only");
});

async function openDelivery(page: Page): Promise<void> {
  await adminSection(page, "setup");
  const back = page.locator("[data-admsetback]");
  if (await back.count()) await back.first().click();
  await page.locator('[data-admsetpage="delivery"]').first().click();
  await expect(page.locator("[data-setbar]")).toBeVisible();
}

interface Fit {
  /** The bar's own height. One row is 53 px: 4 + 44 + 4 + a 1-px rule. */
  barHeight: number;
  /** The page, sideways. A rate screen that scrolls sideways hides a price. */
  sideways: boolean;
  /** Every word in the bar, with the room it has and the room it needs. */
  words: Array<{ what: string; box: number; needs: number }>;
  /** Anything inside the viewport that sticks out of it. */
  overflowing: string[];
  /** Controls under 44 × 44 — text and size, so a failure names the culprit. */
  small: string[];
}

/** One reading of the whole screen, taken in the browser in one go. */
async function fit(page: Page): Promise<Fit> {
  return await page.evaluate(() => {
    /** The natural width of an element's own text, box be damned. */
    const textWidth = (el: Element): number => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return +r.getBoundingClientRect().width.toFixed(1);
    };
    /** The one child of `el` this viewport actually draws (the --long/--short pair). */
    const shown = (el: Element): Element =>
      Array.from(el.querySelectorAll<HTMLElement>("span")).find(
        (s) => s.offsetParent !== null && s.getBoundingClientRect().width > 0,
      ) ?? el;

    const bar = document.querySelector<HTMLElement>("[data-setbar]");
    const words: Fit["words"] = [];
    if (bar) {
      for (const child of Array.from(bar.children)) {
        const el = child as HTMLElement;
        const target = shown(el);
        words.push({
          what: (target.textContent || "").trim(),
          box: el.clientWidth,
          needs: Math.ceil(textWidth(target)),
        });
      }
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
    document.querySelectorAll<HTMLElement>("button, input, summary, a[href]").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (getComputedStyle(el).visibility === "hidden") return;
      if (r.width < 43.5 || r.height < 43.5) {
        small.push(`${r.width.toFixed(0)}×${r.height.toFixed(0)} «${(el.textContent || "").trim().slice(0, 30)}»`);
      }
    });

    return {
      barHeight: bar ? bar.offsetHeight : 0,
      sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 0.5,
      words,
      overflowing,
      small,
    };
  });
}

/** Asserts one reading, naming the state so a failure says which of the four. */
function assertFits(f: Fit, state: string): void {
  expect(f.sideways, `${state}: the page scrolls sideways`).toBe(false);
  /* One row. The bar is `flex-wrap: wrap`, so a word that will not fit does
     not overflow — it takes a second row and pushes the form down under a
     header that is suddenly twice as tall. Height is what catches that; the
     word widths below catch the other failure, the silent ellipsis. */
  expect(f.barHeight, `${state}: the save bar wrapped to a second row`).toBeLessThanOrEqual(56);
  expect(f.barHeight, `${state}: the save bar has no row at all`).toBeGreaterThanOrEqual(48);
  for (const w of f.words) {
    expect(w.needs, `${state}: «${w.what}» needs ${w.needs} px and has ${w.box}`).toBeLessThanOrEqual(w.box);
  }
  expect(f.overflowing, `${state}: something is wider than the screen`).toEqual([]);
  expect(f.small, `${state}: a control smaller than 44 × 44`).toEqual([]);
}

for (const width of WIDTHS) {
  for (const lang of LANGS) {
    test(`the save bar holds every word at ${width} px in ${lang}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 812 });
      await loginAsAdmin(page);
      await adminLang(page, lang);
      await openDelivery(page);

      // «Изменений нет» — the quiet bar, one word and a disabled button
      assertFits(await fit(page), `${width}/${lang}/clean`);

      // «Не сохранено» — the widest state: cancel + word + button, all three
      const cell = page.locator('[data-shiprule="c:omniva:EE"]');
      await cell.fill("3.49");
      await cell.blur();
      await expect(page.locator("[data-setnote]")).toBeVisible();
      assertFits(await fit(page), `${width}/${lang}/unsaved`);

      // …while it saves: the confirm card stands over the page and the bar stays
      await page.locator("[data-admshipsave]").first().click();
      await expect(page.locator("[data-admapply]")).toBeVisible();
      assertFits(await fit(page), `${width}/${lang}/saving`);

      // «Сохранено ✓» on the button, the word and the cancel both gone
      await page.locator("[data-admapply]").first().click();
      await expect(page.locator("[data-admapply]")).toHaveCount(0);
      await expect(page.locator("[data-admshipsave]")).toBeVisible();
      assertFits(await fit(page), `${width}/${lang}/saved`);

      /* Take Estonia's Omniva override back out. Every spec in this run shares
         one in-memory database (playwright.config.ts, workers: 1), so a 3,49 €
         left behind here is a 3,49 € the checkout specs would price against.
         «вернуть» clears the cell and the second save writes the table without
         it — after which the box is EMPTY, not 3,19. That is the r22 contract
         (17.09.2026, «пустая клетка в тарифах остаётся пустой»,
         cleanShippingRules() in src/lib/shipping.ts): the screen shows and
         saves the owner's OWN row, and a cell he never filled in is absent
         from it rather than written down at whatever Montonio charged that
         day. Before that the save seeded every missing cell from the defaults
         and the box came back materialised at 3,19.

         Both halves are asserted, because an empty box is also what a save
         that quietly dropped the whole row would look like: the stored row
         must no longer carry this cell at all, and the money is unchanged —
         quoteFromRules() reads Montonio's own 3,19 € when the row says
         nothing about the cell. */
      await page.locator('[data-shipclear="c:omniva:EE"]').first().click();
      await page.locator("[data-admshipsave]").first().click();
      await page.locator("[data-admapply]").first().click();
      await expect(page.locator("[data-admapply]")).toHaveCount(0);
      await expect(page.locator('[data-shiprule="c:omniva:EE"]')).toHaveValue("");
      await expect
        .poll(async () => {
          const feed = await page.request.get(`/api/overrides/?t=${Date.now()}`);
          const stored = (await feed.json()) as {
            settings?: { shipping_rules?: { carriers?: Record<string, Record<string, number>> } };
          };
          return stored.settings?.shipping_rules?.carriers?.omniva?.EE;
        }, { message: "the 3,49 € override outlived the test" })
        .toBeUndefined();
    });
  }
}
