/**
 * src/middleware.ts runs for fewer requests since 03.11.2026 (Vercel's CPU
 * allowance) — src/lib/middleware-matcher.ts says which and why. What must
 * hold, and what this file proves against the real matcher as Next compiles
 * it:
 *
 *  1. src/middleware.ts spells exactly the list the module works out, and no
 *     entry is over Next's 4,096 characters;
 *  2. NOTHING the middleware acts on is left out: every address of Shopify's
 *     sitemap and of the redirect map, every page of the shop in every
 *     language, and a dozen misspellings of each, under every cookie and
 *     Accept-Language the language step reads — wherever the middleware
 *     would redirect, 404 a hidden product or look the product up, the
 *     matcher sends the request to it;
 *  3. and the point of it: the canonical pages, opened by a browser that
 *     wants the language they are in, no longer run it.
 *
 * "Acts" is the middleware's own decision, replayed from the same functions
 * it calls (legacyTarget, parseShopPath, wantedLang's rules).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info";
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher";
import { matchHas } from "next/dist/shared/lib/router/utils/prepare-destination";
import { constructRequest } from "next/dist/experimental/testing/server/utils";
import catalogueMin from "@/data/catalogue.min.json";
import { config } from "@/middleware";
import { isCartPermalink } from "@/lib/cart-permalink";
import { legacyTarget, slugify } from "@/lib/legacy-redirects";
import { middlewareMatcher, slashRedirects } from "@/lib/middleware-matcher";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import nextConfig from "../next.config";
import {
  CAT_HANDLES,
  INFO_PATHS,
  LANG_COOKIE,
  SUB_HANDLES,
  isOwnerRest,
  langFromAcceptLanguage,
  parseShopPath,
  publicPath,
} from "@/lib/shop-paths.mjs";

const ROOT = path.join(__dirname, "..");

type Ask = { name: string; cookie?: string; acceptLanguage?: string };
const ASKS: Ask[] = [
  { name: "a crawler (nothing)" },
  { name: "English browser", acceptLanguage: "en-US,en;q=0.9" },
  { name: "German browser", acceptLanguage: "de-DE,de;q=0.9" },
  { name: "Russian browser", acceptLanguage: "ru-RU,ru;q=0.9,en-US;q=0.8" },
  { name: "Estonian browser", acceptLanguage: "et-EE,et;q=0.9" },
  { name: "English first, Russian second", acceptLanguage: "en-GB,en;q=0.9,ru;q=0.8" },
  { name: "Russian at q=0", acceptLanguage: "ru;q=0, en" },
  { name: "upper-case tag", acceptLanguage: "RU" },
  { name: "saved ru", cookie: "ru" },
  { name: "saved et", cookie: "et" },
  { name: "saved en", cookie: "en" },
  { name: "saved en, Russian browser", cookie: "en", acceptLanguage: "ru-RU,ru" },
  { name: "saved RU (case)", cookie: "RU" },
  { name: "saved nonsense, Estonian browser", cookie: "fi", acceptLanguage: "et" },
  { name: "saved nonsense, English browser", cookie: "fi", acceptLanguage: "en" },
  { name: "saved empty, Russian browser", cookie: "", acceptLanguage: "ru" },
];

/** wantedLang() of src/middleware.ts, from the same two inputs. */
function wantedLang(ask: Ask): "RU" | "ET" | null {
  const saved = (ask.cookie || "").toLowerCase();
  if (saved === "ru") return "RU";
  if (saved === "et") return "ET";
  if (saved === "en") return null;
  const asked = langFromAcceptLanguage(ask.acceptLanguage);
  return asked === "RU" || asked === "ET" ? asked : null;
}

/** Would src/middleware.ts do anything but let this request through untouched? */
function acts(address: string, ask: Ask): boolean {
  const [pathname, query] = address.split("?");
  const search = query ? "?" + query : "";
  if (isCartPermalink(pathname)) return false;
  if (legacyTarget(pathname, search)) return true;
  const route = parseShopPath(pathname);
  if (!route) return false;
  const storefront = !isOwnerRest(route.rest);
  if (storefront && !route.prefixed && wantedLang(ask)) return true;
  // a catalogue product: looked up against the hidden list on every view
  return /^\/p\/[^/]+\/$/.test(route.rest);
}

/** The matcher as it was before 03.11.2026 — every page address ran it. */
const OLD_MATCHER = [
  "/((?!api(?:/|$)|_next/|.*\\.[A-Za-z0-9]+$).*)",
  "/sitemap_:name*",
  "/agents.md",
  "/(.*\\.atom)",
];

/**
 * A matcher as Next compiles it. `local` is `next start` (and e2e): Next's own
 * regex, case-sensitive. `vercel` is the CDN's router, which matches route
 * sources case-insensitively — production answers /AGENTS.MD with the
 * middleware's 301 although the entry says /agents.md.
 */
type Compiled = { regexp: string; has?: never[]; missing?: never[] };
/* exported by Next's build at run time, though not by its type declarations */
const { getMiddlewareMatchers } = pageStaticInfo as unknown as {
  getMiddlewareMatchers: (matcher: unknown, nextConfig: unknown) => Compiled[];
};
function compile(matcher: unknown, mode: "local" | "vercel") {
  const matchers = getMiddlewareMatchers(matcher, {});
  if (mode === "local") return getMiddlewareRouteMatcher(matchers as never);
  /* getMiddlewareRouteMatcher() itself, with the route's regex case-folded */
  const folded = matchers.map((m: Compiled) => ({ ...m, re: new RegExp(m.regexp, "i") }));
  return (pathname: string, req: never, query: Record<string, string>) =>
    folded.some((m) => m.re.test(pathname) && (!(m.has || m.missing) || !!matchHas(req, query, m.has, m.missing)));
}
const MATCH = {
  local: compile(config.matcher, "local"),
  vercel: compile(config.matcher, "vercel"),
  oldLocal: compile(OLD_MATCHER, "local"),
  oldVercel: compile(OLD_MATCHER, "vercel"),
};

function request(ask: Ask) {
  const headers: Record<string, string> = {};
  if (ask.acceptLanguage !== undefined) headers["accept-language"] = ask.acceptLanguage;
  const cookies = ask.cookie !== undefined ? { [LANG_COOKIE]: ask.cookie } : undefined;
  return constructRequest({ url: "https://rempireshop.com/", headers, cookies });
}
const REQUESTS = new Map(ASKS.map((a) => [a, request(a)]));
/** Does the middleware run? Next hands its matcher the path without a trailing slash. */
function matches(address: string, ask: Ask, which: keyof typeof MATCH = "local"): boolean {
  const [pathname, query] = address.split("?");
  const seen = pathname !== "/" && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return MATCH[which](seen, REQUESTS.get(ask) as never, Object.fromEntries(new URLSearchParams(query || "")));
}

/** Where next.config.ts's slash redirects send an address (path and query), or null. */
const SLASH = slashRedirects().map((r) => ({ ...r, match: getPathMatch(r.source, { strict: true, removeUnnamedParams: true }) }));
function slashTarget(address: string): string | null {
  const [pathname, query] = address.split("?");
  for (const r of SLASH) {
    const params = r.match(pathname);
    if (params) return "/" + String((params as { page: string }).page) + (query ? "?" + query : "");
  }
  return null;
}

/** Is a request the middleware acts on still answered the way it answered it? */
function covered(address: string, ask: Ask, which: "local" | "vercel"): boolean {
  /* a config redirect answers before the middleware runs — so where one
     matches, it must send the address exactly where the middleware did */
  const slash = slashTarget(address);
  if (slash !== null) {
    const [pathname, query] = address.split("?");
    return legacyTarget(pathname, query ? "?" + query : "")?.path === slash;
  }
  return matches(address, ask, which);
}

/* ---------- the addresses ------------------------------------------------- */

function sitemapAddresses(): string[] {
  const urls = readFileSync(path.join(ROOT, "tools", "harvest", "old-urls.txt"), "utf8").trim().split(/\r?\n/);
  const map = readFileSync(path.join(ROOT, "docs", "redirect-map.csv"), "utf8").trim().split(/\r?\n/).slice(1)
    .map((line) => line.split('","')[0].replace(/^"/, ""));
  return [...urls, ...map].map((u) => u.replace(/^https:\/\/rempireshop\.com/, "") || "/");
}

function shopPages(): string[] {
  const ids = (catalogueMin as Array<{ id: string }>).map((p) => p.id);
  const brands = [...new Set((catalogueMin as Array<{ b: string }>).map((p) => slugify(p.b)))];
  const rests = [
    "/",
    ...Object.keys(CAT_HANDLES).map((c) => `/c/${c}/`),
    ...Object.keys(SUB_HANDLES).map((k) => `/c/${k}/`),
    ...brands.map((b) => `/b/${b}/`),
    "/b/some-brand-renat-adds-tomorrow/",
    "/brands/", "/sets/", "/set/beard-start/", "/gift/",
    ...Object.keys(INFO_PATHS).map((s) => `/info/${s}/`),
    "/blog/", "/blog/kak-uhazhivat-za-borodoy-zimoy/", "/blog/the-ultimate-guide-on-how-to-moisturize-your-skin-for-a-healthy-glow/",
    "/search/", "/account/", "/checkout/", "/cart/", "/done/",
    ...ids.slice(0, 80).map((id) => `/p/${id}/`),
  ];
  const out: string[] = [];
  for (const lang of ["EN", "RU", "ET"]) for (const rest of rests) out.push(publicPath(lang, rest));
  out.push("/admin", "/admin/scan", "/handover");
  return out;
}

/** The spellings an address arrives in that are not the page. */
function misspellings(address: string): string[] {
  const [p, q] = address.split("?");
  const out = [address, p + (p === "/" ? "" : "/"), p + "?variant=44123&utm_source=google", p.toUpperCase(), p + "?q=x"];
  if (p !== "/") out.push("/en-lv" + p, "/en" + p, "/RU" + p, "/shop2" + p, p.replace(/-/g, "_"), p + "%C2%AE", "/" + p.slice(1).replace("/", "//"));
  if (q) out.push(p);
  return out;
}

const ALL = [...new Set([...sitemapAddresses(), ...shopPages()].flatMap(misspellings))];

/* ---------- the proofs ---------------------------------------------------- */

describe("middleware matcher", () => {
  it("src/middleware.ts spells exactly the list src/lib/middleware-matcher.ts works out", () => {
    expect(config.matcher).toEqual(middlewareMatcher());
    for (const m of config.matcher) {
      const source = typeof m === "string" ? m : m.source;
      expect(source.length, source.slice(0, 60)).toBeLessThanOrEqual(4096);
    }
  });

  it("next.config.ts redirects exactly the slashed canonical pages it works out, first thing", async () => {
    const file = JSON.parse(readFileSync(path.join(ROOT, "src", "data", "slash-redirects.json"), "utf8"));
    expect(file).toEqual(slashRedirects());
    const redirects = await nextConfig.redirects!();
    for (const r of slashRedirects()) {
      expect(redirects, r.source.slice(0, 40)).toContainEqual(r);
      expect(r.source.length).toBeLessThanOrEqual(3600);
    }
  });

  it("a slashed canonical page is ONE 301 to the page; a slashed product or a moving address is the middleware's", () => {
    for (const [from, to] of [
      ["/ru/", "/ru"], ["/et/", "/et"], ["/collections/hair-care/", "/collections/hair-care"],
      ["/ru/collections/vse-tovary/?utm_source=x", "/ru/collections/vse-tovary?utm_source=x"],
      ["/collections/kevin-murphy/", "/collections/kevin-murphy"], ["/blogs/news/", "/blogs/news"],
      ["/et/policies/refund-policy/", "/et/policies/refund-policy"], ["/admin/", "/admin"], ["/admin/scan/", "/admin/scan"],
    ]) {
      expect(slashTarget(from), from).toBe(to);
      expect(legacyTarget(from.split("?")[0], from.includes("?") ? "?" + from.split("?")[1] : "")?.path, from).toBe(to);
    }
    for (const from of ["/", "/products/x/", "/collections/all/", "/ru/collections/hair-care/", "/shop2/c/hair/", "/no-such-page/"]) {
      expect(slashTarget(from), from).toBeNull();
    }
  });

  /* What the old matcher already let past the middleware (a dotted address it
     never looked at, `/en-lv/agents.md`) is not this change's to answer for;
     everything else the middleware acts on must still reach it. */
  function missed(which: "local" | "vercel", allowed: (address: string) => boolean = () => false): string[] {
    const old = which === "local" ? "oldLocal" : "oldVercel";
    const out: string[] = [];
    for (const address of ALL) {
      for (const ask of ASKS) {
        if (acts(address, ask) && !covered(address, ask, which) && matches(address, ask, old) && !allowed(address)) {
          out.push(`${address}  [${ask.name}]`);
        }
      }
    }
    return out;
  }

  /* The one thing given up, on both: a canonical page asked for in capitals.
     Vercel's router ignores case, so /ET/collections/juuksehooldus looks like
     the page itself and no longer reaches the middleware's 301 to the
     lower-case address — it gets the page, whose canonical names that
     address; and Next's config redirects ignore case everywhere, so
     /RU/collections/vse-tovary/ loses its slash in one hop and its capitals in
     the next. Shopify's sitemap has no such address (its only capitals are the
     %C2%AE escapes of three products, which always run the middleware).
     Nothing else may be lost. */
  const capitals = (address: string) => {
    const p = address.split("?")[0];
    return p !== p.toLowerCase() && !matches(p.toLowerCase(), ASKS[0], "vercel");
  };

  it(`answers every request the middleware acts on as before, as next start matches — ${ALL.length} addresses × ${ASKS.length} visitors`, () => {
    const out = missed("local", capitals);
    expect(out.slice(0, 20), `${out.length} requests the middleware acts on would be answered differently`).toEqual([]);
  });

  it("…and as Vercel matches, case-folded", () => {
    const out = missed("vercel", capitals);
    expect(out.slice(0, 20), `${out.length} requests the middleware acts on would be answered differently on Vercel`).toEqual([]);
  });

  it("leaves the canonical pages alone for a visitor who wants their language", () => {
    const quiet: Array<[string, Ask]> = [
      ["/", ASKS[0]], ["/", ASKS[1]], ["/", ASKS[2]], ["/", ASKS[10]], ["/", ASKS[11]],
      ["/collections/all-products", ASKS[1]], ["/collections/hair-care", ASKS[0]],
      ["/collections/kevin-murphy", ASKS[1]], ["/collections/some-brand-renat-adds-tomorrow", ASKS[1]],
      ["/collections/beard-oil", ASKS[1]], ["/collections/cbd-daily-haircare", ASKS[1]],
      ["/ru", ASKS[3]], ["/ru/collections/vse-tovary", ASKS[3]], ["/ru/collections/uhod-za-volosami", ASKS[8]],
      ["/et", ASKS[4]], ["/et/collections/juuksehooldus", ASKS[4]], ["/et/collections/kevin-murphy", ASKS[9]],
      ["/blogs/news", ASKS[1]], ["/ru/blogs/news/kak-uhazhivat-za-borodoy-zimoy", ASKS[3]],
      ["/pages/contact", ASKS[1]], ["/ru/policies/refund-policy", ASKS[3]], ["/et/policies/shipping-policy", ASKS[4]],
      ["/admin", ASKS[3]], ["/handover", ASKS[3]], ["/admin/scan", ASKS[8]],
    ];
    for (const [address, ask] of quiet) {
      expect(acts(address, ask), `${address} [${ask.name}] — the middleware would act`).toBe(false);
      expect(matches(address, ask), `${address} [${ask.name}] still runs the middleware`).toBe(false);
    }
  });

  it("still runs it where it has a job", () => {
    const busy: Array<[string, Ask]> = [
      ["/", ASKS[3]], ["/", ASKS[4]], ["/", ASKS[8]], ["/collections/hair-care", ASKS[9]],
      ["/products/" + (catalogueMin as Array<{ id: string }>)[0].id, ASKS[0]],
      ["/ru/products/" + (catalogueMin as Array<{ id: string }>)[0].id, ASKS[3]],
      ["/ru/collections/hair-care", ASKS[3]], ["/collections/all", ASKS[1]], ["/collections/all/", ASKS[1]],
      ["/collections/cbd-daily", ASKS[1]], ["/shop2/", ASKS[0]], ["/en-lv/products/x", ASKS[0]],
      ["/blogs/news/the-ultimate-guide-on-how-to-moisturize-your-skin-for-a-healthy-glow", ASKS[0]],
      ["/sitemap_products_1.xml", ASKS[0]], ["/sitemap_products_1.xml?from=1&to=2", ASKS[0]],
      ["/agents.md", ASKS[0]], ["/collections/hair-care.atom", ASKS[0]],
      ["/no-such-page", ASKS[0]],
    ];
    for (const [address, ask] of busy) expect(matches(address, ask), `${address} [${ask.name}]`).toBe(true);
  });

  it("never runs for the API, Next's files or an asset", () => {
    for (const address of ["/api/overrides/", "/api/payments/notify/", "/_next/static/chunks/a.js", "/shop2/app.js", "/robots.txt", "/feed/google-en.xml"]) {
      for (const ask of ASKS) expect(matches(address, ask), `${address} [${ask.name}]`).toBe(false);
    }
  });
});
