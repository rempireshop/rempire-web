/**
 * The visit beacon's ad source (public/shop2/app.js, refHost()): a click on
 * one of the shop's own ads is filed under its ad network, not under the
 * referrer it shares with organic traffic — google.com for Google Ads,
 * chatgpt.com for the ChatGPT ads campaign of 05.11.2026. The test runs the
 * real lines from app.js (from `var AD_KEY` to the consent section) in a
 * sandbox with a fake address, referrer and sessionStorage.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(path.join(process.cwd(), "public", "shop2", "app.js"), "utf8").replace(/\r\n?/g, "\n");
const start = SRC.indexOf("  var AD_KEY = ");
const end = SRC.indexOf("/* ---------- consent", start);
const SNIPPET = SRC.slice(start, end);

function tab(store: Map<string, string> = new Map()) {
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    store,
  };
}

/** One page load: the landing query, the referrer, and the tab's storage. */
function land(search: string, referrer = "", storage = tab()) {
  const ctx = {
    location: { search, hostname: "rempireshop.com" },
    document: { referrer },
    sessionStorage: storage,
    URL,
  };
  vm.runInNewContext(SNIPPET + "\nthis.refHost = refHost;", ctx);
  return { refHost: (ctx as unknown as { refHost: () => string }).refHost, storage };
}

describe("refHost() — the ad source in the visit beacon", () => {
  it("finds the snippet in app.js", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(SNIPPET).toContain("function refHost()");
  });

  it("files a ChatGPT ads click as ads.openai.com, not chatgpt.com", () => {
    const { refHost } = land("?utm_source=chatgpt-ads&utm_medium=cpc&utm_campaign=chatgpt-eu", "https://chatgpt.com/");
    expect(refHost()).toBe("ads.openai.com");
  });

  it("keeps an ordinary ChatGPT referral as chatgpt.com", () => {
    expect(land("", "https://chatgpt.com/").refHost()).toBe("chatgpt.com");
    expect(land("?utm_source=chatgpt.com", "https://chatgpt.com/").refHost()).toBe("chatgpt.com");
  });

  it("still files a Google Ads click as ads.google.com", () => {
    expect(land("?gclid=abc", "https://www.google.com/").refHost()).toBe("ads.google.com");
    expect(land("?utm_source=google-ads&utm_medium=cpc", "https://www.google.com/").refHost()).toBe("ads.google.com");
    expect(land("", "https://www.google.com/").refHost()).toBe("www.google.com");
  });

  it("remembers the ad for the rest of the tab, after the address has lost the tag", () => {
    const first = land("?utm_source=chatgpt-ads", "https://chatgpt.com/");
    expect(first.refHost()).toBe("ads.openai.com");
    expect(land("", "https://chatgpt.com/", first.storage).refHost()).toBe("ads.openai.com");
  });

  it("reads a tab flagged before 05.11 (\"1\") as Google, and ignores anything else stored", () => {
    expect(land("", "", tab(new Map([["rmp_ad", "1"]]))).refHost()).toBe("ads.google.com");
    expect(land("", "", tab(new Map([["rmp_ad", "evil.example"]]))).refHost()).toBe("");
  });

  it("writes nothing to the tab until refHost() is asked (track() asks only after consent)", () => {
    const { storage } = land("?utm_source=chatgpt-ads");
    expect(storage.store.size).toBe(0);
  });

  it("does not match a lookalike source", () => {
    expect(land("?utm_source=chatgpt-ads-old").refHost()).toBe("");
  });
});
