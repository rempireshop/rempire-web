import { expect, type Page, test } from "@playwright/test";
import { adminLang, adminSection, ipHeaders, LANGS, shopUrl, waitForScreen } from "./fixtures";
import { openAdmin } from "./sweep-helpers";

/**
 * Renat's acceptance run, 17.09.2026 — the language findings.
 *
 *   «Настройки → Цены и баллы, change something: the card asks "Change prices
 *    and points?" in English and answers itself in Russian.»
 *
 * The heading was a key and the body was ASSEMBLED — «Цены и лояльность:
 * партнёры и баллы включены · скидка для салонов 20% · …» — and
 * translateTree() rewrites a text node only when it recognises the whole of
 * it. The card paints a node per line and a node per « · » fact now
 * (admDetailHTML in public/shop2/app.js).
 *
 *   «The popular-search chips read shampoo, beard, Davines — tapping shampoo
 *    searches шампунь and shows that in the box.»
 *
 * The label was a text node the dictionary rewrote; the query behind it sat in
 * data-q, which is not a text node, and stayed Russian.
 */

/** «Настройки» → one of its pages (same helper as admin-journal-r16). */
async function settings(page: Page, sub: string): Promise<void> {
  await adminSection(page, "setup");
  const back = page.locator("[data-admsetback]");
  if (await back.count()) await back.first().click();
  await page.locator(`[data-admsetpage="${sub}"]`).click();
  await expect(page.locator("[data-admsetback]")).toBeVisible();
}

const CYRILLIC = /[А-Яа-яЁё]/;

test.describe("the panel's composed lines answer in the panel's own language", () => {
  test.use({ extraHTTPHeaders: ipHeaders(178) });

  /* 1a (25.09.2026, q40): «Цены и баллы» asks no question any more — a box
     saves when it is left, with «Вернуть». The ASSEMBLED line the card used
     to show lives on as the change's journal line, painted the same way (a
     node per « · » fact, admPiecesHTML), so that is where the language is
     checked now. */
  for (const lang of ["RU", "ET", "EN"] as const) {
    test(`«Цены и баллы» — the journal line is ${lang} from its label to its last fact`, async ({ page }) => {
      test.setTimeout(120_000);
      await openAdmin(page);
      const was = (await (await page.request.get("/api/admin/settings/")).json()).settings.pricing ?? {};
      try {
        await adminLang(page, lang);
        await settings(page, "prices");

        const pct = page.locator('[data-pricingf="proDiscountPct"]');
        await expect(pct).toBeVisible();
        await pct.fill("25");
        const put = page.waitForResponse((r) => r.url().includes("/api/admin/settings/") && r.request().method() === "PUT");
        await pct.press("Tab");
        expect((await put).ok()).toBe(true);
        await expect(page.locator(".adm-confirm"), "q40: the prices ask no question").toHaveCount(0);

        await settings(page, "journal");
        const line = page.locator(".adm-narrow .adm-jrow").first().locator(".adm-jrow__l").first();
        await expect(line).toBeVisible();
        const text = (await line.innerText()).trim();
        if (lang === "RU") {
          expect(text).toContain("Цены и лояльность · ");
          expect(text).toContain("скидка для салонов 25%");
        } else {
          expect(text, `the line stayed Russian on a ${lang} panel: ${text}`).not.toMatch(CYRILLIC);
        }
        // …and it really is the pricing line, not some other one
        expect(text.toLowerCase()).toMatch(/25\s*%/);

        /* One element per fact is what makes that possible — assert the shape,
           not only the words, so a future glue-up fails here and not in the
           owner's panel. */
        expect(await line.locator("span").count(), "the line is painted in pieces (admPiecesHTML)").toBeGreaterThan(1);
      } finally {
        await page.request.put("/api/admin/settings/", { data: { pricing: was } });
      }
    });
  }
});

test.describe("the popular-search chips search in the language they are read in", () => {
  test.use({ extraHTTPHeaders: ipHeaders(179) });

  for (const lang of LANGS) {
    test(`${lang.code}: the chip's label and its query are the same word`, async ({ page }) => {
      await page.goto(shopUrl(lang.seg, "/search/"));
      await waitForScreen(page, "search");

      const chips = page.locator("[data-searchres] [data-q]");
      await expect(chips.first()).toBeVisible();
      const n = await chips.count();
      expect(n).toBeGreaterThan(2);
      for (let i = 0; i < n; i++) {
        const chip = chips.nth(i);
        const label = (await chip.innerText()).trim();
        const query = (await chip.getAttribute("data-q")) ?? "";
        expect(query, `chip «${label}» fires a different word than it shows`).toBe(label);
        if (lang.code !== "RU") {
          expect(label, `chip «${label}» is still Russian on the ${lang.code} shop`).not.toMatch(CYRILLIC);
        }
      }

      /* …and the promise the chip makes is kept: tapping it searches that
         word and finds something. «шампунь» / «šampoon» / «shampoo» all reach
         the same shelf — the search reads all three languages (searchWide). */
      const first = chips.first();
      const word = (await first.innerText()).trim();
      await first.click();
      await expect(page.locator("[data-search2]")).toHaveValue(word);
      await expect(page.locator("[data-searchres] .card").first()).toBeVisible();
    });
  }
});

test.describe("a product with no photograph of its own shows the shop's mark, never an empty tile", () => {
  test.use({ extraHTTPHeaders: ipHeaders(180) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one product per run is enough — desktop makes it");
  });

  test("«С этим покупают» on the owner's own product has a picture on every card", async ({ page }) => {
    test.setTimeout(120_000);
    await openAdmin(page);
    const stamp = Date.now().toString().slice(-6);
    const made = await page.request.post("/api/admin/products/", {
      data: { brand: `Rempire ${stamp}`, name: "Hoodie — худи", cat: "merch", price: 49 },
    });
    expect(made.status(), "could not create the owner's product").toBe(201);
    const id = (await made.json()).product.id as string;

    await page.goto(shopUrl("", `/p/${id}/`));
    await waitForScreen(page, "product");

    const cross = page.locator("section.sec", { hasText: /С этим покупают|Sellega ostetakse|Bought together/ });
    await expect(cross.first()).toBeVisible();
    const cards = cross.first().locator(".card");
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const media = cards.nth(i).locator(".card__media > .ph").first();
      await expect(media).toBeVisible();
      const style = (await media.getAttribute("style")) ?? "";
      const cls = (await media.getAttribute("class")) ?? "";
      const name = await cards.nth(i).locator(".card__name").innerText();
      // either a real photo, or the shop's own mark — never url('undefined')
      expect(style, `«${name}» paints a broken background`).not.toContain("undefined");
      expect(
        /background-image:url\('.+'\)/.test(style) || cls.includes("ph--mark"),
        `«${name}» has a name and a price and no picture at all`,
      ).toBe(true);
    }

    // put the shelf back the way the run found it
    await page.request.delete(`/api/admin/products/${encodeURIComponent(id)}/`).catch(() => {});
  });
});
