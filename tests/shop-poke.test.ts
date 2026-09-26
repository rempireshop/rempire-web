/**
 * The panel tells the shop's open tabs that what they show has just changed.
 *
 * Dim, 26.09.2026 (/test people-reviews, people-points, people-remove-partner
 * — all «works but takes time»). Measured on a local server the same day,
 * every request in the three flows answers in 20–50 ms; the time was spent in
 * copies:
 *   · a product's reviews: this tab's own copy (S.dbReviews — never asked
 *     again while the tab stayed open), the browser's (max-age=60) and the
 *     CDN's (staging: X-Vercel-Cache HIT, plus ten minutes of
 *     stale-while-revalidate that a quiet shop hits on nearly every visit);
 *   · the profile — points, partner status and every salon price — asked
 *     again only when the tab came back to the front or the checkout opened;
 *     and coming back to the front inside a held wait fired the hold and read
 *     the profile in the same instant, from before the change.
 *
 * So: the panel writes a key when a change LANDS (shopPoke); the shop's other
 * tabs hear it (storage), drop their copy, and ask past every cache
 * (`&fresh=<time>`); the profile is also asked on the way into the cabinet
 * and the pages that show prices; and GET /api/reviews is cached at the CDN
 * for thirty seconds and not in the browser.
 *
 * The shop's functions are cut out of public/shop2/app.js by source text and
 * run over a stand-in localStorage and fetch.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupDb, teardownDb } from "./helpers";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

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
function sliceVar(name: string): string {
  const start = src.indexOf(`var ${name} = `);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  return src.slice(start, src.indexOf(";", start) + 1);
}

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The shop's reviews half over stubs; `now` is the clock. */
function shop(S: Any, store: Record<string, string>, clock: { now: number }): Any {
  const urls: string[] = [];
  let renders = 0;
  let answer: Any = { ok: true, reviews: [], avg: 0, n: 0 };
  const localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
  };
  const fetch = (url: string) => { urls.push(url); return Promise.resolve({ json: () => Promise.resolve(answer) }); };
  const DateStub = { now: () => clock.now };
  const api = new Function("S", "localStorage", "fetch", "render", "Date", `
    ${sliceVar("REV_RETRY_MS")} ${sliceVar("revAskedAt")}
    ${sliceVar("ACCT_POKE_LS")} ${sliceVar("REV_POKE_LS")} ${sliceVar("SHOP_POKE_MS")}
    ${slice("loadReviews")} ${slice("shopPoke")} ${slice("reviewsPokes")} ${slice("reviewsFreshStamp")} ${slice("reviewsPoked")}
    return { load: loadReviews, poke: shopPoke, stamp: reviewsFreshStamp, poked: reviewsPoked };
  `)(S, localStorage, fetch, () => { renders++; }, DateStub) as Any;
  return {
    ...api, urls,
    get renders() { return renders; },
    answer(a: Any) { answer = a; },
  };
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe("reviews: the panel's publish reaches the product page past every copy", () => {
  it("a product page asks plainly — until the panel has changed its reviews", async () => {
    const S: Any = { dbReviews: {}, screen: "product", productId: "p1" };
    const store: Record<string, string> = {};
    const clock = { now: 1_000_000 };
    const s = shop(S, store, clock);
    s.load("p1");
    expect(s.urls).toEqual(["/api/reviews/?product=p1"]);
  });

  it("a publish in the panel: this tab's copy goes, and the page on screen asks again with the time in the URL", async () => {
    const S: Any = { dbReviews: { p1: [{ id: "old" }], p2: [] }, screen: "product", productId: "p1" };
    const store: Record<string, string> = {};
    const clock = { now: 2_000_000 };
    const s = shop(S, store, clock);
    s.answer({ ok: true, reviews: [{ id: "old" }, { id: "new" }] });
    s.poke("reviews", "p1");
    // the key the other tabs hear, and read later
    expect(JSON.parse(store["rempire-shop-poke-reviews"])).toEqual({ p1: 2_000_000 });
    expect(s.urls).toEqual(["/api/reviews/?product=p1&fresh=2000000"]);
    await flush();
    expect(S.dbReviews.p1).toHaveLength(2);
    expect(s.renders).toBe(1);
    // another product's copy is not this publish's business
    expect(S.dbReviews.p2).toEqual([]);
  });

  it("a hide that leaves NO reviews redraws the page — an empty answer is news here", async () => {
    const S: Any = { dbReviews: { p1: [{ id: "only" }] }, screen: "product", productId: "p1" };
    const s = shop(S, {}, { now: 5 });
    s.answer({ ok: true, reviews: [] });
    s.poke("reviews", "p1");
    await flush();
    expect(S.dbReviews.p1).toEqual([]);
    expect(s.renders, "the hidden review stayed on the page").toBe(1);
  });

  it("a tab opened later in this browser reads the key: for ten minutes, that product only", () => {
    const store: Record<string, string> = { "rempire-shop-poke-reviews": JSON.stringify({ p1: 3_000_000 }) };
    const clock = { now: 3_000_000 + 60_000 };
    const s = shop({ dbReviews: {}, screen: "home", productId: "" }, store, clock);
    s.load("p1");
    s.load("p2");
    expect(s.urls).toEqual(["/api/reviews/?product=p1&fresh=3000000", "/api/reviews/?product=p2"]);
    clock.now = 3_000_000 + 10 * 60_000 + 1;
    expect(s.stamp("p1"), "a stamp older than ten minutes is forgotten").toBe(0);
  });

  it("a moderation whose product is not known busts every product («*»)", () => {
    const store: Record<string, string> = {};
    const s = shop({ dbReviews: { a: [], b: [{ id: 1 }] }, screen: "admin", productId: "" }, store, { now: 7_000 });
    s.poke("reviews", "");
    expect(JSON.parse(store["rempire-shop-poke-reviews"])).toEqual({ "*": 7_000 });
    expect(s.stamp("anything")).toBe(7_000);
  });

  it("the shop's other tabs listen for both keys", () => {
    const at = src.indexOf('window.addEventListener("storage"');
    expect(at, "no storage listener in app.js").toBeGreaterThan(0);
    const block = src.slice(at, src.indexOf("});", at));
    expect(block).toContain("if (e.key === ACCT_POKE_LS) acctRefresh(0);");
    expect(block).toContain("reviewsPoked(newest)");
  });

  it("the panel pokes when a moderation LANDS — not when it is pressed", () => {
    const at = src.indexOf('else if (a.type === "moderate_review") {');
    const branch = src.slice(at, src.indexOf('else if (a.type === "set_gift_amounts")', at));
    const ok = branch.indexOf("if (r.status === 200 && r.body.ok) {");
    expect(ok).toBeGreaterThan(0);
    expect(branch.indexOf('shopPoke("reviews"')).toBeGreaterThan(ok);
  });
});

describe("the profile: asked again when the panel changed it, and on the way into the pages it prices", () => {
  const refresh = (clock: { now: number }, freshAt: number) => {
    let loads = 0;
    const fns = new Function("S", "Date", "acctLoad", `
      var acctAsked = true, acctFreshAt = ${freshAt};
      ${slice("acctRefresh")}
      return acctRefresh;
    `)({ loggedIn: true }, { now: () => clock.now }, () => { loads++; }) as (floor?: number) => void;
    return { run: fns, get loads() { return loads; } };
  };

  it("the panel's word asks at once, whatever was asked a moment ago; a screen waits fifteen seconds", () => {
    const clock = { now: 100_000 };
    const r = refresh(clock, 99_000);
    r.run();
    expect(r.loads, "three seconds, as before").toBe(0);
    r.run(0);
    expect(r.loads, "the panel said the profile changed — asked now").toBe(1);
    const q = refresh(clock, 90_000);
    q.run(15000);
    expect(q.loads).toBe(0);
    clock.now = 106_000;
    q.run(15000);
    expect(q.loads).toBe(1);
  });

  it("the cabinet asks on the way in; the catalogue, a product and the home page within fifteen seconds", () => {
    const go = slice("go");
    expect(go).toContain('else if (screen === "account") acctRefresh();');
    expect(go).toContain('else if (screen === "product" || screen === "catalog" || screen === "home") acctRefresh(15000);');
  });

  it("every panel write that changes what a customer sees pokes the profile once it has landed", () => {
    // points (the held correction and the journal's), the tier switch, approve / reject, «+ Партнёр»
    expect(slice("adjustCustomerPoints")).toMatch(/toast\("Баллы сохранены ✓"\);\s*shopPoke\("account"\);/);
    expect(slice("admCustPatch")).toMatch(/if \(mine\) loadAdminCustomerDetail\(id, true\);\s*shopPoke\("account"\);/);
    expect(slice("applyAddPartner")).toContain('shopPoke("account");');
    const tier = src.slice(src.indexOf('else if (a.type === "set_tier") {\n      var tierId'));
    expect(tier.slice(0, 2000)).toMatch(/admCustAdopt\(r\.body\.customer\);[\s\S]{0,120}shopPoke\("account"\);/);
  });
});

describe("GET /api/reviews: thirty seconds at the CDN, nothing in the browser", () => {
  beforeAll(async () => { await setupDb(); });
  afterAll(teardownDb);

  it("says so in its header — no minute in the browser, no ten minutes of stale answers", async () => {
    const { GET } = await import("@/app/api/reviews/route");
    const res = await GET(new Request("http://localhost/api/reviews/?product=system-4-bio-botanical-shampoo"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=30");
    // the bust parameter is only a new address: the answer is the same
    const busted = await GET(new Request("http://localhost/api/reviews/?product=system-4-bio-botanical-shampoo&fresh=123"));
    expect(await busted.json()).toEqual(await res.json());
  });
});
