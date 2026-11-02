import { expect, type Page, test } from "@playwright/test";
import { ipHeaders, shopUrl, waitForScreen } from "./fixtures";
import { openCard, settled, toSection } from "./goods-helpers";
import { assertClean, openAdmin, watch } from "./sweep-helpers";

/**
 * Product descriptions with sections (Dim, 02.11.2026; design
 * canvas-banner/project/Desc.dc.html). The owner's text is plain text with a
 * light markup — a short line ending in «:» is a bold heading, «— » starts a
 * point, **word** is bold (src/lib/desc-format.mjs) — and:
 *   · the product page draws it as <strong> headings and <ul> lists, on a
 *     phone and on a desktop, with nothing in it ever becoming markup;
 *   · the card's «Описание» has the format bar — «Ж», «Заголовок»,
 *     «• Список» change the text in the box, the box keeps its focus,
 *     «Так увидит покупатель» beside / under the box shows it as the page
 *     will, and «Как в магазине» opens that over the whole window. The ET/EN
 *     panel and «Разбить на разделы» are e2e/desc-editor-polish.spec.ts.
 *
 * Its own product (not fixtures' PRODUCT / PRODUCT_2, which other specs count
 * and price), and its description is taken back off in `finally`.
 */

const ID = "proraso-beard-oil-azur-lime-30ml";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop" && testInfo.project.name !== "mobile",
    "descriptions with sections — desktop and mobile only, like the product editor");
});

async function setDesc(page: Page, description: Record<string, string> | null): Promise<void> {
  const r = await page.request.put("/api/admin/overrides/", { data: { id: ID, description } });
  expect(r.status(), await r.text()).toBe(200);
}
async function feedDesc(page: Page): Promise<unknown> {
  const body = await (await page.request.get("/api/overrides/")).json();
  return ((body.overrides || {})[ID] || {}).description ?? null;
}

const TEXT = [
  "Масло для бороды Proraso с ароматом **лайма** и мяты.",
  "",
  "Преимущества:",
  "",
  "для длинной и густой бороды",
  "смягчает бороду и придаёт ей блеск",
  "произведено в Италии",
  "",
  "Применение:",
  "— нанесите несколько капель на ладони",
  "— распределите по бороде",
  "",
  "Объём: 30 мл",
  "",
  "**<img src=x onerror=alert(1)>** <script>alert(1)</script>",
].join("\n");

test.describe("descriptions with sections", () => {
  test.use({ extraHTTPHeaders: ipHeaders(177) });

  test("the product page draws bold headings and lists — and nothing of the text as markup", async ({ page }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    await openAdmin(page);
    try {
      await setDesc(page, { RU: TEXT });
      await expect.poll(() => feedDesc(page), { timeout: 15_000 }).toEqual({ RU: TEXT });

      await page.goto(shopUrl("", `/p/${ID}/`));
      await waitForScreen(page, "product");
      const box = page.locator("[data-pdpdesc]");
      // «Описание» is a <details> that starts shut
      const fold = page.locator("details.acc", { has: box });
      if ((await fold.getAttribute("open")) === null) await fold.locator("summary").click();
      await expect(box).toBeVisible();

      const heads = box.locator("p.desc-h > strong");
      await expect(heads).toHaveText(["Преимущества:", "Применение:"]);
      const lists = box.locator("ul");
      await expect(lists).toHaveCount(2);
      // the implicit list: three plain lines under «Преимущества:» are points
      await expect(lists.nth(0).locator("li")).toHaveText(["для длинной и густой бороды", "смягчает бороду и придаёт ей блеск", "произведено в Италии"]);
      await expect(lists.nth(1).locator("li")).toHaveText(["нанесите несколько капель на ладони", "распределите по бороде"]);
      // the label is bold, the sentence's own bold too
      await expect(box.locator("p", { hasText: "30 мл" }).locator("strong")).toHaveText("Объём:");
      await expect(box.locator("p").first().locator("strong")).toHaveText("лайма");
      // the paste is text
      await expect(box).toContainText("<img src=x onerror=alert(1)>");
      await expect(box).toContainText("<script>alert(1)</script>");
      expect(await page.locator(".pdp img[onerror], .pdp script").count(), "the owner's text became markup").toBe(0);

      // a heading reads as one: bold capitals, its list right under it
      const look = await heads.first().evaluate((el) => {
        const cs = getComputedStyle(el.parentElement as Element);
        return { weight: Number(getComputedStyle(el).fontWeight), transform: cs.textTransform };
      });
      expect(look.weight).toBeGreaterThanOrEqual(700);
      expect(look.transform).toBe("uppercase");
      // nothing in the text pushes the page sideways on a phone
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await assertClean(page, w, "the product page with sections");
    } finally {
      await setDesc(page, null);
    }
  });

  test("the card's format bar writes the marks, keeps the box focused, and «Как в магазине» shows the page's drawing", async ({ page }) => {
    test.setTimeout(150_000);
    const w = watch(page);
    await openAdmin(page);
    try {
      await openCard(page, ID);
      await toSection(page, "desc");
      const box = page.locator("[data-eddescru]");
      const bar = page.locator('[role="toolbar"][aria-label="Оформление описания"]');
      await expect(bar).toBeVisible();
      // thumb-sized, all three — and «Как в магазине» on the preview's own head
      for (const kind of ["bold", "head", "list"]) {
        const b = await bar.locator(`[data-edfmt="${kind}"]`).boundingBox();
        expect(b && b.height >= 44 && b.width >= 44, `«${kind}» is smaller than 44 px`).toBe(true);
      }
      const shopBtn = page.locator('[data-edsec="desc"] [data-edfmt="preview"]');
      const sb = await shopBtn.boundingBox();
      expect(sb && sb.height >= 44, "«Как в магазине» is smaller than 44 px").toBe(true);

      await box.fill("Шампунь для объёма.\nПреимущества\nобъём без утяжеления\nлёгкий аромат");
      const select = (a: number, b: number) => box.evaluate((el, r) => { (el as HTMLTextAreaElement).focus(); (el as HTMLTextAreaElement).setSelectionRange(r[0], r[1]); }, [a, b]);
      const value = () => box.inputValue();

      // «Заголовок» on the caret's line: its own line, «:», an empty line above
      let v = await value();
      await select(v.indexOf("Преимущества") + 3, v.indexOf("Преимущества") + 3);
      await bar.locator('[data-edfmt="head"]').click();
      await expect.poll(value).toBe("Шампунь для объёма.\n\nПреимущества:\nобъём без утяжеления\nлёгкий аромат");
      expect(await box.evaluate((el) => document.activeElement === el), "the box lost its focus to the bar").toBe(true);

      // «• Список» on the two lines under it
      v = await value();
      await select(v.indexOf("объём без"), v.length);
      await bar.locator('[data-edfmt="list"]').click();
      await expect.poll(value).toBe("Шампунь для объёма.\n\nПреимущества:\n— объём без утяжеления\n— лёгкий аромат");
      // the block it touched stays selected
      expect(await box.evaluate((el) => {
        const t = el as HTMLTextAreaElement;
        return t.value.slice(t.selectionStart, t.selectionEnd);
      })).toBe("— объём без утяжеления\n— лёгкий аромат");

      // «Ж» on a selected word
      v = await value();
      await select(v.indexOf("объёма"), v.indexOf("объёма") + "объёма".length);
      await bar.locator('[data-edfmt="bold"]').click();
      await expect.poll(value).toBe("Шампунь для **объёма**.\n\nПреимущества:\n— объём без утяжеления\n— лёгкий аромат");

      // «Так увидит покупатель»: always on the card, the text as the product page draws it, live
      const prev = page.locator("[data-eddescprev]");
      await expect(prev).toBeVisible();
      await expect(prev.locator("p.desc-h > strong")).toHaveText("Преимущества:");
      await expect(prev.locator("ul li")).toHaveText(["объём без утяжеления", "лёгкий аромат"]);
      await expect(prev.locator("p").first().locator("strong")).toHaveText("объёма");
      await box.press("End");
      await box.pressSequentially("\n— мягкость");
      await expect(prev.locator("ul li")).toHaveCount(3);
      // «Как в магазине»: the same text over the whole window, in the product page's own fold
      await shopBtn.click();
      const sheet = page.locator('.adm-descshop[role="dialog"]');
      await expect(sheet).toBeVisible();
      await expect(sheet.locator("details.acc[open] .acc__rich p.desc-h > strong")).toHaveText("Преимущества:");
      await expect(sheet.locator(".acc__rich ul li")).toHaveCount(3);
      await sheet.locator('[data-edfmt="shopclose"]').click();
      await expect(sheet).toHaveCount(0);

      // what the bar wrote saves itself like typing does, and reaches the shop
      await settled(page, "the formatted description");
      await expect.poll(async () => JSON.stringify(await feedDesc(page)), { timeout: 15_000 })
        .toContain("Преимущества:\\n— объём без утяжеления");
      await assertClean(page, w, "the format bar");
    } finally {
      await setDesc(page, null);
    }
  });
});
