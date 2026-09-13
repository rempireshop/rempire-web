/**
 * Opening a screen — the waterfall, not the render.
 *
 * Renat, 13.09.2026: «the loading of the user data when you go to checkout,
 * the things in overview which are loaded slowly». e2e/perf-admin.spec.ts
 * already times the RENDER of every admin section (the click handler, the
 * morph). This file times the other half — the REQUESTS a screen makes when
 * it is opened cold, in the order they actually leave the browser — because a
 * screen whose three calls wait for each other is slow in a way no render
 * measurement can see.
 *
 * Like perf-admin.spec.ts this is a stopwatch, not a test: it prints a table
 * and asserts only that the screen came up at all. NOT named `admin-*` or
 * `checkout-*` so it does not join those suites.
 *
 *   node tools/e2e-build.mjs
 *   E2E_PORT=4417 npx playwright test e2e/perf-open.spec.ts --project=desktop
 *
 * The three latencies
 *   Everything here runs against PGlite in the same node process as the route
 *   — a database read is a function call, ~1 ms — and against a dev server
 *   that answers one request at a time. The real shop talks to a Postgres in
 *   another data centre over a phone's network, and answers its requests in
 *   parallel; there the cost of a screen is dominated by how many times it
 *   goes to the server and back, not by what each call does. So every scenario
 *   is run at three latencies (LATENCIES below), a fixed delay added to every
 *   /api/ response: `+0` says whether the code itself got worse, `+120` is a
 *   good mobile connection, `+400` a bad one — and only the last two can see
 *   the difference between two round trips and one, because at `+0` the dev
 *   server's own queue is bigger than the thing being measured.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { E2E_ADMIN_PASSWORD } from "./env.mjs";
import { freshEmail, ipHeaders, payOrder, PRODUCT, shopUrl, waitForScreen } from "./fixtures";

const RUNS = 5;
/* No added delay (what this machine actually is), one mobile round trip, and
   one slow one. The third band is not decoration: the dev server answers
   requests more or less in single file, so at +0 a screen that fires its three
   calls together only moves its own queue, and the structural change — one
   round trip instead of two — is buried under it. At +400 the network is
   bigger than the queue, and the shape of the waterfall is what the number
   measures. */
const LATENCIES = [0, 120, 400];

type Hit = { path: string; start: number; end: number };
type Row = { name: string; lat: number; trips: number; chain: number; paint: number; data: number;
  wait: number; after: number | string; calls: string };
const table: Row[] = [];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
const r0 = (n: number) => Math.round(n);

/**
 * Adds `ms` to every /api/ response, so a screen's own shape — how many times
 * it goes to the server, and how many of those wait for each other — shows up
 * as milliseconds instead of having to be read off a list.
 */
async function addLatency(page: Page, ms: number): Promise<void> {
  if (!ms) return;
  await page.route(
    (u) => u.pathname.startsWith("/api/"),
    async (route: Route) => {
      await new Promise((r) => setTimeout(r, ms));
      await route.continue();
    },
  );
}

/** Every /api/ call this page makes, with when it left and when it came back.
 *  Keyed on the request OBJECT, not on its URL: two calls for the same URL in
 *  flight at once is exactly the thing this file is looking for, and matching
 *  a response to "the last hit with this path" would hide it. */
function watch(page: Page): { hits: Hit[]; start: () => void; stop: () => void } {
  const hits: Hit[] = [];
  const byReq = new Map<unknown, Hit>();
  let t0 = Date.now();
  const onReq = (r: { url: () => string }) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/api/")) return;
    const hit: Hit = { path: u.pathname + u.search, start: Date.now() - t0, end: -1 };
    hits.push(hit);
    byReq.set(r, hit);
  };
  const onRes = (r: { request: () => unknown }) => {
    const hit = byReq.get(r.request());
    if (hit && hit.end < 0) hit.end = Date.now() - t0;
  };
  return {
    hits,
    start() { hits.length = 0; byReq.clear(); t0 = Date.now(); page.on("request", onReq); page.on("response", onRes); },
    stop() { page.off("request", onReq); page.off("response", onRes); },
  };
}

/**
 * How deep the waterfall is: the longest chain of calls where each one only
 * STARTED after the one before it had already come back. Two calls that left
 * together count as one step; a call that waited for another's answer counts
 * as two. This is the number a remote database multiplies.
 */
function chainDepth(hits: Hit[]): number {
  const done = hits.filter((h) => h.end >= 0).sort((a, b) => a.start - b.start);
  let depth = 0;
  for (const h of done) {
    let best = 0;
    for (const p of done) {
      // 15 ms of slack: two calls fired from the same turn of the event loop
      // do not leave at the same millisecond
      if (p !== h && p.end >= 0 && p.end <= h.start + 15 && p.start < h.start) {
        best = Math.max(best, depthOf(p, done));
      }
    }
    depth = Math.max(depth, best + 1);
  }
  return depth;
}
function depthOf(h: Hit, all: Hit[]): number {
  let best = 0;
  for (const p of all) {
    if (p !== h && p.end >= 0 && p.end <= h.start + 15 && p.start < h.start) best = Math.max(best, depthOf(p, all));
  }
  return best + 1;
}

/** When the answer this screen was actually waiting for came back, so the gap
 *  between that and the milestone separates "waiting for the server" from
 *  "what the page then does with the answer". -1 when it never arrived. */
function endOf(hits: Hit[], path: string): number {
  let last = -1;
  for (const h of hits) if (h.end >= 0 && h.path.indexOf(path) === 0) last = Math.max(last, h.end);
  return last;
}

function printable(hits: Hit[]): string {
  return hits
    .filter((h) => h.end >= 0)
    .sort((a, b) => a.start - b.start)
    .map((h) => `${h.path} @${h.start}→${h.end}`)
    .join("\n      ");
}

test.describe("opening a screen — the waterfall", () => {
  test.use({ extraHTTPHeaders: ipHeaders(161) });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one viewport, one stopwatch");
  });
  test.setTimeout(600_000);

  test("checkout, signed in", async ({ page }) => {
    const email = freshEmail("perf-co");

    // A customer who has bought once and whose profile the checkout can fill in.
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    await payOrder(page, email, "paid");

    await page.goto(shopUrl("", "/account/"));
    await waitForScreen(page, "account");
    await page.locator("[data-email]").fill(email);
    const codeResponse = page.waitForResponse((r) => r.url().includes("/api/account/code/"));
    await page.locator("[data-login]").click();
    const code = ((await (await codeResponse).json()) as { code?: string }).code!;
    await page.locator("[data-acctcode]").fill(code);
    await page.locator("[data-logincode]").click();
    await expect(page.locator("[data-logout]")).toBeVisible();
    const name = page.locator('[data-acctf="name"]');
    await name.fill("Перф Тестов");
    await name.blur();
    await expect(page.locator('[data-acctst="name"]')).toContainText("✓");

    // …and something in the cart, so /checkout/ is a real checkout
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await expect(page.getByRole("status")).toBeVisible();

    const spy = watch(page);
    for (const lat of LATENCIES) {
      await addLatency(page, lat);
      const paints: number[] = [], datas: number[] = [], trips: number[] = [], chains: number[] = [];
      const afters: number[] = [], waits: number[] = [];
      let calls = "";
      for (let i = 0; i < 1 + RUNS; i++) {
        spy.start();
        const t0 = Date.now();
        await page.goto(shopUrl("", "/checkout/"));
        await waitForScreen(page, "checkout");
        const paint = Date.now() - t0;
        /* The milestone the owner names: the box that should already know his
           address actually carries it. acctLoad() fills it from the profile
           the moment /api/account/me answers. waitForFunction, not
           expect.poll — the latter's own 100/250/500 ms ladder is coarser
           than the difference being measured. */
        await page.waitForFunction((want) => {
          const box = document.querySelector("[data-email]") as HTMLInputElement | null;
          return !!box && box.value === want;
        }, email, { timeout: 30_000 });
        const data = Date.now() - t0;
        await page.waitForTimeout(600 + lat * 2);
        spy.stop();
        if (i) {
          paints.push(paint); datas.push(data); waits.push(data - paint);
          trips.push(spy.hits.filter((h) => h.end >= 0).length);
          chains.push(chainDepth(spy.hits));
          const me = endOf(spy.hits, "/api/account/me/");
          if (me >= 0) afters.push(data - me);
          calls = printable(spy.hits);
        }
      }
      table.push({ name: "checkout (signed in)", lat, trips: median(trips), chain: median(chains),
        paint: r0(median(paints)), data: r0(median(datas)), wait: r0(median(waits)),
        after: afters.length ? r0(median(afters)) : "—", calls });
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
    expect(table.length).toBeGreaterThan(0);
  });

  test("admin «Обзор», cold open", async ({ page }) => {
    /* One paid order, so the screen has something to be waiting FOR: with an
       empty shop every figure on «Обзор» is zero before and after the summary
       lands, and "the numbers are on screen" is not observable. */
    await page.goto(shopUrl("", `/p/${PRODUCT.id}/`));
    await waitForScreen(page, "product");
    await page.locator(`.pdp__add[data-add="${PRODUCT.id}"]`).click();
    await page.goto(shopUrl("", "/checkout/"));
    await waitForScreen(page, "checkout");
    await payOrder(page, freshEmail("perf-adm"), "paid");

    await page.goto(shopUrl("", "/admin/"));
    const pw = page.locator("[data-admpw]");
    await expect(pw).toBeVisible();
    await expect.poll(async () => { await pw.fill(E2E_ADMIN_PASSWORD); return pw.inputValue(); },
      { timeout: 10_000 }).toBe(E2E_ADMIN_PASSWORD);
    await page.locator("[data-admlogin]").click();
    await expect(page.locator('[data-admtab="orders"][aria-current]:visible').first()).toBeVisible();
    // `next dev` compiles each route on its first hit — never in a number
    await page.waitForTimeout(2000);

    const spy = watch(page);
    for (const lat of LATENCIES) {
      await addLatency(page, lat);
      const paints: number[] = [], datas: number[] = [], trips: number[] = [], chains: number[] = [];
      const afters: number[] = [], waits: number[] = [];
      let calls = "";
      for (let i = 0; i < 1 + RUNS; i++) {
        spy.start();
        const t0 = Date.now();
        await page.goto(shopUrl("", "/admin/"));
        /* First paint of the panel: the shell with its navigation, before any
           figure on it is real. */
        await page.waitForFunction(() => {
          const slot = document.querySelector("#bodyslot");
          return !!slot && !!slot.querySelector(".adm-nav");
        }, null, { timeout: 30_000 });
        const paint = Date.now() - t0;
        /* …and the milestone the owner names: «Обзор» has its own numbers on
           it. «Последние заказы» is drawn from /api/admin/orders/ and the
           «7 дней» cell from /api/admin/overview/, so a screen that has both
           has everything it was waiting for. */
        await page.waitForFunction(() => {
          const slot = document.querySelector("#bodyslot");
          if (!slot || slot.querySelector(".adm-skel")) return false;
          const rows = slot.querySelectorAll("[data-admorder]").length;
          const week = slot.querySelectorAll(".adm-sales__cell")[1];
          const bars = week ? week.querySelectorAll(".adm-bars i").length : 0;
          return rows > 0 && bars > 0;
        }, null, { timeout: 30_000 });
        const data = Date.now() - t0;
        await page.waitForTimeout(800 + lat * 2);
        spy.stop();
        if (i) {
          paints.push(paint); datas.push(data); waits.push(data - paint);
          trips.push(spy.hits.filter((h) => h.end >= 0).length);
          chains.push(chainDepth(spy.hits));
          const last = endOf(spy.hits, "/api/admin/overview/");
          if (last >= 0) afters.push(data - last);
          calls = printable(spy.hits);
        }
      }
      table.push({ name: "admin «Обзор» (cold)", lat, trips: median(trips), chain: median(chains),
        paint: r0(median(paints)), data: r0(median(datas)), wait: r0(median(waits)),
        after: afters.length ? r0(median(afters)) : "—", calls });
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
    expect(table.length).toBeGreaterThan(0);
  });

  test.afterAll(() => {
    if (!table.length) return;
    const w = Math.max(...table.map((t) => t.name.length));
    const lines = ["", "OPENING A SCREEN — median of " + RUNS + " runs, desktop, next dev warmed",
      "  trips = /api/ calls the open makes   chain = how many of them wait for each other",
      "  paint = screen on screen             data  = the fields/figures are real",
      "  wait  = data minus paint: how long the owner looks at a screen that is",
      "          on but not yet true. THE headline number — it is the only column",
      "          the machine's own mood cannot move much, since both ends of it",
      "          come from the same run.",
      "  after = data minus the moment the screen's own last answer came back;",
      "          a big one means the answer beat the paint, which is the point", "",
      "screen".padEnd(w) + "   added   trips   chain   paint ms   data ms   wait ms   after ms"];
    for (const t of table) {
      lines.push(t.name.padEnd(w) + "   " + String("+" + t.lat).padStart(5) + "   " +
        String(t.trips).padStart(5) + "   " + String(t.chain).padStart(5) + "   " +
        String(t.paint).padStart(8) + "   " + String(t.data).padStart(7) + "   " +
        String(t.wait).padStart(7) + "   " + String(t.after).padStart(8));
    }
    for (const t of table) {
      lines.push("", t.name + " +" + t.lat + " ms — the calls, in the order they left:", "      " + t.calls);
    }
    console.log(lines.join("\n"));
  });
});
