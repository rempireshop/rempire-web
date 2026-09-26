/**
 * POST /api/search — the shop's last-resort «what does this phrase mean».
 *
 * The prompt, the sanitiser and the cache are pure (src/lib/search-terms.ts)
 * and tested as such. The route is tested with a stubbed fetch, the same
 * idiom as tests/ai-text-route.test.ts: no test in this file ever reaches a
 * real model, and the first assertion of most of them is that it did not try.
 */
import vm from "node:vm";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/auth";
import { slice, sliceVar } from "../tools/search-bench.mjs";
import {
  buildSearchTermsPrompt,
  cachedTerms,
  cleanSearchQuery,
  cleanSearchTerms,
  isSearchLang,
  rememberTerms,
  resetSearchTermsCache,
  searchCacheKey,
  SEARCH_QUERY_MAX,
  SEARCH_TERMS_MAX,
} from "@/lib/search-terms";

const ORIGIN = "https://rempireshop.com";
const HOST = "rempireshop.com";

function req(body: unknown, opts: { origin?: string; host?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", host: opts.host ?? HOST };
  if (opts.origin !== undefined) headers.origin = opts.origin;
  return new NextRequest(`${ORIGIN}/api/search/`, {
    method: "POST",
    headers,
    body: opts.raw ?? JSON.stringify(body),
  });
}

function fakeCompletion(content: unknown) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("the phrase that reaches the model", () => {
  it("is one line, trimmed and capped", () => {
    expect(cleanSearchQuery("  жирные   волосы \n")).toBe("жирные волосы");
    expect(cleanSearchQuery("a\u0000b\tc")).toBe("a b c");
    expect(cleanSearchQuery("x".repeat(400))).toHaveLength(SEARCH_QUERY_MAX);
  });

  it("is nothing at all when there is nothing to translate", () => {
    for (const bad of ["", " ", "a", 12, null, undefined, {}, ["жирные"], "1234567890", "!!! ???", "😀😀"]) {
      expect(cleanSearchQuery(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("names the shop's own world in the prompt, and asks for JSON only", () => {
    const { system, user } = buildSearchTermsPrompt("cheveux gras", "ET");
    expect(system).toContain("System 4");
    expect(system).toContain("Kevin.Murphy");
    expect(system).toContain("hair care");
    expect(system).toMatch(/Russian, Estonian and English/);
    expect(system).toContain('{"terms":');
    // and it is told to refuse rather than invent
    expect(system).toMatch(/empty list rather than guessing/);
    expect(user).toContain("cheveux gras");
    expect(user).toContain("ET");
  });

  it("knows the three languages the shop speaks and nothing else", () => {
    expect(isSearchLang("RU")).toBe(true);
    expect(isSearchLang("ET")).toBe(true);
    expect(isSearchLang("EN")).toBe(true);
    expect(isSearchLang("ru")).toBe(false);
    expect(isSearchLang(null)).toBe(false);
  });
});

describe("the model's answer, rebuilt field by field", () => {
  it("keeps short plain terms, lower-cased, in order", () => {
    expect(cleanSearchTerms({ terms: ["Жирные Волосы", "OILY", "sebum"] }))
      .toEqual(["жирные волосы", "oily", "sebum"]);
    expect(cleanSearchTerms(["dandruff"])).toEqual(["dandruff"]);
  });

  it("drops everything a search term is not", () => {
    expect(cleanSearchTerms({
      terms: [
        "<script>alert(1)</script>",           // markup → the words, no tags
        "a shampoo for oily hair every day",   // a sentence, not a term
        "",
        "  ",
        1234,
        null,
        { term: "oily" },
        "oily",
        "OILY",                                 // the same term twice
      ],
    })).toEqual(["oily"]);
  });

  it("answers with a list even when the model did not", () => {
    for (const junk of [null, undefined, "terms", 42, {}, { terms: "oily" }, []]) {
      expect(cleanSearchTerms(junk), JSON.stringify(junk)).toEqual([]);
    }
  });

  it("never returns more than the search can use", () => {
    const many = Array.from({ length: 40 }, (_, i) => `term${i}`);
    expect(cleanSearchTerms({ terms: many })).toHaveLength(SEARCH_TERMS_MAX);
  });
});

describe("the cache", () => {
  beforeEach(() => resetSearchTermsCache());

  it("does not care how the phrase was typed", () => {
    const a = searchCacheKey("Жирные   Волосы", "RU");
    const b = searchCacheKey("жирные волосы", "RU");
    expect(a).toBe(b);
    expect(searchCacheKey("жирные волосы", "ET")).not.toBe(a);
  });

  it("remembers an answer, and forgets nothing it was not asked to", () => {
    rememberTerms("RU|x", ["oily"]);
    expect(cachedTerms("RU|x")).toEqual(["oily"]);
    expect(cachedTerms("RU|y")).toBeNull();
  });
});

describe("POST /api/search", () => {
  const savedKey = process.env.OPENAI_API_KEY;
  afterAll(() => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  });
  beforeEach(() => {
    resetRateLimits();
    resetSearchTermsCache();
    process.env.OPENAI_API_KEY = "sk-test-dummy";
  });
  afterEach(() => vi.unstubAllGlobals());

  const load = () => import("@/app/api/search/route");
  const noCalls = () => vi.stubGlobal("fetch", () => { throw new Error("must not reach the model"); });

  it("turns a phrase into catalogue words", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeCompletion({ terms: ["жирные волосы", "oily", "sebum"] })));
    const { POST } = await load();
    const res = await POST(req({ q: "cheveux gras", lang: "RU" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, terms: ["жирные волосы", "oily", "sebum"], cached: false });
  });

  it("asks once and remembers — however the phrase is typed the second time", async () => {
    const fetchMock = vi.fn(async () => fakeCompletion({ terms: ["oily"] }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await load();
    await POST(req({ q: "cheveux gras", lang: "RU" }));
    const again = await POST(req({ q: "Cheveux   Gras", lang: "RU" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await again.json()).toEqual({ ok: true, terms: ["oily"], cached: true });
  });

  it("remembers an empty answer too — «what is my order number» is paid for once", async () => {
    const fetchMock = vi.fn(async () => fakeCompletion({ terms: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await load();
    const first = await POST(req({ q: "где мой заказ", lang: "RU" }));
    expect(await first.json()).toEqual({ ok: true, terms: [], cached: false });
    await POST(req({ q: "где мой заказ", lang: "RU" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("503s with no key, and never reaches the model", async () => {
    delete process.env.OPENAI_API_KEY;
    noCalls();
    const { POST } = await load();
    const res = await POST(req({ q: "cheveux gras" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, enabled: false, terms: [] });
  });

  it("403s a cross-origin caller before spending anything", async () => {
    noCalls();
    const { POST } = await load();
    const res = await POST(req({ q: "cheveux gras" }, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("allows the shop's own origins and any same-host deployment", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeCompletion({ terms: ["oily"] })));
    const { POST } = await load();
    for (const origin of ["https://rempireshop.com", "https://www.rempireshop.com", "https://rempireshop.diipsolutions.eu"]) {
      expect((await POST(req({ q: "cheveux gras " + origin }, { origin }))).status, origin).toBe(200);
    }
    // a preview deployment: the Origin is the host this very request arrived on
    const preview = await POST(req({ q: "preview" }, { origin: "https://rmp-git-x.vercel.app", host: "rmp-git-x.vercel.app" }));
    expect(preview.status).toBe(200);
  });

  it("400s a body that is not a question, and never reaches the model", async () => {
    noCalls();
    const { POST } = await load();
    for (const body of [{}, { q: "" }, { q: "a" }, { q: 5 }, { q: null }, { q: "12345" }, [], null]) {
      const res = await POST(req(body));
      expect([400], JSON.stringify(body)).toContain(res.status);
      expect(await res.json()).toMatchObject({ ok: false, terms: [] });
    }
    const broken = await POST(req(null, { raw: "{not json" }));
    expect(broken.status).toBe(400);
  });

  it("rate-limits per IP, 12 a minute", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeCompletion({ terms: ["oily"] })));
    const { POST } = await load();
    let limited = 0;
    for (let i = 0; i < 16; i++) {
      const res = await POST(req({ q: `phrase number ${i}` }));
      if (res.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it("502s — never 500s — when the model is unhappy or unreachable", async () => {
    const { POST } = await load();
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    expect((await POST(req({ q: "cheveux gras" }))).status).toBe(502);
    vi.stubGlobal("fetch", async () => { throw new Error("network down"); });
    expect((await POST(req({ q: "cheveux gras 2" }))).status).toBe(502);
  });

  it("reads a fenced or a cut answer, and remembers nothing it could not read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeCompletion('```json\n{"terms":["oily","sebum"]}\n```')));
    const { POST } = await load();
    expect(await (await POST(req({ q: "cheveux gras" }))).json())
      .toMatchObject({ terms: ["oily", "sebum"] });

    vi.stubGlobal("fetch", vi.fn(async () => fakeCompletion("I am afraid I cannot help with that.")));
    expect(await (await POST(req({ q: "quelque chose" }))).json()).toMatchObject({ ok: true, terms: [] });
  });

  it("says whether it is switched on at all", async () => {
    const { GET } = await load();
    expect(await (await GET()).json()).toMatchObject({ ok: true, enabled: true });
    delete process.env.OPENAI_API_KEY;
    expect(await (await GET()).json()).toMatchObject({ enabled: false });
  });

  it("sends one short, cold, JSON-only request", async () => {
    const fetchMock = vi.fn(async () => fakeCompletion({ terms: ["oily"] }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await load();
    await POST(req({ q: "cheveux gras", lang: "ET" }));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test-dummy");
    const sent = JSON.parse(String(init.body));
    expect(sent.temperature).toBe(0);
    expect(sent.response_format).toEqual({ type: "json_object" });
    expect(sent.max_tokens).toBeLessThanOrEqual(200);
    expect(sent.messages).toHaveLength(2);
    expect(JSON.stringify(sent)).not.toContain("sk-test-dummy"); // the key travels in the header only
  });
});

/* ---------------------------------------------------------------------------
   The storefront's half of the same conversation — askSearchAI() and the
   search event that waits for it, sliced out of public/shop2/app.js and run
   against stubs. The 700 ms debounce is left as it is and fired immediately
   here: what is under test is what happens after it, not when.
--------------------------------------------------------------------------- */
type Shop = {
  scheduleSearchTrack: () => void;
  /** What app.js runs on `pagehide` and on the page going out of sight. */
  flushSearchTrack: () => void;
  setQuery: (q: string) => void;
  tracked: () => Array<{ type: string; extra: Record<string, unknown> }>;
  renders: () => number;
  terms: () => Record<string, string[]>;
  /** With `held` timers: runs every timer still waiting (the 700 ms pause ends). */
  fireTimers: () => void;
};

function shop(fetchImpl: unknown, timers: "now" | "held" = "now"): Shop {
  /* `held`: the pause in typing is a real wait that the test ends by hand —
     how a page that is left DURING the pause is put under test. */
  const waiting = new Map<number, () => void>();
  let nextTimer = 1;
  const clock =
    timers === "now"
      ? { setTimeout: (fn: () => void) => fn(), clearTimeout() {} }
      : {
          setTimeout: (fn: () => void) => { waiting.set(nextTimer, fn); return nextTimer++; },
          clearTimeout: (id: number) => { waiting.delete(id); },
        };
  const ctx = vm.createContext({ ...clock, fetch: fetchImpl, Promise });
  (ctx as { fireTimers?: () => void }).fireTimers = () => {
    const due = [...waiting.values()];
    waiting.clear();
    for (const fn of due) fn();
  };
  vm.runInContext(
    `
    ${sliceVar("SRCH_WIDEN")}
    var AI_TERMS = {}, AI_SEARCH_OFF = false, aiSearchAsking = null, searchTrackTimer = null, searchOwed = "";
    var TRACKED = [], RENDERS = 0;
    var S = { query: "", lang: "RU", screen: "search" };
    function track(type, extra) { TRACKED.push({ type: type, extra: extra }); }
    function render() { RENDERS++; }
    /* Pass 1–3 find nothing for this phrase; the model's terms find seven. */
    function searchResults() {
      var t = aiTermsFor(S.query);
      return new Array(t.length ? 7 : 0);
    }
    ${slice("srchNorm")}
    ${slice("aiTermsFor")}
    ${slice("scheduleSearchTrack")}
    ${slice("trackSearch")}
    ${slice("askSearchAI")}
    ${slice("flushSearchTrack")}
    this.scheduleSearchTrack = scheduleSearchTrack;
    this.flushSearchTrack = flushSearchTrack;
    this.AI_TERMS = AI_TERMS;
    this.setQuery = function (q) { S.query = q; };
    this.tracked = function () { return TRACKED; };
    this.renders = function () { return RENDERS; };
    this.terms = function () { return AI_TERMS; };
  `,
    ctx,
  );
  return ctx as unknown as Shop;
}

const answer = (terms: string[], status = 200) =>
  vi.fn(async () => ({ ok: status === 200, status, json: async () => ({ ok: status === 200, terms }) }));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the storefront asking, and the search event that waits for the answer", () => {
  it("asks, re-renders, and files the count the shopper really saw", async () => {
    const f = answer(["oily", "sebum"]);
    const s = shop(f);
    s.setQuery("cheveux gras");
    s.scheduleSearchTrack();
    await flush();
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    // the trailing slash matters: without it `trailingSlash: true` 308s the POST
    expect(url).toBe("/api/search/");
    expect(JSON.parse(String(init.body))).toEqual({ q: "cheveux gras", lang: "RU" });
    expect(s.renders()).toBe(1);
    // value = 7, and the marker that says the model is what found them
    expect(s.tracked()).toEqual([{ type: "search", extra: { path: "cheveux gras", value: 7, productId: "ai" } }]);
  });

  it("asks once per phrase, however many times the box is retyped", async () => {
    const f = answer(["oily", "sebum"]);
    const s = shop(f);
    for (const q of ["cheveux gras", "Cheveux  Gras", "cheveux gras"]) {
      s.setQuery(q);
      s.scheduleSearchTrack();
      await flush();
    }
    expect(f).toHaveBeenCalledTimes(1);
    expect(s.tracked()).toHaveLength(3);
  });

  it("stops asking for the session when the shop has no key (503)", async () => {
    const f = answer([], 503);
    const s = shop(f);
    for (const q of ["cheveux gras", "capelli grassi", "fettiges haar"]) {
      s.setQuery(q);
      s.scheduleSearchTrack();
      await flush();
    }
    expect(f).toHaveBeenCalledTimes(1);
    expect(s.renders()).toBe(0);
    // still one honest search row per query, with the count the shopper saw
    expect(s.tracked()).toHaveLength(3);
    expect(s.tracked()[0].extra).toEqual({ path: "cheveux gras", value: 0 });
  });

  it("never asks at all when the shop's own words already answered", async () => {
    const f = answer(["oily"]);
    const s = shop(f);
    // seven results before the model is consulted: searchResults() sees terms
    (s as unknown as { AI_TERMS: Record<string, string[]> }).AI_TERMS[" davines "] = ["already"];
    s.setQuery("davines");
    s.scheduleSearchTrack();
    await flush();
    expect(f).not.toHaveBeenCalled();
    expect(s.tracked()).toEqual([{ type: "search", extra: { path: "davines", value: 7 } }]);
  });

  it("keeps the page when the network, the rate limit or the model says no", async () => {
    for (const impl of [
      answer([], 429),
      answer([], 502),
      vi.fn(async () => { throw new Error("offline"); }),
      vi.fn(() => { throw new Error("blocked before the request"); }),
    ]) {
      const s = shop(impl);
      s.setQuery("cheveux gras");
      s.scheduleSearchTrack();
      await flush();
      expect(s.renders()).toBe(0);
      expect(s.tracked()[0].extra).toEqual({ path: "cheveux gras", value: 0 });
      // that phrase is remembered as «nothing to add», so no retry loop
      s.scheduleSearchTrack();
      await flush();
      expect((impl as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    }
  });

  it("files nothing when the shopper typed on while the model was thinking", async () => {
    let release: (v: unknown) => void = () => {};
    const f = vi.fn(() => new Promise((r) => { release = r; }));
    const s = shop(f);
    s.setQuery("cheveux gras");
    s.scheduleSearchTrack();
    await flush();
    s.setQuery("cheveux gras et pellicules");    // still typing
    release({ ok: true, status: 200, json: async () => ({ ok: true, terms: ["oily"] }) });
    await flush();
    expect(s.tracked()).toHaveLength(0);
  });

  it("does nothing at all on a browser with no fetch", async () => {
    const s = shop(undefined);
    s.setQuery("cheveux gras");
    s.scheduleSearchTrack();
    await flush();
    expect(s.tracked()[0].extra).toEqual({ path: "cheveux gras", value: 0 });
  });
});

/* Dim, 26.09.2026, /test «stats-search»: «Fridge is not in the list in
   analytics.» The row waits for the pause in typing and then for the model,
   and a page left in that window — another tab, another app, straight to the
   panel — took the row with it. What the page does as it goes. */
describe("the search row, when the shopper leaves before it was filed", () => {
  it("files a phrase left during the pause in typing, once", async () => {
    const f = answer([]);
    const s = shop(f, "held");
    s.setQuery("fridge");
    s.scheduleSearchTrack();
    expect(s.tracked()).toHaveLength(0); // the pause is not over yet
    s.flushSearchTrack(); // pagehide / hidden
    expect(s.tracked()).toEqual([{ type: "search", extra: { path: "fridge", value: 0 } }]);
    // the pause cannot end any more — the timer went with the page
    s.fireTimers();
    await flush();
    expect(s.tracked()).toHaveLength(1);
    expect(f).not.toHaveBeenCalled();
  });

  it("files a phrase left while the model was thinking, and the late answer adds no second row", async () => {
    let release: (v: unknown) => void = () => {};
    const f = vi.fn(() => new Promise((r) => { release = r; }));
    const s = shop(f, "held");
    s.setQuery("fridge");
    s.scheduleSearchTrack();
    s.fireTimers();
    await flush();
    expect(f).toHaveBeenCalledTimes(1); // the model is being asked
    s.flushSearchTrack();
    expect(s.tracked()).toEqual([{ type: "search", extra: { path: "fridge", value: 0 } }]);
    release({ ok: true, status: 200, json: async () => ({ ok: true, terms: [] }) });
    await flush();
    expect(s.tracked()).toHaveLength(1);
  });

  it("sends nothing when nothing is owed — before any search, and after one was filed", async () => {
    const s = shop(answer([]), "held");
    s.flushSearchTrack();
    expect(s.tracked()).toHaveLength(0);
    s.setQuery("fridge");
    s.scheduleSearchTrack();
    s.fireTimers();
    await flush();
    expect(s.tracked()).toHaveLength(1); // filed the ordinary way
    s.flushSearchTrack();
    s.flushSearchTrack();
    expect(s.tracked()).toHaveLength(1);
  });
});
