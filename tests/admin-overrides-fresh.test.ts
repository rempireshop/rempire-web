/**
 * The panel edits what the server holds, never the edge's older copy of it.
 *
 * Verification pass on staging, 25.09.2026 (ai-seo): the Google texts saved
 * in all three languages, the panel reloaded a minute later, and the SEO
 * fold said «пусто» in each. The panel booted from the PUBLIC feed
 * /api/overrides/ — `public, s-maxage=30, stale-while-revalidate=120`, and
 * the edge answered with its copy from before the save (x-vercel-cache STALE,
 * age 86 s). Typing into those boxes would have written over the saved text.
 *
 * Pinned here:
 *   · GET /api/admin/overrides/ is no-store and carries everything the panel
 *     edits — the SEO pairs, the salon price and the owner's own products;
 *   · signed in, the public feed's product half is not taken; the panel's
 *     own read is, and a product written while that read was in the air
 *     keeps what this page has;
 *   · on the panel, before it is known whether this is the owner, the public
 *     answer waits — and is taken when the answer is «no».
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ADMIN_COOKIE, hashPassword, makeSessionToken } from "@/lib/auth";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}
function decl(name: string): string {
  const m = src.match(new RegExp(`var ${name} = [^;]+;`));
  if (!m) throw new Error(`public/shop2/app.js no longer declares ${name}`);
  return m[0];
}

type Seo = Record<string, { t: string; d: string }>;
type Answer = { status: number; body: Record<string, unknown> };
type Rig = {
  S: { screen: string; cart: unknown[] };
  SRV: { admin: boolean | null; meDone: boolean; on: boolean; ovDone: boolean };
  DEMO: Record<string, Record<string, unknown>> & { custom: Array<{ id: string; name: string }> };
  calls: string[];
  /** the requests in the air, answered by hand, in any order */
  pending: Array<{ url: string; opts: Record<string, unknown> | undefined; answer: (a: Answer) => Promise<void> }>;
  fn: {
    loadServerOverrides: () => Promise<void>;
    loadAdminOverrides: (force: boolean) => void;
    ovAdminKnown: () => void;
    apiJson: (url: string, opts?: Record<string, unknown>) => Promise<Answer>;
  };
};

function rig(opts: { screen: string; admin: boolean | null; meDone?: boolean; seo?: Seo; custom?: Array<{ id: string; name: string }> }): Rig {
  const pending: Rig["pending"] = [];
  const calls: string[] = [];
  const S = { screen: opts.screen, cart: [] as unknown[] };
  const SRV = { admin: opts.admin, meDone: opts.meDone ?? opts.admin !== null, on: true, ovDone: false };
  const DEMO = {
    price: {}, stock: {}, seo: opts.seo ? { touchable: opts.seo } : {}, subcat: {}, varimg: {}, video: {},
    stockVar: {}, gallery: {}, desc: {}, proPrice: {}, sizes: {}, hidden: {},
    custom: opts.custom ? opts.custom.slice() : [],
  } as unknown as Rig["DEMO"];
  const fetchFake = (url: string, o?: Record<string, unknown>) => new Promise((resolve) => {
    pending.push({
      url, opts: o,
      answer: (a: Answer) => {
        resolve({ status: a.status, headers: { get: () => "application/json" }, json: () => Promise.resolve(a.body) });
        return new Promise<void>((r) => setTimeout(r, 5));   // the caller's .then()s run
      },
    });
  });
  const body = `
    var SEO_LANGS = ["RU", "ET", "EN"];
    var FEED_FETCH = { cache: "no-store" };
    var bootHeld = false, ADM_SET_AT = {}, LOYALTY_PUBLIC = {};
    ${decl("OV_LOCAL")}
    ${decl("ADM_OV")}
    ${decl("ADM_OV_RETRY_MS")}
    ${decl("OV_PUB")}
    ${decl("OV_MAPS")}
    ${slice("apiJson")}
    function sizeLadder(x) { return x; }
    ${slice("seoNorm")}
    function adoptCustom() { calls.push("adoptCustom"); }
    function byIdOrNull() { return {}; }
    function shopHidden() { return false; }
    function rebuildCatalogue() {}
    function routeFromPath() {}
    function shipDirty() { return false; }
    function shipFreshRow() { return null; }
    function feedShipRules() { return null; }
    function setShipRules() {}
    function waitAdopt() { calls.push("waitAdopt"); }
    function demoSave() {}
    function applyDemoOverrides() {}
    function render() { calls.push("render"); }
    function admGateSettled() {}
    function patchDelivery() {}
    function patchSummary() {}
    function rebuildCart() {}
    function noop() {}
    ${["ovWrote", "ovWroteReq", "ovLocalKeep", "ovPublicWay", "ovReleasePub", "loadAdminOverrides",
      "adoptProducts", "adoptServer", "loadServerOverrides", "ovAdminKnown"].map(slice).join("\n")}
    return { loadServerOverrides: loadServerOverrides, loadAdminOverrides: loadAdminOverrides,
      ovAdminKnown: ovAdminKnown, apiJson: apiJson };
  `;
  const fn = new Function("S", "SRV", "DEMO", "calls", "fetch", body)(S, SRV, DEMO, calls, fetchFake) as Rig["fn"];
  return { S, SRV, DEMO, calls, pending, fn };
}

const SAVED: Seo = { RU: { t: "Шампунь Ру", d: "Ру" }, ET: { t: "Šampoon", d: "Ee" }, EN: { t: "Shampoo", d: "En" } };
/** the edge's copy from before the save: no SEO at all */
const STALE = { status: 200, body: { ok: true, overrides: { touchable: { price: 20, seo: null } }, custom: [], settings: {} } };
/** the panel's own read: the saved pairs */
const FRESH = { status: 200, body: { ok: true, overrides: { touchable: { price: 20, seo: { RU: { title: "Шампунь Ру", desc: "Ру" }, ET: { title: "Šampoon", desc: "Ee" }, EN: { title: "Shampoo", desc: "En" } } } }, custom: [], waiting: {} } };

const flush = () => new Promise((r) => setTimeout(r, 5));

describe("the panel's products come from its own no-store read", () => {
  it("signed in: a stale public answer leaves the saved SEO alone, and the panel's read is asked", async () => {
    const r = rig({ screen: "admin", admin: true, seo: SAVED });
    const p = r.fn.loadServerOverrides();
    expect(r.pending[0].url).toBe("/api/overrides/");
    await r.pending[0].answer(STALE);
    await p;
    await flush();
    expect(r.DEMO.seo.touchable).toEqual(SAVED);   // before: {} — the fold said «пусто»
    const admin = r.pending.find((x) => x.url === "/api/admin/overrides/");
    expect(admin, "the panel's own read was not asked").toBeTruthy();
    expect(admin!.opts).toMatchObject({ cache: "no-store" });
  });

  it("the panel's read is what the fields then show", async () => {
    const r = rig({ screen: "admin", admin: true });
    r.fn.loadAdminOverrides(false);
    await r.pending[0].answer(FRESH);
    await flush();
    expect(r.DEMO.seo.touchable).toEqual(SAVED);
    expect(r.calls).toContain("render");
  });

  it("a product saved while that read was in the air keeps what this page holds", async () => {
    const r = rig({ screen: "admin", admin: true, seo: { RU: { t: "Старое", d: "" } } });
    r.fn.loadAdminOverrides(false);
    // the owner saves «Новое» — the read above was taken on the server before it
    r.DEMO.seo.touchable = { RU: { t: "Новое", d: "" } };
    void r.fn.apiJson("/api/admin/overrides/", { method: "PUT", body: JSON.stringify({ id: "touchable", seo: { RU: { title: "Новое" } } }) });
    const read = r.pending.find((x) => x.url === "/api/admin/overrides/" && !x.opts?.method)!;
    await read.answer({ status: 200, body: { ok: true, overrides: { touchable: { seo: { RU: { title: "Старое", desc: "" } } }, other: { price: 5 } }, custom: [], waiting: {} } });
    await flush();
    expect(r.DEMO.seo.touchable).toEqual({ RU: { t: "Новое", d: "" } });
    // …and everything else in that answer is taken
    expect(r.DEMO.price.other).toBe(5);
  });

  it("an own product saved here is not taken out of the list by a read from before the save", async () => {
    const mine = { id: "c-mine", name: "Новое имя" };
    const r = rig({ screen: "admin", admin: true, custom: [mine] });
    r.fn.loadAdminOverrides(false);
    void r.fn.apiJson("/api/admin/products/c-mine/", { method: "PUT", body: JSON.stringify({ name: "Новое имя" }) });
    const read = r.pending.find((x) => x.url === "/api/admin/overrides/")!;
    await read.answer({ status: 200, body: { ok: true, overrides: {}, custom: [{ id: "c-mine", name: "Старое имя" }, { id: "c-2", name: "Другой" }], waiting: {} } });
    await flush();
    expect(r.DEMO.custom.find((p) => p.id === "c-mine")!.name).toBe("Новое имя");
    expect(r.DEMO.custom.map((p) => p.id).sort()).toEqual(["c-2", "c-mine"]);
  });

  it("on the panel, owner not known yet: the public answer waits, and is taken when the answer is «no»", async () => {
    const r = rig({ screen: "admin", admin: null, meDone: false, seo: SAVED });
    const p = r.fn.loadServerOverrides();
    await r.pending[0].answer(STALE);
    await p;
    expect(r.DEMO.seo.touchable).toEqual(SAVED);
    r.SRV.admin = false; r.SRV.meDone = true;
    r.fn.ovAdminKnown();
    expect(r.DEMO.seo.touchable).toBeUndefined();   // a shopper's page: the feed is the shop
  });

  it("…and when the answer is «yes», the panel's read replaces it", async () => {
    const r = rig({ screen: "admin", admin: null, meDone: false, seo: SAVED });
    const p = r.fn.loadServerOverrides();
    await r.pending[0].answer(STALE);
    await p;
    r.SRV.admin = true; r.SRV.meDone = true;
    r.fn.ovAdminKnown();
    const read = r.pending.find((x) => x.url === "/api/admin/overrides/")!;
    await read.answer(FRESH);
    await flush();
    expect(r.DEMO.seo.touchable).toEqual(SAVED);
  });

  it("the shop's own screens still read the edge copy for a shopper", async () => {
    const r = rig({ screen: "catalog", admin: null, meDone: false });
    const p = r.fn.loadServerOverrides();
    await r.pending[0].answer({ status: 200, body: { ok: true, overrides: { touchable: { price: 21 } }, custom: [], settings: {} } });
    await p;
    expect(r.DEMO.price.touchable).toBe(21);
    expect(r.pending.some((x) => x.url === "/api/admin/overrides/")).toBe(false);
  });

  it("the panel asks for its read when it opens, and again after signing in", () => {
    const screen = slice("screenAdmin");
    expect(screen.indexOf("loadAdminOverrides(false)")).toBeGreaterThan(screen.indexOf('if (gate === "login")'));
    expect(slice("admLogin")).toContain("ADM_OV.at = 0;");
  });
});

describe("GET /api/admin/overrides/", () => {
  let admin = "";
  const ORIGIN = "https://rempireshop.com";

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(teardownDb);
  beforeEach(truncateAll);

  const req = (method: string, path: string, body?: unknown) => new Request(`${ORIGIN}${path}`, {
    method, headers: { cookie: admin, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });

  it("is no-store and carries the SEO pairs, the salon price and the owner's active products", async () => {
    const { PUT, GET } = await import("@/app/api/admin/overrides/route");
    const { createCustomProduct } = await import("@/lib/custom-products");
    await PUT(req("PUT", "/api/admin/overrides/", { id: "touchable", proPrice: 12, seo: { RU: { title: "Ру" }, ET: { title: "Ee" }, EN: { title: "En" } } }));
    const own = await createCustomProduct({ brand: "Proraso", name: "Бальзам", cat: "beard", sizes: ["100 мл"], prices: [14.9] });
    const res = await GET(req("GET", "/api/admin/overrides/"));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.overrides.touchable.seo).toEqual({ RU: { title: "Ру" }, ET: { title: "Ee" }, EN: { title: "En" } });
    expect(body.overrides.touchable.proPrice).toBe(12);
    expect(Array.isArray(body.custom)).toBe(true);
    const fed = (body.custom as Array<{ id: string }>).find((p) => p.id === own.id);
    // the same shape the public feed hands the shop
    const { GET: publicGet } = await import("@/app/api/overrides/route");
    const pub = await (await publicGet()).json();
    expect(fed).toEqual((pub.custom as Array<{ id: string }>).find((p) => p.id === own.id));
  });

  it("still requires the admin cookie", async () => {
    const { GET } = await import("@/app/api/admin/overrides/route");
    const res = await GET(new Request(`${ORIGIN}/api/admin/overrides/`));
    expect(res.status).toBe(401);
  });
});
