import { expect, test, type Page } from "@playwright/test";
import { functionalProject, ipHeaders, searchFor, shopUrl, waitForScreen } from "./fixtures";

/** Sets in the search — the four rules Renat approved on 07.11.2026 (app.js
 *  searchSetPlan(); the plan was drawn on Dim's page in 99a4bef1):
 *    1. only the set word — every set, a chip per section;
 *    2. the set word and a topic — only the sets for it, a typed name first;
 *       none — one line and the topic's products;
 *    3. words from a set's name — the products first, then those sets;
 *    4. anything else — the products as before, one line when they also
 *       come in sets, and that line leads to rule 2 for the same words.
 *  Plus «Входит в наборы» on a product page.
 *
 *  The e2e shop's sets are public/shop/bundles.js — eight of them, among
 *  them «Борода — стартовый набор» (beard-start, a Proraso beard oil inside),
 *  «Captain Fawcett Barberism — борода и усы» (barberism) and «Подарочный
 *  набор Rempire» (gift-rempire, «Rempire kinkekomplekt» in Estonian). */
test.beforeEach(async ({}, testInfo) => {
  test.skip(!functionalProject(testInfo), "functional spec — desktop and mobile-safari projects only, see docs/testing.md");
});
test.use({ extraHTTPHeaders: ipHeaders(141) });

const results = (page: Page) => page.locator("[data-searchres]");
const setCards = (page: Page) => results(page).locator(".card--bundle");
const productCards = (page: Page) => results(page).locator(".card:not(.card--bundle)");
const setIds = (page: Page) =>
  setCards(page).locator("a.card__go").evaluateAll((els) => els.map((a) => (a as HTMLElement).dataset.goBundle || ""));

async function open(page: Page, seg = "") {
  await page.goto(shopUrl(seg, "/"));
  await waitForScreen(page, "home");
}

test("rule 1: «наборы» is the shelf itself, a chip narrows it in place", async ({ page }) => {
  await open(page);
  await searchFor(page, "наборы");
  await expect(setCards(page)).toHaveCount(8);
  await expect(productCards(page)).toHaveCount(0);
  await expect(results(page).locator(".srchmeta")).toContainText("8 наборов");
  await expect(results(page).locator('.srchmeta a[data-go="bundles"]')).toBeVisible();

  await results(page).locator('[data-srchsets="beard"]').click();
  await expect(results(page).locator('[data-srchsets="beard"]')).toHaveAttribute("aria-current", "true");
  await expect(setCards(page)).toHaveCount(3);
  const ids = await setIds(page);
  expect(ids).toContain("beard-start");
  expect(ids).toContain("barberism");
  expect(ids).not.toContain("tattoo-care");
  // the box keeps the query — a chip only narrows
  await expect(page.locator("[data-search2]")).toHaveValue("наборы");
});

test("rule 2: «набор для бороды» lists only the sets for beards, never «ничего не нашлось»", async ({ page }) => {
  await open(page);
  await searchFor(page, "набор для бороды");
  await expect(setCards(page).first()).toBeVisible();
  await expect(productCards(page)).toHaveCount(0);
  const ids = await setIds(page);
  // named first («Борода — …», «… — борода и усы»), then the ones holding a beard product
  expect(ids.slice(0, 2).sort()).toEqual(["barberism", "beard-start"]);
  expect(ids).toContain("gift-rempire");   // a Proraso beard oil inside
  expect(ids).not.toContain("tattoo-care");
  await expect(results(page).locator(".srchfoot a[data-go-cat]")).toHaveText("Уход за бородой");
  await expect(results(page)).not.toContainText("ничего не нашлось");
});

test("rule 2, none: «набор парфюма» says so and shows the perfume itself", async ({ page }) => {
  await open(page);
  await searchFor(page, "набор парфюма");
  await expect(results(page).locator(".srchnone")).toContainText("Подходящих наборов пока нет.");
  await expect(setCards(page)).toHaveCount(0);
  await expect(productCards(page).first()).toBeVisible();
});

test("rule 3: «barberism» — the products first, then the Barberism set under them", async ({ page }) => {
  await open(page);
  await searchFor(page, "barberism");
  await expect(productCards(page).first()).toBeVisible();
  const block = results(page).locator(".sec--bundles");
  await expect(block.locator('a[data-go-bundle="barberism"]')).toBeVisible();
  // the set block comes after the product grid, never inside it
  const order = await results(page).evaluate((el) => {
    const grid = el.querySelector(":scope > .grid");
    const sets = el.querySelector(".sec--bundles");
    return !!grid && !!sets && !!(grid.compareDocumentPosition(sets) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  await expect(results(page).locator(":scope > .grid .card--bundle")).toHaveCount(0);
});

test("rule 4: «beard oil» stays oils; the line under them opens the sets that hold them", async ({ page }) => {
  await open(page);
  await searchFor(page, "beard oil");
  await expect(productCards(page).first()).toBeVisible();
  await expect(setCards(page)).toHaveCount(0);
  const hint = results(page).locator(".srchhint button");
  await expect(hint).toHaveText(/^Эти товары есть и в \d+ набор(е|ах), от .+€$/);
  const n = Number((await hint.textContent())!.match(/в (\d+) набор/)![1]);
  await hint.click();
  await expect(page.locator("[data-search2]")).toHaveValue("наборы beard oil");
  await expect(setCards(page)).toHaveCount(n);
  await expect(productCards(page)).toHaveCount(0);
});

test("ET: «kinkekomplekt» — the gift set, in Estonian", async ({ page }) => {
  await open(page, "/et");
  await searchFor(page, "kinkekomplekt");
  await expect(setCards(page).first()).toBeVisible();
  expect((await setIds(page))[0]).toBe("gift-rempire");
  await expect(results(page).locator(".srchmeta")).toContainText("Kõik komplektid");
  await expect(results(page)).not.toContainText(/[А-Яа-яЁё]/);
});

test("EN: «beard starter kit» — the set whose name was typed comes first", async ({ page }) => {
  await open(page, "/en");
  await searchFor(page, "beard starter kit");
  await expect(setCards(page).first()).toBeVisible();
  expect((await setIds(page))[0]).toBe("beard-start");
  await expect(results(page)).not.toContainText(/[А-Яа-яЁё]/);
});

for (const [seg, heading] of [["", "Входит в наборы"], ["/en", "Also in sets"]] as const) {
  test(`product page${seg ? " " + seg : ""}: «${heading}» lists the sets holding the product`, async ({ page }) => {
    await page.goto(shopUrl(seg, "/p/captain-fawcett-barberism-beard-oil/"));
    await waitForScreen(page, "product");
    const box = page.locator(".pdpsets");
    await expect(box.locator(".pdpsets__h")).toHaveText(heading);
    await expect(box.locator('a[data-go-bundle="barberism"]')).toBeVisible();
    await box.locator('a[data-go-bundle="barberism"]').click();
    await waitForScreen(page, "bundle");
  });
}
