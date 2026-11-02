import { expect, type Page, test } from "@playwright/test";
import { ipHeaders, LANGS, shopUrl, waitForScreen } from "./fixtures";

/**
 * «Доставка и оплата» names every country (02.11.2026, owner-approved): the
 * four home rows, then «Ещё 21 страна ЕС» folded underneath with one row per
 * European country the checkout offers. tests/delivery-page-countries.test.ts
 * holds the prices and the words; this holds what only a browser can show:
 *
 *   · at 390 px (a phone) the fold opens into one block per country — name
 *     and carriers, then three prices each under its own label — and nothing
 *     on the page scrolls sideways;
 *   · at 1440 px it is a table whose columns sit under the home table's;
 *   · the page the shop draws after boot lists the same countries, in the
 *     same order, at the same prices, as the prerendered page a crawler reads
 *     — in all three languages.
 *
 * Both viewports are set here explicitly, so the checks run once, on the
 * desktop project (Chromium).
 */

type Row = { country: string; cells: string[] };

/** The fold's rows as the browser shows them — the per-cell labels left out. */
async function domRows(page: Page): Promise<Row[]> {
  return page.locator(".dlv__eu tbody tr").evaluateAll((trs) =>
    trs.map((tr) => {
      const th = tr.querySelector("th")!;
      const name = (th.querySelector("span")?.textContent ?? "").trim();
      const cells = [...tr.querySelectorAll("td")].map((td) => {
        const c = td.cloneNode(true) as HTMLElement;
        c.querySelectorAll(".dlv__lbl").forEach((l) => l.remove());
        return (c.textContent ?? "").replace(/\s+/g, " ").trim();
      });
      return { country: name, cells };
    }),
  );
}

/** …and as the prerendered HTML has them. */
function htmlRows(html: string): Row[] {
  const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const table = (/<table class="dlv__eu">([\s\S]*?)<\/table>/.exec(html) || [])[1] || "";
  return (table.split("<tbody>")[1] || "").split("</tr>").filter((tr) => tr.includes('<th scope="row">')).map((tr) => {
    const th = /<th scope="row">([\s\S]*?)<\/th>/.exec(tr)![1];
    return {
      country: text((/<span>([\s\S]*?)<\/span>/.exec(th) || [])[1] || ""),
      cells: [...tr.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => text(m[1].replace(/<span class="dlv__lbl">[\s\S]*?<\/span>/, ""))),
    };
  });
}

test.describe("«Доставка и оплата» — every country", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "both viewports are set here — run once, on desktop");
  });
  test.use({ extraHTTPHeaders: ipHeaders(83) });

  test("at 390 px: the fold opens into one readable block per country, nothing scrolls sideways", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(shopUrl("", "/info/shipping/"));
    await waitForScreen(page, "info");

    await expect(page.locator(".sec__intro")).toContainText("Финляндию и ещё 21 страну ЕС");
    await expect(page.locator(".dlv")).not.toContainText("Другие страны Европы");
    const fold = page.locator("details.dlv__all");
    await expect(fold).toBeVisible();
    expect(await fold.evaluate((d) => (d as HTMLDetailsElement).open), "the fold starts closed").toBe(false);
    const summary = fold.locator("summary");
    expect((await summary.textContent())?.trim()).toBe("Ещё 21 страна ЕС");
    expect((await summary.boundingBox())?.height ?? 0, "the summary is a real touch target").toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath("shipping-390-closed.png"), fullPage: false });

    await summary.click();
    const rows = page.locator(".dlv__eu tbody tr");
    await expect(rows).toHaveCount(21);
    await expect(rows.first()).toBeVisible();

    // the header row is for screen readers only; every price carries its own label
    expect(await page.locator(".dlv__eu thead").evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
    const shape = await rows.evaluateAll((trs) => trs.map((tr) => {
      const r = tr.getBoundingClientRect();
      const labels = [...tr.querySelectorAll(".dlv__lbl")].map((l) => {
        const b = l.getBoundingClientRect();
        return { w: b.width, h: b.height, text: (l.textContent ?? "").trim() };
      });
      const cells = [...tr.querySelectorAll("td")].map((td) => td.getBoundingClientRect());
      return { h: r.height, right: r.right, labels, cellTops: cells.map((c) => Math.round(c.top)), cellRights: cells.map((c) => c.right) };
    }));
    for (const [i, s] of shape.entries()) {
      expect(s.labels.map((l) => l.text), `row ${i}`).toEqual(["Пакомат", "Курьер", "Бесплатно от"]);
      for (const l of s.labels) expect(l.h, `row ${i} label`).toBeGreaterThan(0);
      // the three prices side by side on one line, under the name — not a column of nine lines
      expect(new Set(s.cellTops).size, `row ${i}: prices on one line`).toBe(1);
      expect(s.h, `row ${i} height`).toBeLessThan(110);
      for (const right of s.cellRights) expect(right, `row ${i} inside the screen`).toBeLessThanOrEqual(390);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "the page spills sideways on a phone").toBeLessThanOrEqual(1);

    // Poland: Nova Post's locker, and Greece: a courier only
    const pl = page.locator(".dlv__eu tbody tr", { hasText: "Польша" });
    await expect(pl).toContainText("Nova Post");
    await expect(pl.locator("td").first()).toContainText("от 5,49 €");
    const gr = page.locator(".dlv__eu tbody tr", { hasText: "Греция" });
    await expect(gr.locator("td").first()).toContainText("—");
    await gr.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("shipping-390-open.png"), fullPage: false });
    await pl.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("shipping-390-poland.png"), fullPage: false });
  });

  test("at 1440 px: a table under the home table, columns in line, labels hidden", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(shopUrl("", "/info/shipping/"));
    await waitForScreen(page, "info");
    await page.locator("details.dlv__all summary").click();
    await expect(page.locator(".dlv__eu tbody tr")).toHaveCount(21);
    await expect(page.locator(".dlv__eu thead")).toBeVisible();
    await expect(page.locator(".dlv__eu .dlv__lbl").first()).toBeHidden();
    // the columns of the two tables line up
    for (const col of [1, 2, 3, 4]) {
      const home = await page.locator(`.dlv__table thead th:nth-child(${col})`).boundingBox();
      const eu = await page.locator(`.dlv__eu thead th:nth-child(${col})`).boundingBox();
      expect(Math.abs((home?.x ?? 0) - (eu?.x ?? -99)), `column ${col}`).toBeLessThanOrEqual(2);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.locator(".dlv__table").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("shipping-1440-open.png"), fullPage: false });
  });

  for (const lang of LANGS) {
    test(`the live page and the prerendered one list the same countries, order and prices — ${lang.code}`, async ({ page, request }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const html = await (await request.get(shopUrl(lang.seg, "/info/shipping/"))).text();
      const fromHtml = htmlRows(html);
      expect(fromHtml).toHaveLength(21);
      const introHtml = ((/<p class="sec__intro">([\s\S]*?)<\/p>/.exec(html) || [])[1] || "").trim();

      await page.goto(shopUrl(lang.seg, "/info/shipping/"));
      await waitForScreen(page, "info");
      await page.locator("details.dlv__all summary").click();
      await expect(page.locator(".dlv__eu tbody tr")).toHaveCount(21);
      expect(await domRows(page)).toEqual(fromHtml);
      expect((await page.locator(".sec__intro").textContent())?.trim()).toBe(introHtml);
      if (lang.code !== "RU") {
        const text = await page.locator(".dlv__all").innerText();
        expect(text.split("\n").filter((l) => /[А-Яа-яЁё]/.test(l)), "Russian left in the fold").toEqual([]);
      }
    });
  }
});
