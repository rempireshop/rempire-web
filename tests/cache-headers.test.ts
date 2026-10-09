/**
 * The cache rule for the shop's tokened assets — next.config.ts, perf 09.10.2026.
 *
 * A script or stylesheet requested with the shared ?v= token (twelve hex
 * characters of a hash of the files themselves, tools/lib/asset-token.mjs)
 * can never answer other bytes at that address, so it is immutable for a
 * year; everything else — a picture on its own ?v=5, a file without a token,
 * every page, the API — keeps the host's revalidating default. Read through
 * Next's own matching rules: the path pattern, then the `has` condition.
 */
import { describe, expect, it } from "vitest";

describe("the cache rule for tokened assets", () => {
  type Rule = { source: string; has?: { type: string; key: string; value?: string }[]; headers: { key: string; value: string }[] };
  async function rules(): Promise<Rule[]> {
    const { default: nextConfig } = await import("../next.config");
    return (await nextConfig.headers!()) as Rule[];
  }
  /** Next's matcher for one rule: the path pattern, then the `has` conditions. */
  function applies(rule: Rule, url: string): boolean {
    const [pathname, query = ""] = url.split("?");
    // a parameter is `/:name`, with an optional (pattern) or *
    const src = "^" + rule.source.replace(/\/:[A-Za-z]+(\((?:[^()]|\([^()]*\))*\))?(\*)?/g,
      (_m, pattern: string | undefined, star: string | undefined) => "/" + (pattern ?? (star ? ".*" : "[^/]+"))) + "$";
    if (!new RegExp(src).test(pathname)) return false;
    const params = new URLSearchParams(query);
    return (rule.has || []).every((h) => h.type === "query" && params.has(h.key) &&
      (!h.value || new RegExp(h.value).test(params.get(h.key) ?? "")));
  }
  async function cacheControl(url: string): Promise<string> {
    let out = "";
    for (const r of await rules()) {
      const h = r.headers.find((x) => x.key === "Cache-Control");
      if (h && applies(r, url)) out = h.value;
    }
    return out;
  }

  it("keeps a script or a stylesheet on the shared token for a year", async () => {
    for (const url of ["/shop2/app.min.js?v=0123456789ab", "/shop2/styles.css?v=dc5a59980a6f", "/shop/catalogue2.js?v=dc5a59980a6f",
      "/shop/content.ru.js?v=dc5a59980a6f", "/shop2/admin.css?v=dc5a59980a6f"]) {
      expect(await cacheControl(url), url).toBe("public, max-age=31536000, immutable");
    }
  });

  it("leaves everything else to the host's revalidating default", async () => {
    for (const url of ["/shop2/app.min.js", "/shop2/app.min.js?v=c2", "/shop2/app.min.js?v=DC5A59980A6F", "/shop2/app.min.js?v=dc5a59980a6f0",
      "/shop/img/anua-0.webp?v=5", "/shop2/icons/favicon.svg?v=dc5a59980a6f", "/products/x?v=dc5a59980a6f", "/?v=dc5a59980a6f",
      "/api/overrides/?v=dc5a59980a6f", "/shop2/og/x.js/y?v=dc5a59980a6f"]) {
      expect(await cacheControl(url), url).toBe("");
    }
  });
});
