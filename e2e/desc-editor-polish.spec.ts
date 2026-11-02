import { expect, type Page, test } from "@playwright/test";
import { adminLang, ipHeaders } from "./fixtures";
import { openCard, settled, toSection } from "./goods-helpers";
import { assertClean, openAdmin, watch } from "./sweep-helpers";

/**
 * The description editor after Dim's note of 02.11.2026, written on the
 * ENGLISH panel: «Although my admin is in english — texts are in russian.
 * Also I do not see what «Разбить на разделы» really does, what becomes
 * bold and what doesn't.»
 *
 *   · on the EN panel the block has no Russian label, tooltip or notice, and
 *     opens on the English tab when there is an English text;
 *   · «Так увидит покупатель» follows the typing — a heading and a point;
 *   · «Разбить на разделы» shows a proposal and changes nothing until
 *     «Применить»; «Отмена» leaves the text; «Вернуть как было» puts it back.
 *     The AI is stubbed: what is under test is the panel, not the model.
 *
 * Its own product (not one other specs count), its description taken back
 * off in `finally`, and the panel back on Russian.
 */

const ID = "proraso-beard-oil-azur-lime-30ml";
const CYRILLIC = /[А-Яа-яЁё]/;

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop" && testInfo.project.name !== "mobile",
    "the description editor — desktop and mobile only, like the product editor");
});

async function setDesc(page: Page, description: Record<string, string> | null): Promise<void> {
  const r = await page.request.put("/api/admin/overrides/", { data: { id: ID, description } });
  expect(r.status(), await r.text()).toBe(200);
}
async function feedDesc(page: Page): Promise<unknown> {
  const body = await (await page.request.get("/api/overrides/")).json();
  return ((body.overrides || {})[ID] || {}).description ?? null;
}
/** The panel read the products when it opened: a text put in through the
    API reaches the card after a reload (still signed in — the cookie stays). */
async function reloadPanel(page: Page): Promise<void> {
  await page.reload();
  await expect(page.locator('[data-admtab="orders"][aria-current]:visible').first()).toBeVisible();
}

/** Every visible word of the block and every tooltip / label in it — the
    owner's own words ([data-notr]), the boxes and the language names left out. */
async function blockRussian(page: Page): Promise<string[]> {
  return page.locator('[data-edsec="desc"]').evaluate((sec) => {
    const out: string[] = [];
    const cyr = /[А-Яа-яЁё]/;
    const walk = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walk.nextNode())) {
      const el = n.parentElement;
      const t = (n.nodeValue || "").trim();
      if (!t || !el || !cyr.test(t)) continue;
      if (el.closest("[data-notr], textarea, .adm-seg__nm")) continue;
      // visible only: a closed «?» paragraph is checked once it is opened
      if (!(el as HTMLElement).offsetParent && getComputedStyle(el).position !== "fixed") continue;
      out.push(t);
    }
    sec.querySelectorAll("[title], [aria-label]").forEach((el) => {
      for (const a of ["title", "aria-label"]) {
        const v = el.getAttribute(a);
        if (v && cyr.test(v)) out.push(`${a}: ${v}`);
      }
    });
    return out;
  });
}

test.describe("the description editor, polished", () => {
  test.use({ extraHTTPHeaders: ipHeaders(250) });

  test("on the English panel: no Russian label, the English tab first, and the preview follows the typing", async ({ page }) => {
    test.setTimeout(150_000);
    const w = watch(page);
    await openAdmin(page);
    try {
      await setDesc(page, { RU: "Масло для бороды.", EN: "Beard oil.\n\nScent:\n— lime\n— mint" });
      await reloadPanel(page);
      await adminLang(page, "EN");
      await openCard(page, ID);
      await toSection(page, "desc");

      // the panel is English and so is the text: its tab is the one on screen
      await expect(page.locator('[data-eddesclang="en"]')).toHaveAttribute("aria-current", "true");
      await expect(page.locator("[data-eddescen]")).toBeVisible();
      await expect(page.locator("[data-eddescru]")).toBeHidden();

      const bar = page.locator('[role="toolbar"][aria-label="Description formatting"]');
      await expect(bar.locator('[data-edfmt="bold"]')).toHaveText("B");
      await expect(bar.locator('[data-edfmt="bold"]')).toHaveAttribute("title", "Bold: **text**");
      await expect(bar.locator('[data-edfmt="head"]')).toHaveText("Heading");
      await expect(bar.locator('[data-edfmt="list"]')).toHaveText("• List");
      await expect(page.locator("[data-admdescsplit]")).toHaveText("Split into sections");
      await expect(page.locator('[data-edsec="desc"] [data-edfmt="preview"]')).toHaveText("Shop view");
      await expect(page.locator(".adm-descprev__k")).toHaveText("What the customer sees");

      // the (?) open too — every sentence of the help in English
      const help = page.locator('[data-edsec="desc"] [data-admhelp]').first();
      if ((await help.getAttribute("aria-expanded")) !== "true") await help.click();
      await expect(page.locator('[data-edsec="desc"] .adm-helpp')).toBeVisible();
      expect(await blockRussian(page), "Russian left in the EN panel's «Описание»").toEqual([]);

      // the preview draws the English text: a heading and two points
      const prev = page.locator("[data-eddescprev]");
      await expect(prev.locator("p.desc-h > strong")).toHaveText("Scent:");
      await expect(prev.locator("ul li")).toHaveText(["lime", "mint"]);

      // the Russian tab: «Аромат:» and «— пункт» typed — a heading and a point at once, his words untranslated
      await page.locator('[data-eddesclang="ru"]').click();
      const ru = page.locator("[data-eddescru]");
      await expect(ru).toBeVisible();
      await ru.fill("");
      await ru.pressSequentially("Аромат:\n— пункт");
      await expect(prev.locator("p.desc-h > strong")).toHaveText("Аромат:");
      await expect(prev.locator("ul li")).toHaveText(["пункт"]);
      // «Shop view»: the same over the whole window, in the shop's own fold, the fold titled in the TEXT's language
      await page.locator('[data-edsec="desc"] [data-edfmt="preview"]').click();
      const sheet = page.locator('.adm-descshop[role="dialog"]');
      await expect(sheet).toBeVisible();
      await expect(sheet.locator(".adm-descshop__bar span")).toHaveText("This is how the product page shows the description");
      await expect(sheet.locator("summary")).toHaveText("Описание");
      await expect(sheet.locator(".acc__rich p.desc-h > strong")).toHaveText("Аромат:");
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      expect(await blockRussian(page), "Russian left after typing").toEqual([]);
      await settled(page, "the typed description");
      await assertClean(page, w, "the EN panel's description editor");
    } finally {
      await setDesc(page, null);
      await adminLang(page, "RU");
    }
  });

  test("«Разбить на разделы»: a proposal first — «Отмена» changes nothing, «Применить» then «Вернуть как было» restores", async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    const w = watch(page);
    const FLAT = "Масло для бороды Proraso. Преимущества: смягчает бороду, придаёт блеск.";
    const SPLIT = "Масло для бороды Proraso.\n\nПреимущества:\n— смягчает бороду\n— придаёт блеск";
    let asked = 0;
    await page.route("**/api/admin/ai/text/**", async (route) => {
      const body = route.request().postDataJSON() as { task?: string; lang?: string };
      if (body.task !== "sections") return route.continue();
      asked++;
      expect(body.lang, "the proposal is asked for the tab on screen").toBe("RU");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, text: SPLIT }) });
    });
    await openAdmin(page);
    try {
      await setDesc(page, { RU: FLAT });
      await expect.poll(() => feedDesc(page), { timeout: 15_000 }).toEqual({ RU: FLAT });
      await reloadPanel(page);
      await adminLang(page, "EN");
      await openCard(page, ID);
      await toSection(page, "desc");
      const box = page.locator("[data-eddescru]");
      await expect(box).toHaveValue(FLAT);
      const split = page.locator("[data-admdescsplit]");
      await expect(split).toHaveAttribute("title", /^Lays the open language's text out in sections/);

      // 1 — the proposal, named and drawn; the box untouched
      await split.click();
      const card = page.locator("[data-eddescsplitcard]");
      await expect(card).toBeVisible();
      await expect(card.locator(".adm-descsplit__t")).toHaveText("Proposal for the Russian text: the same words, with headings and bullet points.");
      await expect(card.locator("[data-eddescsplitto] p.desc-h > strong")).toHaveText("Преимущества:");
      await expect(card.locator("[data-eddescsplitto] ul li")).toHaveText(["смягчает бороду", "придаёт блеск"]);
      // what is there now stands beside it on a desktop (on a phone the preview under the box is the «now»)
      if (testInfo.project.name === "desktop") await expect(card.locator(".adm-descsplit__col--was")).toBeVisible();
      else await expect(card.locator(".adm-descsplit__col--was")).toBeHidden();
      await expect(box).toHaveValue(FLAT);
      expect(await blockRussian(page), "the proposal card speaks English").toEqual([]);

      // 2 — «Отмена»: the card goes, nothing changed or sent
      await card.locator('[data-edfmt="splitno"]').click();
      await expect(card).toHaveCount(0);
      await expect(box).toHaveValue(FLAT);
      expect(await feedDesc(page)).toEqual({ RU: FLAT });

      // 3 — «Применить»: into the box, saved like typing, «Вернуть как было» standing
      await split.click();
      await expect(card).toBeVisible();
      await card.locator('[data-edfmt="splitok"]').click();
      await expect(box).toHaveValue(SPLIT);
      const done = page.locator(".adm-descdone");
      await expect(done).toContainText("The Russian text is split into sections");
      await settled(page, "the applied split");
      await expect.poll(() => feedDesc(page), { timeout: 15_000 }).toEqual({ RU: SPLIT });
      // the save's own redraw keeps the offer
      await expect(done.locator('[data-edfmt="splitundo"]')).toHaveText("Undo");
      await expect(page.locator("[data-eddescprev] ul li")).toHaveCount(2);

      // 4 — «Вернуть как было»: the old text back, saved
      await done.locator('[data-edfmt="splitundo"]').click();
      await expect(box).toHaveValue(FLAT);
      await expect(done).toHaveCount(0);
      await settled(page, "the undone split");
      await expect.poll(() => feedDesc(page), { timeout: 15_000 }).toEqual({ RU: FLAT });
      expect(asked).toBe(2);
      await assertClean(page, w, "«Разбить на разделы»");
    } finally {
      await page.unroute("**/api/admin/ai/text/**");
      await setDesc(page, null);
      await adminLang(page, "RU");
    }
  });
});
