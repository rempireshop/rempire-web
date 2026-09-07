/**
 * Admin panel speed — the measuring stick, not a test.
 *
 * Dim, 07.09.2026: «The loading of each page and dashboard should be quicker.»
 * Before touching anything we need numbers, and afterwards the same numbers
 * taken the same way. This file is that instrument; it asserts almost nothing
 * (one guard that the panel is actually up) and prints a table instead.
 *
 * NOT named `admin-*.spec.ts` on purpose: it must not join the admin suite in
 * CI — it is slow, it is a stopwatch, and a stopwatch that fails a build tells
 * you about the runner's mood, not about the panel.
 *
 *   node tools/e2e-build.mjs
 *   E2E_PORT=3817 npx playwright test e2e/perf-admin.spec.ts --project=desktop
 *
 * What each number means
 *   sync  — milliseconds the click handler blocks the main thread: the whole
 *           of renderImpl() (build the screen as a string, parse it into a
 *           template, translate it, morph it into the DOM). What the owner
 *           feels as "the panel thinks before it moves".
 *   ready — from the click until the screen has no skeleton left on it and two
 *           animation frames pass with no DOM mutation: the whole wait,
 *           fetches included. What the owner calls "loading".
 *   reqs  — how many API calls that one visit to the screen makes. A screen
 *           that asks the server again on every visit is the usual reason
 *           `ready` is far bigger than `sync`.
 *   nodes — elements in the body slot afterwards, so a change in `sync` can be
 *           read against a change in how much is on screen.
 *
 * Each scenario is run WARMUP + RUNS times and the median of RUNS is printed.
 * The server is `next dev`, so the FIRST touch of any route pays for its
 * compilation — hence the warm-up pass before anything is recorded.
 */
import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN_PASSWORD } from "./env.mjs";
import { ipHeaders, shopUrl } from "./fixtures";

const WARMUP = 2;
const RUNS = 7;

type Row = { name: string; sync: number | string; ready: number | string; reqs: number | string; nodes: number | string };
const table: Row[] = [];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Counts every fetch the page makes and every long task the main thread runs,
 *  so a screen's own appetite and its blocking time are both visible. */
async function installCounters(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __reqs: number; __blocked: number };
    w.__reqs = 0;
    w.__blocked = 0;
    const real = window.fetch;
    window.fetch = function (...args: Parameters<typeof fetch>) {
      w.__reqs++;
      return real.apply(this, args);
    };
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) w.__blocked += e.duration;
      }).observe({ entryTypes: ["longtask"] });
    } catch { /* no longtask support — the number stays 0 */ }
  });
}

/**
 * Clicks `sel` from inside the page and measures the click handler itself,
 * then waits for the screen to stop moving.
 *
 * The click is dispatched by the page, not by Playwright, so nothing between
 * the two processes lands in the number: `performance.now()` on either side of
 * `el.click()` is exactly the synchronous work app.js does for that action —
 * the delegated handler plus render() (whose first call in a burst runs
 * renderImpl synchronously, see app.js).
 */
async function timeClick(page: Page, sel: string) {
  return page.evaluate(async (selector) => {
    /* A probe that lands between two of our clicks can still be re-drawing the
       panel, so the button is waited for rather than demanded. */
    const wait = performance.now();
    let el = document.querySelector(selector) as HTMLElement | null;
    while (!el && performance.now() - wait < 5000) {
      await new Promise((r) => requestAnimationFrame(r));
      el = document.querySelector(selector) as HTMLElement | null;
    }
    if (!el) throw new Error("perf: no element for " + selector);
    const slot = (document.querySelector("#bodyslot") || document.body) as HTMLElement;
    const w = window as unknown as { __reqs: number };
    const reqs0 = w.__reqs;
    const t0 = performance.now();
    el.click();
    const sync = performance.now() - t0;
    await new Promise<void>((done) => {
      let dirty = true;
      const mo = new MutationObserver(() => { dirty = true; });
      mo.observe(slot, { childList: true, subtree: true, attributes: true, characterData: true });
      let quiet = 0;
      const tick = () => {
        const loading = !!slot.querySelector(".adm-skel");
        if (dirty || loading) { dirty = false; quiet = 0; } else quiet++;
        if (quiet >= 2 || performance.now() - t0 > 8000) { mo.disconnect(); done(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return { sync, ready: performance.now() - t0, reqs: w.__reqs - reqs0, nodes: slot.querySelectorAll("*").length };
  }, sel);
}

/**
 * A fixed unit of the very work a render does — build a screen-sized string,
 * parse it into a template, walk it — so a run knows how fast the machine it
 * is on happens to be right now.
 *
 * This is not a nicety. Five other agents run their own e2e suites on this
 * laptop, and a run that lands while three Chromiums are compiling reads
 * every number four times bigger than the same code did an hour earlier.
 * Without this the before/after table is a measurement of the neighbours.
 * The report quotes `sync ÷ calib`, and the raw milliseconds beside it.
 */
async function calibrate(page: Page): Promise<number> {
  const runs: number[] = [];
  for (let i = 0; i < 5; i++) {
    runs.push(await page.evaluate(() => {
      const html = new Array(400).fill(
        '<div class="adm-row"><span class="adm-row__nm">Мария Кузнецова</span>' +
        '<span class="adm-row__sub">R-100042 · 01.08.2026</span><b>12,90 €</b></div>').join("");
      const t = performance.now();
      let seen = 0;
      for (let k = 0; k < 20; k++) {
        const tpl = document.createElement("template");
        tpl.innerHTML = html;
        seen += tpl.content.querySelectorAll("*").length;
      }
      return performance.now() - t + (seen ? 0 : 0);
    }));
  }
  return median(runs);
}

/** Runs one scenario RUNS times (after WARMUP throwaways) and records the median. */
async function scenario(page: Page, name: string, there: string, back: string): Promise<void> {
  const syncs: number[] = [], readies: number[] = [], reqs: number[] = [];
  let nodes = 0;
  for (let i = 0; i < WARMUP + RUNS; i++) {
    const m = await timeClick(page, there);
    if (i >= WARMUP) { syncs.push(m.sync); readies.push(m.ready); reqs.push(m.reqs); nodes = m.nodes; }
    await timeClick(page, back);
  }
  table.push({ name, sync: r1(median(syncs)), ready: r1(median(readies)), reqs: median(reqs), nodes });
}

/** 100 orders, the shape GET /api/admin/orders/ returns (srvRow in app.js). */
function fakeOrders(n: number) {
  const names = ["Мария Кузнецова", "Renat Gabdullin", "Jaan Tamm", "Olga Petrova", "Karl Saar"];
  return Array.from({ length: n }, (_, i) => ({
    id: "o-" + i,
    number: "R-1000" + i,
    createdAt: new Date(Date.UTC(2026, 7, 1 + (i % 28), 9, 0, 0)).toISOString(),
    name: names[i % names.length],
    email: "buyer" + i + "@example.com",
    phone: "+372 55500" + (i % 100),
    total: 10 + (i % 90),
    status: ["paid", "shipped", "delivered", "new"][i % 4],
    channel: "web",
    items: [{ qty: 1 + (i % 3), name: "System 4 Bio Botanical Shampoo", size: "250 мл" }],
    shipping: { method: i % 2 ? "courier" : "parcel", pointName: "Omniva Ülemiste" },
    payment: { provider: "montonio", status: "paid", ref: "p-" + i },
  }));
}

/** 322 shelf rows, the shape GET /api/admin/inventory/ returns. */
function fakeInventory(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    productId: "perf-product-" + i,
    variant: ["75 мл", "250 мл", "500 мл"][i % 3],
    qty: i % 17,
    tracked: i % 5 !== 0,
    state: i % 17 === 0 ? "out" : i % 17 < 4 ? "low" : "in",
    lowAt: 3,
    ean: i % 3 ? "590000000" + String(i).padStart(4, "0") : "",
    name: "Товар склада " + i,
    brand: "System 4",
  }));
}

test.describe("admin — speed", () => {
  test.use({ extraHTTPHeaders: ipHeaders(151) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one viewport, one stopwatch");
  });
  test.setTimeout(300_000);

  test("how long each screen takes", async ({ page, context }) => {
    /* 4× slower CPU. The laptop this runs on is not the machine the panel is
       used from — Renat works from a phone — and an unthrottled desktop reads
       every screen as "instant", which hides exactly the differences this file
       exists to find. 4× is Chrome DevTools' own mid-tier-phone setting. */
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await installCounters(page);
    // predicates, not globs: a glob's `?` is a wildcard, so "orders/?limit=100"
    // would never match the URL it looks like it names
    await page.route((u) => u.pathname === "/api/admin/orders/", (route) =>
      route.fulfill({ json: { ok: true, orders: fakeOrders(100) } }));
    await page.route((u) => u.pathname === "/api/admin/inventory/", (route) =>
      route.fulfill({ json: { ok: true, levels: fakeInventory(322) } }));

    await page.goto(shopUrl("", "/admin/"));
    const pw = page.locator("[data-admpw]");
    await expect(pw).toBeVisible();
    await expect.poll(async () => { await pw.fill(E2E_ADMIN_PASSWORD); return pw.inputValue(); },
      { timeout: 10_000 }).toBe(E2E_ADMIN_PASSWORD);
    await page.locator("[data-admlogin]").click();
    await expect(page.locator('[data-admtab="orders"][aria-current]:visible').first()).toBeVisible();
    const calibStart = await calibrate(page);

    /* Walk every section once before recording: `next dev` compiles a route on
       its first request, and 300 ms of webpack is not a fact about the panel. */
    const sections = ["over", "orders", "goods", "pos", "people", "promos", "blog", "stats", "apps", "setup"];
    for (const s of sections) {
      await page.locator(`.adm-nav[data-admtab="${s}"]`).click();
      await page.waitForTimeout(400);
    }

    /* The owner's own cold open: the session is already there (he does not sign
       in every morning), the panel is loaded from scratch, and the number is
       the wait until «Обзор» has its figures on it and stops moving. */
    const colds: number[] = [];
    const coldReqs: number[] = [];
    const coldBlocked: number[] = [];
    let lastCalls: string[] = [];
    for (let i = 0; i < 1 + 3; i++) {
      const calls: string[] = [];
      const spy = (r: { url: () => string }) => {
        const u = new URL(r.url());
        if (u.pathname.startsWith("/api/")) calls.push(u.pathname + u.search);
      };
      page.on("request", spy);
      const t0 = Date.now();
      await page.goto(shopUrl("", "/admin/"));
      await page.waitForFunction(() => {
        const slot = document.querySelector("#bodyslot");
        return !!slot && !!slot.querySelector(".adm-nav") && !slot.querySelector(".adm-skel");
      }, null, { timeout: 20_000 });
      const took = Date.now() - t0;
      // give the boot's own trailing probes a moment, then stop listening
      await page.waitForTimeout(1500);
      page.off("request", spy);
      const blocked = await page.evaluate(() => (window as unknown as { __blocked: number }).__blocked);
      if (i) { colds.push(took); coldReqs.push(calls.length); coldBlocked.push(blocked); lastCalls = calls; }
    }
    table.push({ name: "cold open of /shop2/admin/ (signed in)", sync: r1(median(coldBlocked)),
      ready: median(colds), reqs: median(coldReqs), nodes: "—" });
    console.log("\nAPI calls the cold open makes (" + lastCalls.length + "):\n  " + lastCalls.join("\n  "));

    // sections, each measured on the way in with «Обзор» as the way back.
    // `.adm-nav` is the desktop sidebar's own item — «Товары» and «Склад»
    // also exist as `.adm-tab` inside the goods screen.
    const back = '.adm-nav[data-admtab="over"]';
    await scenario(page, "→ Заказы (25 of 100 on «Новые»)", '.adm-nav[data-admtab="orders"]', back);
    await scenario(page, "→ Товары (220 products)", '.adm-nav[data-admtab="goods"]', back);
    await scenario(page, "→ Салон", '.adm-nav[data-admtab="pos"]', back);
    await scenario(page, "→ Клиенты", '.adm-nav[data-admtab="people"]', back);
    await scenario(page, "→ Маркетинг", '.adm-nav[data-admtab="promos"]', back);
    await scenario(page, "→ Аналитика", '.adm-nav[data-admtab="stats"]', back);
    await scenario(page, "→ Подключения", '.adm-nav[data-admtab="apps"]', back);
    await scenario(page, "→ Настройки", '.adm-nav[data-admtab="setup"]', back);

    /* A render that changes NOTHING. Pressing the section you are already in
       runs the whole pipeline — build the screen as a string, parse it, walk
       it for the dictionary, diff it against the DOM — and ends with the same
       pixels. It is also what every background probe and every fetch that
       lands does, several times per boot, so this row is the one that says
       what the paint memo is worth. */
    await page.locator('.adm-nav[data-admtab="over"]').click();
    await page.waitForTimeout(300);
    const nops: number[] = [];
    for (let i = 0; i < WARMUP + RUNS; i++) {
      const m = await timeClick(page, '.adm-nav[data-admtab="over"]');
      if (i >= WARMUP) nops.push(m.sync);
    }
    table.push({ name: "a render that changes nothing («Обзор» again)", sync: r1(median(nops)),
      ready: "—", reqs: "—", nodes: "—" });

    // the warehouse: 322 rows behind the «Склад» tab of «Товары»
    await page.locator('.adm-nav[data-admtab="goods"]').click();
    await page.waitForFunction(() => !!document.querySelector('.adm-tab[data-admtab="stock"]'), null, { timeout: 10_000 });
    await scenario(page, "Товары: Каталог ⇄ Склад (322 rows)",
      '.adm-tab[data-admtab="stock"]', '.adm-tab[data-admtab="goods"]');

    // «Заказы» with every one of the 100 orders on screen
    await page.locator('.adm-nav[data-admtab="orders"]').click();
    await page.waitForFunction(() => !!document.querySelector("[data-admorderq]"), null, { timeout: 10_000 });
    await scenario(page, "«Заказы»: чип «Все» ⇄ «Новые» (100 orders)",
      '[data-admfilter="all"]', '[data-admfilter="new"]');

    // one keystroke in the orders search over 100 orders
    await page.locator('[data-admfilter="all"]').click();
    const keys: number[] = [];
    for (let i = 0; i < WARMUP + RUNS; i++) {
      const one = await page.evaluate(() => {
        const box = document.querySelector("[data-admorderq]") as HTMLInputElement;
        box.value = "Мар" + Math.random().toString(36).slice(2, 4);
        const t = performance.now();
        box.dispatchEvent(new Event("input", { bubbles: true }));
        return performance.now() - t;
      });
      if (i >= WARMUP) keys.push(one);
    }
    table.push({ name: "«Заказы»: one keystroke in the search box", sync: r1(median(keys)), ready: "—", reqs: "—", nodes: "—" });

    // the search box still holds the last probe — empty it, or the list below
    // is a filtered nothing
    await page.evaluate(() => {
      const box = document.querySelector("[data-admorderq]") as HTMLInputElement;
      box.value = "";
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() => !!document.querySelector('[data-admorder]:not([data-admorder=""])'),
      null, { timeout: 10_000 });

    // an order card opening over a 100-order list («← Заказы» is data-admorder="")
    await scenario(page, "open an order card", '[data-admorder]:not([data-admorder=""])', '[data-admorder=""]');

    // the product editor over the 220-product catalogue
    await page.locator('.adm-nav[data-admtab="goods"]').click();
    await page.waitForFunction(() => !!document.querySelector("[data-admgoods]"), null, { timeout: 10_000 });
    await scenario(page, "open the product editor", "[data-admgoods]", "[data-admclose]");

    const calibEnd = await calibrate(page);
    const calib = r1((calibStart + calibEnd) / 2);
    const w = Math.max(...table.map((t) => t.name.length));
    const lines = ["", "ADMIN SPEED (median of " + RUNS + " runs, desktop 1280×800, CPU ×4, next dev warmed)",
      "(on the cold-open row `sync` is the whole boot's long-task blocking time)",
      "machine unit `calib` = " + calib + " ms (" + r1(calibStart) + " before the walk, " + r1(calibEnd) +
        " after) — the `u` column is `sync ÷ calib`, which is what two runs on a shared laptop can be compared on",
      "",
      "screen".padEnd(w) + "   sync ms   ready ms      u   reqs   nodes"];
    for (const t of table) {
      const u = typeof t.sync === "number" ? r1(t.sync / calib) : "—";
      lines.push(t.name.padEnd(w) + "   " + String(t.sync).padStart(7) + "   " +
        String(t.ready).padStart(8) + "   " + String(u).padStart(4) + "   " +
        String(t.reqs).padStart(4) + "   " + String(t.nodes).padStart(5));
    }
    console.log(lines.join("\n"));
    expect(table.length).toBeGreaterThan(5);
  });
});
