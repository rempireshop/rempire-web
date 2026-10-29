import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { functionalProject, ipHeaders, loginAsAdmin, shopUrl, waitForScreen } from "./fixtures";
import { watchPage } from "./sweep-shop-helpers";

/**
 * The Renat-proof shop test — the running half of tools/chaos-build.mjs.
 *
 * On 28.10.2026 Renat hid the Yumain line in the panel and the set made of
 * three of them asked for /collections/sets/undefined on every view; the
 * deployed smoke test found it the next night. Nothing in the code had
 * changed — only what the owner may do. So this makes the edits he makes,
 * through the panel's own API, and walks every kind of page as a shopper
 * would: no uncaught error, no console error, no same-origin request that
 * fails, and no «undefined» / «NaN» on the screen. Everything is put back
 * afterwards — the other specs share this database.
 */
type Min = { id: string; b: string; n: string; c: string; sb?: string };
const CATALOGUE = JSON.parse(readFileSync(path.join(__dirname, "..", "src", "data", "catalogue.min.json"), "utf8")) as Min[];

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one browser is enough for a data test");
  test.skip(!functionalProject(testInfo), "functional spec");
});
test.use({ extraHTTPHeaders: ipHeaders(83) });

/* The panel's edits, as the overrides route takes them, and how to undo each. */
async function adminPut(page: Page, data: Record<string, unknown>): Promise<void> {
  const r = await page.request.put("/api/admin/overrides/", { data });
  expect(r.ok(), `PUT ${JSON.stringify(data).slice(0, 120)} → ${r.status()} ${await r.text()}`).toBe(true);
}

test("after the owner's edits, every kind of page still renders cleanly", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await loginAsAdmin(page);

  /* the parts of the first set, from the live answer — hidden like the Yumain line */
  const sets = (await (await page.request.get("/api/bundles/")).json()).bundles as Array<{ id: string; items: Array<{ productId: string }> }>;
  const set = sets[0];
  const setParts = set ? set.items.map((it) => it.productId) : [];
  /* a whole brand of two or more products, none of them in that set */
  const byBrand = new Map<string, string[]>();
  for (const p of CATALOGUE) byBrand.set(p.b, [...(byBrand.get(p.b) ?? []), p.id]);
  const [brand, brandIds] = [...byBrand].find(([, list]) => list.length >= 2 && list.length <= 6 && !list.some((id) => setParts.includes(id)))!;
  /* a product renamed with no type word, odd Google words, «без подраздела» */
  const renamed = CATALOGUE.find((p) => p.c === "styling" && !setParts.includes(p.id) && p.b !== brand)!;

  const hidden = [...setParts, ...brandIds];
  try {
    for (const id of hidden) await adminPut(page, { id, hidden: true });
    await adminPut(page, { id: renamed.id, name: "Strong Hold Mat Clay", subcat: "-" });
    await adminPut(page, { id: renamed.id, seo: { RU: { title: `«Глина» & "паста" <b>x</b>`, desc: "Описание & ещё" } } });

    /* a shopper's fresh browser: nothing of the admin's session, nothing cached */
    const ctx = await browser.newContext({ extraHTTPHeaders: ipHeaders(84) });
    const shopper = await ctx.newPage();
    const watch = watchPage(shopper);
    const broken: string[] = [];
    shopper.on("response", (r) => {
      const u = new URL(r.url());
      // the AI search step answers 503 by design where no OpenAI key is set, as here (src/app/api/search/route.ts)
      if (r.status() === 503 && u.pathname === "/api/search/") return;
      if (u.origin === new URL(shopper.url() || "http://x").origin && r.status() >= 400) broken.push(`${r.status()} ${u.pathname}`);
    });
    shopper.on("requestfailed", (r) => {
      // the shop's own requests; one the next navigation cut off is not a failure
      const same = new URL(r.url()).origin === new URL(shopper.url() || "http://x").origin;
      if (same && !/ERR_ABORTED|NS_BINDING_ABORTED/.test(r.failure()?.errorText ?? "")) broken.push(`failed ${r.url()}`);
    });

    const walk: Array<[string, string]> = [
      ["/", "home"],
      ["/c/" + renamed.c + "/", "catalog"],
      ...(renamed.sb ? [["/c/" + renamed.sb + "/", "catalog"] as [string, string]] : []),
      ["/p/" + renamed.id + "/", "product"],
      ["/brands/", "brands"],
      ...(set ? [["/sets/", "bundles"], ["/set/" + set.id + "/", "bundle"]] as Array<[string, string]> : []),
      ["/search/?q=" + encodeURIComponent(brand), "search"],
    ];
    for (const [path, screen] of walk) {
      for (const seg of ["", "/et", "/en"]) {
        watch.reset();
        broken.length = 0;
        const url = shopUrl(seg, path);
        await shopper.goto(url);
        await waitForScreen(shopper, screen);
        await shopper.waitForLoadState("networkidle").catch(() => {});
        const text = await shopper.locator("body").innerText();
        expect(text, `${url}: «undefined»/«NaN» on the screen`).not.toMatch(/\bundefined\b|\bNaN\b|\[object Object\]/);
        expect(watch.pageErrors, `${url}: uncaught error`).toEqual([]);
        expect(watch.consoleErrors, `${url}: console error`).toEqual([]);
        expect(broken, `${url}: requests that failed`).toEqual([]);
      }
    }
    await ctx.close();
  } finally {
    for (const id of hidden) await adminPut(page, { id, hidden: false });
    await adminPut(page, { id: renamed.id, name: null, subcat: null, seo: { RU: null } });
  }
});
