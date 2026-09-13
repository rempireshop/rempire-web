/**
 * The panel: three things about WHEN it asks the server, none of them a
 * stopwatch. The milliseconds live in e2e/perf-open.spec.ts, which is not part
 * of any suite; these are the behaviours that changed, written so they fail
 * for a reason and not for the runner's mood.
 *
 * Renat, 13.09.2026:
 *   1. «the things in overview which are loaded slowly» — the panel's cold
 *      open used to ask «is this the owner», wait for the answer, and only
 *      then ask for the two things «Обзор» draws. One round trip, spent on a
 *      question the cookie had already answered.
 *   2. «Admin needs a hard refresh to see the results, I did ctrl + R, then it
 *      showed, otherwise not — probably cached» — about «Искали, но не нашли».
 *      Every read-only report in the panel was fetched once per page and never
 *      again.
 *   3. «publishing a review takes time» — the tap threw the whole list away
 *      and the screen sat on its grey skeleton until the server answered.
 */
import { expect, test } from "@playwright/test";
import { adminSection, ipHeaders, loginAsAdmin, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

test.describe("admin — when it asks", () => {
  test.use({ extraHTTPHeaders: ipHeaders(162) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "request timing and list state are viewport-independent");
  });

  test("the cold open asks its three questions at once, not one behind the other", async ({ page }) => {
    // signed in first, so the reload below is the owner's own cold open
    await loginAsAdmin(page);

    /* Every /api/admin/ call of the boot, with the moment it LEFT and the
       moment it came back. The claim is about order, not about duration. */
    const out: Record<string, number> = {};
    const back: Record<string, number> = {};
    const key = (u: string) => new URL(u).pathname;
    const t0 = Date.now();
    page.on("request", (r) => {
      const p = key(r.url());
      if (p.startsWith("/api/admin/") && !(p in out)) out[p] = Date.now() - t0;
    });
    page.on("response", (r) => {
      const p = key(r.url());
      if (p.startsWith("/api/admin/") && !(p in back)) back[p] = Date.now() - t0;
    });

    await page.goto(shopUrl("", "/admin/"));
    await expect(page.locator('[data-admtab="orders"][aria-current]:visible').first()).toBeVisible();
    await expect
      .poll(() => Object.keys(back).length, { timeout: 20_000, message: "the boot never made its three calls" })
      .toBeGreaterThanOrEqual(3);

    for (const p of ["/api/admin/me/", "/api/admin/orders/", "/api/admin/overview/"]) {
      expect(out[p], `${p} was not part of the cold open`).toBeGreaterThanOrEqual(0);
    }
    /* The whole of it: neither read waited for «is this the owner» to answer.
       A 50 ms allowance, because two fetches from one turn of the event loop
       do not leave at the same millisecond and the answer can be that quick on
       an in-memory database. */
    expect(out["/api/admin/orders/"], "«Последние заказы» still waits for /api/admin/me")
      .toBeLessThan(back["/api/admin/me/"] + 50);
    expect(out["/api/admin/overview/"], "the summary still waits for /api/admin/me")
      .toBeLessThan(back["/api/admin/me/"] + 50);
  });

  test("«Аналитика» asks again when the report on screen has gone stale — and keeps the old numbers while it does", async ({ page }) => {
    /* A clock the test can move: the freshness floor is half a minute of real
       time, and a spec that waited it out would be half a minute of nothing.
       Installed before the first navigation, as page.clock requires. */
    await page.clock.install();
    await loginAsAdmin(page);
    await adminSection(page, "stats");

    const ranges: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname === "/api/admin/analytics/") ranges.push(u.search);
    });
    await expect(page.locator(".adm-kpis")).toBeVisible();
    const kpis = page.locator(".adm-kpi__v").first();
    await expect(kpis).toBeVisible();
    const shown = await kpis.textContent();

    // …a while later, on the same screen: pressing the section again is a
    // render that changes nothing, and the stale answer is what re-asks
    await page.clock.fastForward("00:31");
    await adminSection(page, "stats");
    await expect
      .poll(() => ranges.length, { timeout: 15_000, message: "«Аналитика» never re-asked for a stale report" })
      .toBeGreaterThan(0);
    expect(ranges[0], "it re-asked for a range nobody is looking at").toBe("?range=7d");

    /* …and the screen never went back to its skeleton on the way: the numbers
       that were on it are the numbers that are on it. */
    await expect(page.locator(".adm-skel")).toHaveCount(0);
    await expect(kpis).toHaveText(String(shown));
  });

  test("«Опубликовать» moves the row at once — the queue does not go blank", async ({ page }) => {
    const name = `E2E fresh ${Date.now().toString().slice(-6)}`;
    await loginAsAdmin(page);
    const filed = await page.request.post("/api/reviews/", {
      data: {
        product: PRODUCT.id, rating: 5, name,
        text: "Проверка очереди отзывов, двадцать знаков и больше.", lang: "RU", consent: true,
      },
    });
    expect(filed.ok(), "the review could not be filed").toBe(true);

    let id = "";
    try {
      await page.reload();
      await waitForScreen(page, "admin");
      await adminSection(page, "people", "reviews");
      const row = page.locator(".adm-row", { hasText: name }).first();
      await expect(row, "the new review is not in the queue").toBeVisible();

      /* The list is watched from the moment of the tap: the row itself goes
         («Новые» is one of three queues and it has just left this one), and
         what must NOT happen is the whole list being replaced by the grey
         bars while the server is asked what the panel already knows. */
      const skeletons: number[] = [];
      const stop = setInterval(async () => {
        try { skeletons.push(await page.locator(".adm-skel").count()); } catch { /* navigated away */ }
      }, 30);
      await row.locator("[data-admrev]").first().click();
      await expect(page.getByRole("status")).toContainText("Отзыв опубликован");
      await expect(row, "the published review stayed in «Новые»").toHaveCount(0);
      await page.waitForTimeout(400);
      clearInterval(stop);
      expect(Math.max(0, ...skeletons), "the queue fell back to its skeleton after «Опубликовать»").toBe(0);

      // …and the server really was told, underneath
      await expect.poll(async () => {
        const res = await page.request.get("/api/admin/reviews/?status=approved");
        const hit = ((await res.json()).reviews as Array<{ id: string; name: string }>).find((r) => r.name === name);
        if (hit) id = hit.id;
        return !!hit;
      }, { timeout: 10_000, message: "«Опубликовать» never reached the server" }).toBe(true);
    } finally {
      /* A published review on PRODUCT changes what the storefront shows, and
         e2e/product.spec.ts expects that block empty — put it back either way. */
      if (id) await page.request.patch("/api/admin/reviews/", { data: { id, status: "rejected" } });
    }
  });
});
