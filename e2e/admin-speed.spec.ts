import { expect, test } from "@playwright/test";
import { ipHeaders, loginAsAdmin, shopUrl } from "./fixtures";

/**
 * What the speed work changed that can be SEEN — the two behaviours, not the
 * milliseconds. The stopwatch lives in e2e/perf-admin.spec.ts, which is not
 * part of any suite: a number that fails a build tells you about the runner's
 * mood. These two assertions do not move with the weather.
 *
 * Dim, 07.09.2026: «загрузка каждой страницы и панели должна быть быстрее.»
 *   1. «Заказы» pages at 40, the way «Товары» (40) and «Склад» (60) already
 *      did. It was the one list that drew every row it had, on every render,
 *      including the one behind each keystroke of the search box.
 *   2. The panel's cold open no longer runs the 30-day analytics query. It was
 *      fired from probeAdmin() to pre-fill the assistant's context — the
 *      heaviest query in the admin, in the one moment the owner is waiting,
 *      for a question most mornings never get asked. The assistant asks for it
 *      itself now, when it is on screen.
 */

/** 100 orders, the shape GET /api/admin/orders/ returns (srvRow in app.js). */
function fakeOrders(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: "speed-o-" + i,
    number: "R-9" + String(i).padStart(5, "0"),
    createdAt: new Date(Date.UTC(2026, 7, 1 + (i % 28), 9, 0, 0)).toISOString(),
    name: "Покупатель " + i,
    email: "buyer" + i + "@example.com",
    total: 10 + (i % 90),
    status: "paid",
    channel: "web",
    items: [{ qty: 1, name: "System 4 Bio Botanical Shampoo", size: "250 мл" }],
    shipping: { method: "courier" },
    payment: { provider: "montonio", status: "paid", ref: "p-" + i },
  }));
}

test.describe("admin — speed", () => {
  test.use({ extraHTTPHeaders: ipHeaders(156) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "list paging and boot requests are viewport-independent");
  });

  test("«Заказы» draws 40 rows of 100 and pages the rest", async ({ page }) => {
    // a predicate, not a glob: a glob's `?` is a wildcard and would never
    // match "orders/?limit=100"
    await page.route((u) => u.pathname === "/api/admin/orders/", (route) =>
      route.fulfill({ json: { ok: true, orders: fakeOrders(100) } }));

    await loginAsAdmin(page);
    await page.locator('[data-admtab="orders"][aria-current]:visible').first().click();
    await page.locator('[data-admfilter="all"]').click();

    const rows = page.locator("#orderlist [data-admorder]");
    await expect.poll(() => rows.count(), { message: "«Все» is not paged" }).toBe(40);
    await expect(page.locator("#orderlist")).toContainText("Показаны первые 40 из 100");

    await page.locator("[data-admordersmore]").click();
    await expect.poll(() => rows.count(), { message: "«Показать ещё» added no page" }).toBe(80);
    await page.locator("[data-admordersmore]").click();
    await expect.poll(() => rows.count()).toBe(100);
    await expect(page.locator("[data-admordersmore]"), "the button stayed after the last page").toHaveCount(0);

    // a chip and a search each start from the first page again — otherwise a
    // narrowed list would still be carrying the pages a wider one turned
    await page.locator('[data-admfilter="new"]').click();
    await page.locator('[data-admfilter="all"]').click();
    await expect.poll(() => rows.count(), { message: "the chip kept the old page count" }).toBe(40);
  });

  test("the cold open does not run the 30-day analytics query; the assistant does", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname === "/api/admin/analytics/") calls.push(u.search);
    });

    await loginAsAdmin(page);
    await page.waitForTimeout(1500);
    expect(calls, "the boot still asks for the 30-day summary").not.toContain("?range=30d");
    expect(calls, "«Обзор» stopped asking for its own week").toContain("?range=7d");

    // …and it is asked for the moment the assistant is on screen
    const opened = page.waitForResponse((r) => r.url().includes("/api/admin/analytics/?range=30d"));
    await page.locator("[data-admai]").first().click();
    await expect(page.locator(".adm-asst")).toBeVisible();
    expect((await opened).status(), "the assistant did not warm its own context").toBe(200);

    // leave the pane as the suite found it — it is remembered in localStorage
    await page.locator(".adm-asst__fold").click();
    await expect(page.locator(".adm-asst")).toHaveCount(0);
    expect(shopUrl("", "/admin/")).toContain("/admin/");
  });
});
