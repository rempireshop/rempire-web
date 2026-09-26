/**
 * /test «stats-search» (Dim, 26.09.2026: «Fridge is not in the list in
 * analytics»): a visitor who has just said «Принять всё» searches for
 * something the shop does not sell, and the owner finds that phrase in
 * «Аналитика → Ещё цифры → Что искали и не нашли».
 *
 * End to end on purpose — the beacon, the events table, the report query
 * and the fold are four owners, and the complaint was about the chain.
 */
import { expect, type Page, test } from "@playwright/test";
import { adminSection, functionalProject, ipHeaders, loginAsAdmin, searchFor, shopUrl, waitForScreen } from "./fixtures";

type Beacon = { type?: string; path?: string; value?: number };

test.describe("«Что искали и не нашли»", () => {
  // a visitor who has never answered the banner — the suite's storageState says otherwise
  test.use({
    extraHTTPHeaders: ipHeaders(231),
    storageState: { cookies: [], origins: [] },
    /* A person's Chrome. Playwright's own says «HeadlessChrome», and
       /api/track files a crawler's beacon under nothing (isBotUA,
       src/lib/events.ts) — rightly, and it would hide the very row under test. */
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(!functionalProject(testInfo) || testInfo.project.name !== "desktop", "one engine is enough for a report");
  });

  test("a search made right after «Принять всё» is in the owner's list", async ({ page }) => {
    const term = `fridge${Date.now() % 100000}`;
    const beacons = await acceptStatistics(page);
    await searchFor(page, term);
    await expect
      .poll(() => beacons.find((b) => b.type === "search"), { message: JSON.stringify(beacons) })
      .toMatchObject({ path: term, value: 0 });
    await expectInZeroList(page, term);
  });

  /* What Dim did: type the word, and go straight to the panel in the other
     tab. The search row waits for the pause in typing (700 ms) and then for
     the model's answer — seconds on a cold server — and a tab that went out of
     sight in that window is one whose timers a phone freezes and whose page
     may be closed: the list never heard of the search. So the row leaves the
     moment the tab is hidden (and on pagehide — src: flushSearchTrack). */
  test("a search the visitor leaves at once is filed as the tab goes out of sight", async ({ page }) => {
    const term = `fridge${(Date.now() + 7) % 100000}`;
    const beacons = await acceptStatistics(page);
    await searchFor(page, term);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // now, not after the pause and the model: well inside the 700 ms
    await expect
      .poll(() => beacons.filter((b) => b.type === "search"), { timeout: 400, intervals: [25] })
      .toEqual([expect.objectContaining({ path: term, value: 0 })]);
    // …and once: the pause that would have filed it again is over, nothing more
    await page.waitForTimeout(1500);
    expect(beacons.filter((b) => b.type === "search")).toHaveLength(1);
    await expectInZeroList(page, term);
  });
});

/** Home, «Принять всё», and every beacon from then on — watched, not answered:
    each goes on to the real route, so what the panel shows is what the
    database was really given. */
async function acceptStatistics(page: Page): Promise<Beacon[]> {
  const beacons: Beacon[] = [];
  await page.route("**/api/track/", async (route) => {
    try {
      beacons.push(JSON.parse(route.request().postData() || "{}"));
    } catch {
      beacons.push({ type: "unparsed" });
    }
    await route.continue();
  });
  await page.goto(shopUrl("", "/"));
  await waitForScreen(page, "home");
  await page.locator('[data-consent="all"]').click();
  await expect(page.locator(".cbanner__box")).toHaveCount(0);
  return beacons;
}

/** Signs in (a page load of its own — whatever was pending in the shop goes
    with it) and opens «Аналитика → Ещё цифры → Что искали и не нашли». */
async function expectInZeroList(page: Page, term: string): Promise<void> {
  await loginAsAdmin(page);
  await adminSection(page, "stats");
  const fold = page.locator('[data-admfold="stats-zero"]');
  await expect(fold).toBeVisible();
  await fold.click();
  await expect(page.locator(".adm-stats__more")).toContainText(term);
}
