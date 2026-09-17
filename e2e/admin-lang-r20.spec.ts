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

test.describe("the panel's confirm cards answer in the panel's own language", () => {
  test.use({ extraHTTPHeaders: ipHeaders(178) });

  for (const lang of ["RU", "ET", "EN"] as const) {
    test(`«Цены и баллы» — the card is ${lang} from its heading to its last fact`, async ({ page }) => {
      test.setTimeout(120_000);
      await openAdmin(page);
      await adminLang(page, lang);
      await settings(page, "prices");

      /* Move one number. Every field of this card goes into the same composed
         line, so one is enough to make the panel write all of them out. */
      const pct = page.locator('[data-pricingf="proDiscountPct"]');
      await expect(pct).toBeVisible();
      await pct.fill("25");
      await page.locator("[data-admpricingsave]:visible").first().click();

      const card = page.locator(".adm-confirm");
      await expect(card).toBeVisible();
      const title = (await card.locator(".adm-confirm__t").innerText()).trim();
      const detail = (await card.locator(".adm-confirm__d").innerText()).trim();
      if (lang === "RU") {
        // the source language: the card says the same thing it always did,
        // with the label as the first fact of its own list rather than a
        // «Цены и лояльность: …» head no rule could see past
        expect(title).toBe("Изменить цены и баллы?");
        expect(detail).toContain("Цены и лояльность · ");
        expect(detail).toContain("скидка для салонов 25%");
      } else {
        expect(title, "the heading was already translated before this fix").not.toMatch(CYRILLIC);
        expect(detail, `the card's own body stayed Russian under a ${lang} heading`).not.toMatch(CYRILLIC);
      }
      // …and it really is the composed line, not some other card
      expect(detail.toLowerCase()).toMatch(/25\s*%/);

      /* One element per fact is what makes that possible — assert the shape,
         not only the words, so a future glue-up fails here and not in the
         owner's panel. */
      const pieces = await card.locator(".adm-confirm__d span").count();
      expect(pieces, "the detail is painted in pieces (admDetailHTML)").toBeGreaterThan(3);

      await page.locator("[data-admcancel]").first().click();
      await expect(card).toHaveCount(0);
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
