/**
 * Smoke tests against a **deployed** shop — staging by default, production
 * when you say so. Run with `npm run smoke`; the config is
 * playwright.smoke.config.ts and the prose is docs/testing.md § «Smoke tests
 * against a deployed shop».
 *
 * ======================================================================
 *  READ-ONLY. NO REQUEST IN THIS FILE MAY CHANGE ANYTHING ON THE SHOP.
 * ======================================================================
 *
 * There is a real shop on the other end of this base URL, with Renat's real
 * catalogue, Renat's real customers and a real payment provider behind it. So:
 * no orders, no letters, no admin writes, no sign-in, no PUT, no PATCH, no
 * DELETE, nothing that costs a cent or leaves a row. Everything here is a GET
 * of a URL Googlebot would be welcome to fetch — with ONE exception, which is
 * also the only POST in the file: an EMPTY one to the payment webhook
 * (`postEmpty()` below), which the route refuses with a 400 before it has
 * opened a database, and which is here because «does Montonio's address answer
 * by itself, rather than with a redirect that loses the POST» is a question
 * only a POST can ask. The only state this suite creates anywhere is a
 * Playwright trace on the runner's own disk — and, for that one POST, a log
 * line on the shop's.
 *
 * The rule is enforced, not merely written down. `forbidWrites()` below hangs a
 * route handler on every page that answers any non-GET the storefront attempts
 * with a synthetic 200 — the request never reaches the shop — and records it,
 * and every test that opens a page then asserts nothing was recorded. Add a
 * write and the suite goes red on the machine you add it on, before it can
 * ever go red on Renat's database. Requests made without a browser go through
 * `get()` and `postEmpty()`, the only two doors this file opens, and neither
 * of them takes a body.
 *
 * The one thing the storefront would otherwise write is the analytics beacon:
 * `POST /api/track/` on every page view. It is not intercepted, it is not
 * fired — playwright.smoke.config.ts answers the consent banner with «Только
 * необходимое» before the first load, and `track()` in app.js returns before
 * it builds a body when analytics are declined. Declining is a better way to
 * not write than blocking is.
 *
 * ---- what this suite is for, and what it is not for ---------------------
 *
 * Every other test in this repository runs against `next dev` on localhost,
 * with a mock payment provider and an in-memory database that is thrown away
 * at the end (docs/testing.md). That covers what the *code* does. It cannot
 * cover what the *deployment* does — the real build output, the real database,
 * the CDN in front of it, the asset token, the sitemap the app serves at
 * request time, the redirects, the security headers — and on 07.09.2026 a
 * stale asset token shipped and no test anywhere had an opinion about it
 * (tools/lib/asset-token.mjs tells that story). This file is that opinion.
 *
 * So the assertions here are deliberately the ones that can only be wrong on a
 * deployment. It does not re-check what `npm run prerender:check` already
 * proves about the files (every hreflang, every JSON-LD block, every og:image's
 * pixel size — 813 pages of it, off disk, with no network), and it does not
 * re-check what the local e2e suite already drives through a browser. If an
 * assertion here would pass or fail identically against a working tree, it
 * belongs in one of those two instead.
 *
 * **Deliberately NOT covered**, and none of it by accident:
 *
 *   · **Payments.** A checkout that reaches Montonio is money, a real order
 *     row and a letter. e2e/checkout.spec.ts and e2e/payments.spec.ts drive
 *     the whole flow against PAYMENT_PROVIDER=mock, which is where a flow that
 *     spends money belongs.
 *   · **Mail.** Nothing here asks the shop to send anything to anybody.
 *     e2e/admin-mail.spec.ts reads the in-memory ring of letters `sendMail()`
 *     was asked to send, on a server with no Resend key (docs/mail.md).
 *   · **Anything behind a login.** No admin session, no customer session, no
 *     scanner. `/api/admin/me/` is asked exactly once, anonymously, and the
 *     only acceptable answer is 401 — which is a test that the door is shut,
 *     not an attempt to open it.
 *   · **`/cart`, `/checkout`, `/checkout/done`, `/account`, `/search`** (and
 *     their `/ru`, `/et` twins). Robots-disallowed, not prerendered, not in
 *     the sitemap, and meaningless without state (docs/seo.md). A crawler
 *     never sees them and neither does this file.
 *   · **Visual snapshots.** A baseline that has to be renewed whenever Renat
 *     edits a banner would be a suite nobody trusts by the third false alarm.
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { assetTokenWith, currentToken, versionedAssets } from "../tools/lib/asset-token.mjs";
import { LANG_COOKIE, LANG_PREFIX, parseShopPath, publicPath } from "../src/lib/shop-paths.mjs";
import { isProductionBase, smokeBaseUrl } from "./env.mjs";
import { SWEEP_SEED, makeRng, pickOne, sample, watchPage, type Watch } from "./sweep-shop-helpers";

/** The deployment under test, and the one fact that changes what is expected
 *  of it. Both come out of e2e/env.mjs so the hosts are written down once. */
const BASE = smokeBaseUrl();
const LIVE = isProductionBase(BASE);

/** An absolute URL on the base — how every expected canonical and `<loc>` in
 *  this file is built, so a comparison is never between a path and a URL. */
const abs = (path: string): string => new URL(path, `${BASE}/`).toString();

/* ------------------------------------------------------------------------ */
/* The two doors: GET, and one empty POST                                    */
/* ------------------------------------------------------------------------ */

/**
 * Every request this file makes without a browser, but one. It exists so the
 * read-only rule has one place to be true rather than forty call sites to be
 * trusted at, and so `maxRedirects: 0` is the rule everywhere: a page that
 * answers 200 today and a 301 tomorrow is a deployment change worth failing
 * over, and a client that quietly follows the hop would report the new page as
 * the old one.
 *
 * Asked the way a crawler asks: Playwright's request context sends no
 * Accept-Language (the config's `locale` is a browser setting) and this suite
 * gives it no cookie, so an unprefixed address is answered as the English page
 * itself — never with the 302 to its /ru or /et twin that src/middleware.ts
 * sends a browser that asked for Russian or Estonian. `headers` is for the one
 * test that asks on purpose.
 */
function get(request: APIRequestContext, url: string, opts: { headers?: Record<string, string> } = {}) {
  return request.get(url, { maxRedirects: 0, timeout: 45_000, headers: opts.headers });
}

/**
 * The one request in this file that is not a GET, and the whole of what it
 * may do: POST nothing to the payment webhook and read the status. No body —
 * the route (src/app/api/payments/notify/route.ts) cannot parse an empty one:
 * the provider's verifyNotification() throws `bad_body`, and the route answers
 * 400 before it has looked up an order or opened a database, leaving a log
 * line and one tick of an in-memory rate limiter behind. It is here for the one question only a POST can ask: does
 * Montonio's address answer by itself, rather than with a redirect that would
 * lose the payment notice? Do not give it a body, and do not point it anywhere
 * else.
 */
function postEmpty(request: APIRequestContext, url: string) {
  return request.post(url, { maxRedirects: 0, timeout: 45_000 });
}

/** The body of a GET that has to have succeeded first. `what` names the thing
 *  in the failure message, because "expected 200, got 404" on its own is a
 *  sentence you then have to go and decode. */
async function getText(request: APIRequestContext, url: string, what: string): Promise<string> {
  const res = await get(request, url);
  expect(res.status(), `${what}: GET ${url}`).toBe(200);
  return res.text();
}

/* ------------------------------------------------------------------------ */
/* The read-only guard                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Hangs a route handler on `page` that lets GET and HEAD through untouched and
 * stops everything else at the browser: the request is answered with a
 * synthetic 200 (so the storefront's own error handling is never the thing
 * under test) and its method and URL are pushed onto the returned array.
 *
 * Fulfilled rather than aborted on purpose. An aborted fetch is a failed
 * resource, and Chromium prints a console error for a failed resource — which
 * this suite treats as a fault, so blocking a write would have shown up as the
 * wrong failure, on the wrong line, about the wrong thing.
 *
 * The array is asserted empty by `visit()` below. Today it is always empty:
 * with analytics declined nothing on a storefront page writes at all, which is
 * the point — this is the tripwire for the write somebody adds in a year, not
 * a filter something currently relies on.
 */
async function forbidWrites(page: Page): Promise<string[]> {
  const attempted: string[] = [];
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.method() === "GET" || req.method() === "HEAD") return route.fallback();
    attempted.push(`${req.method()} ${req.url()}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  return attempted;
}

/* ------------------------------------------------------------------------ */
/* Reading a served page's head                                              */
/* ------------------------------------------------------------------------ */

/** The first capture of `re` in `html`, or "" — used for the head tags this
 *  file compares. A regex rather than a DOM: these are the exact bytes a
 *  crawler reads before any script runs, which is the whole question. */
const cap = (html: string, re: RegExp): string => (re.exec(html) || ["", ""])[1] || "";

const titleOf = (html: string) => cap(html, /<title>([\s\S]*?)<\/title>/i);
const langOf = (html: string) => cap(html, /<html[^>]*\slang="([^"]*)"/i);
const canonicalOf = (html: string) => cap(html, /<link[^>]+rel="canonical"[^>]+href="([^"]*)"/i);
const robotsMetaOf = (html: string) => cap(html, /<meta[^>]+name="robots"[^>]+content="([^"]*)"/i);
const ogImageOf = (html: string) => cap(html, /<meta[^>]+property="og:image"[^>]+content="([^"]*)"/i);

/** What the prerender wrote between its markers — the page's own body, before
 *  app.js has run. `PRE_MARK` in src/lib/seo-head.mjs writes exactly this
 *  shape, and comparing this block is how "its own content, not the shell" is
 *  answered below: the shell's block is the English home page (since
 *  08.10.2026 — it was the Russian one while unprefixed meant Russian). */
const prerenderBlockOf = (html: string) =>
  cap(html, /<!-- prerender:start -->([\s\S]*?)<!-- prerender:end -->/);

/** The robots meta every page must carry on this deployment. One fact, one
 *  switch — docs/seo.md, "Regenerating": the base decides the meta and
 *  robots.txt together, and the header is the third layer of the same
 *  decision. Written here once so all three tests below read it from one
 *  place, exactly as the tool that generates them does. */
const EXPECTED_ROBOTS_META = LIVE ? "index, follow, max-image-preview:large" : "noindex, nofollow";

/* ------------------------------------------------------------------------ */
/* Which pages — read off the deployment, not off this repository            */
/* ------------------------------------------------------------------------ */

/**
 * The URLs the page tests walk, discovered from the deployment's own sitemaps
 * rather than typed in here.
 *
 * A hard-coded product id would be a test that goes stale the day Renat
 * deletes a product — it would fail loudly about a URL that is *supposed* to
 * be gone, which is the most expensive kind of false alarm. Sets and blog
 * posts are worse: he creates and retires those from the panel, between
 * deployments, so a list written down in a spec file is wrong by design. The
 * sitemap is the deployment's own statement of which pages it offers a
 * crawler; walking that is both self-maintaining and a stronger claim — every
 * page checked here is a page the shop has told Google about.
 *
 * The picks are seeded with the sweep's own `SWEEP_SEED`, so two runs against
 * the same deployment walk the same pages and a failure is reproducible.
 */
type Discovered = {
  /** Every `<loc>` in the two file-backed sitemaps, absolute, on this base. */
  all: string[];
  /** One representative address per kind of page, Russian (`/ru/…`). */
  kinds: Array<{ kind: string; path: string; screen: string }>;
};

/** Every `<loc>` of a sitemap, as written. */
const locsOf = (xml: string): string[] => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

/**
 * The shop's page addresses among some sitemap URLs, each read back into its
 * language and the shop's internal route ("/p/<id>/", "/c/hair/", "/b/<brand>/",
 * "/info/shipping/", "/" …) by parseShopPath() — the same reader the
 * middleware, the catch-all and app.js use (src/lib/shop-paths.mjs). Since
 * 08.10.2026 the address of a page says much less on its face than the /shop2/
 * one did: `/ru/collections/uhod-za-volosami` and `/collections/kevin-murphy`
 * are a section and a brand, and only the table of section handles can tell
 * which is which. So a page is classified by the route it stands for, never by
 * a regex over its handle. URLs on another host, and addresses that are no
 * page shape at all, are left out.
 */
function shopPages(urls: string[]): Array<{ path: string; lang: string; rest: string }> {
  const out: Array<{ path: string; lang: string; rest: string }> = [];
  for (const u of urls) {
    if (!u.startsWith(`${BASE}/`)) continue;
    const path = new URL(u).pathname;
    const route = parseShopPath(path);
    if (route) out.push({ path, lang: String(route.lang), rest: String(route.rest) });
  }
  return out;
}

let discovery: Promise<Discovered> | null = null;

function discover(request: APIRequestContext): Promise<Discovered> {
  if (!discovery) discovery = discoverOnce(request);
  return discovery;
}

async function discoverOnce(request: APIRequestContext): Promise<Discovered> {
  const staticXml = await getText(request, abs("/sitemap-1.xml"), "the static sitemap");
  const productXml = await getText(request, abs("/sitemap-products.xml"), "the products sitemap");
  const all = [...locsOf(staticXml), ...locsOf(productXml)];

  /* Russian addresses only — the other two spellings are built from these
     below (inLang), which is also how the three-language matrix stays honest:
     the same page, the same id, three addresses. Russian rather than the
     unprefixed English because Russian is the language the shop is run in and
     the one the old /shop2/ walk used — the representatives a failure names
     read the way Renat reads his shop. */
  const pages = shopPages(all).filter((p) => p.lang === "RU");

  const rng = makeRng(SWEEP_SEED);
  const oneOf = (re: RegExp, what: string): string => {
    const found = pages.filter((p) => re.test(p.rest)).map((p) => p.path);
    expect(found.length, `the deployment's sitemaps name no Russian ${what} (route ${re})`).toBeGreaterThan(0);
    return pickOne(rng, found);
  };
  /* Sets and blog posts are the two kinds a shop may legitimately have NONE
     of: the go-live reset deletes every one (Dim, 28.09.2026), and the shop
     then has no «Наборы» and no «Блог» at all until Renat makes the first —
     the prerender writes no such pages and names none. Those kinds are
     walked when the sitemap names one, and «the empty shelf is invisible»
     test below holds the shop to the other half. */
  const maybeOneOf = (re: RegExp): string | null => {
    const found = pages.filter((p) => re.test(p.rest)).map((p) => p.path);
    return found.length ? pickOne(rng, found) : null;
  };
  const setPath = maybeOneOf(/^\/set\/[^/]+\/$/);
  const postPath = maybeOneOf(/^\/blog\/[^/]+\/$/);

  /* `screen` is what app.js writes into body[data-screen] once it has taken
     over — the same names e2e/sweep-storefront.spec.ts asserts on. The fixed
     pages are spelled by publicPath(), so «Бренды» is /ru/collections/brands
     and the gift card /ru/products/gift-card without this file having to know. */
  const ru = (rest: string) => publicPath("RU", rest);
  const kinds: Discovered["kinds"] = [
    { kind: "home", path: ru("/"), screen: "home" },
    { kind: "product", path: oneOf(/^\/p\/[^/]+\/$/, "product page"), screen: "product" },
    { kind: "category", path: oneOf(/^\/c\/[^/]+\/$/, "section page"), screen: "catalog" },
    { kind: "brand", path: oneOf(/^\/b\/[^/]+\/$/, "brand page"), screen: "catalog" },
    { kind: "brands", path: ru("/brands/"), screen: "brands" },
    ...(setPath
      ? [
          { kind: "sets", path: ru("/sets/"), screen: "bundles" },
          { kind: "set", path: setPath, screen: "bundle" },
        ]
      : []),
    { kind: "gift", path: ru("/gift/"), screen: "gift" },
    ...(postPath
      ? [
          { kind: "blog", path: ru("/blog/"), screen: "blog" },
          { kind: "blogpost", path: postPath, screen: "blogpost" },
        ]
      : []),
  ];
  /* Every policy page, not a sample: there are five of them, they are the
     pages a shopper reads before deciding to trust the shop, and «Контакты»
     going missing is not something to find out about from a customer. The
     kind is named by the route's slug (`info:privacy`), not by Shopify's
     address for it (/policies/privacy-policy). */
  for (const p of pages.filter((p) => /^\/info\/[^/]+\/$/.test(p.rest)).sort((a, b) => a.rest.localeCompare(b.rest))) {
    kinds.push({ kind: `info:${p.rest.split("/")[2]}`, path: p.path, screen: "info" });
  }
  return { all, kinds };
}

type Lang = "RU" | "ET" | "EN";

/** The three languages, and the prefix each one lives under (docs/seo.md,
 *  src/lib/shop-paths.mjs): since 08.10.2026 English is the default, has no
 *  prefix and is the x-default — Shopify's own scheme — and Russian and
 *  Estonian are /ru and /et. */
const LANGS: Array<{ lang: Lang; prefix: string; html: string }> = [
  { lang: "RU", prefix: LANG_PREFIX.RU, html: "ru" },
  { lang: "ET", prefix: LANG_PREFIX.ET, html: "et" },
  { lang: "EN", prefix: LANG_PREFIX.EN, html: "en" },
];

/**
 * A page's address in another language. Not a prefix swap: a section's handle
 * is translated (`/ru/collections/uhod-za-volosami` is
 * `/et/collections/juuksehooldus` and `/collections/hair-care`), so the address
 * is read back into the shop's internal route and spelled out again — by the
 * same two functions app.js (shopRouteOf/shopPathFor), the prerender and the
 * middleware use, so this file cannot hold a private opinion about an address.
 */
function inLang(path: string, lang: Lang): string {
  const route = parseShopPath(path);
  if (!route) throw new Error(`inLang: ${path} is not one of the shop's page addresses`);
  return publicPath(lang, route.rest);
}

/* ------------------------------------------------------------------------ */
/* Visiting a page in a browser                                              */
/* ------------------------------------------------------------------------ */

/**
 * Everything one page is watched for, installed once and cleared between
 * screens — the shape `Watch.reset()` in e2e/sweep-shop-helpers.ts already has,
 * and for the same reason: a test that walks ten pages on one `page` would
 * otherwise hang ten route handlers and ten listeners off it and carry the
 * first screen's complaints into the tenth screen's failure message.
 *
 * The console allow-list is `watchPage()` from that same file, used as it is
 * and deliberately not extended here. Every entry in it is a line no fix inside
 * public/shop2/** could remove, and each one is argued for in that file. A
 * deployed page that produces a console error the local sweep does not is a
 * finding about the deployment — the answer to it is a fix or a reported fault,
 * never a new row in an allow-list that only this suite reads.
 */
type Guard = { writes: string[]; broken: string[]; watch: Watch; document: string; reset(url: string): void };

async function guardPage(page: Page): Promise<Guard> {
  const writes = await forbidWrites(page);
  const watch = watchPage(page);
  /* A browser that has chosen English with the language switcher. The smoke
     config gives Chromium `locale: "ru-RU"` (it was written when an unprefixed
     address was Russian), so without the switcher's cookie every unprefixed —
     English — address this suite opens would be answered with the edge's 302
     to its /ru twin (src/middleware.ts), and the EN column of the walk would
     quietly be the RU one again. The saved choice beats Accept-Language there,
     exactly as it does for a shopper; a /ru or /et address is served as itself
     whatever the cookie says. Set in the browser only — it is the shop's own
     preference cookie (`rempire_lang`), not a request to the shop. visit()
     then holds every page load to «no redirect at all». */
  await page.context().addCookies([{ name: LANG_COOKIE, value: "en", url: BASE }]);
  const g: Guard = {
    writes,
    broken: [],
    watch,
    document: "",
    reset(url: string) {
      g.writes.length = 0;
      g.broken.length = 0;
      g.document = url;
      watch.reset();
    },
  };
  /* Same-origin responses the browser actually fetched. A 404 here is the shape
     of the stale-token bug seen from the other side: the shell asks for
     /shop2/app.min.js?v=<token> and the static layer has never heard of it. The
     document itself is exempt — one of the pages this suite visits on purpose
     is a 404, and its own status is asserted by visit(). */
  page.on("response", (res) => {
    if (!res.url().startsWith(BASE) || res.url() === g.document) return;
    if (res.status() >= 400) g.broken.push(`${res.status()} ${res.url()}`);
  });
  return g;
}

/** One real page load, held to the same failure shapes the storefront sweep
 *  holds its ~250 screens to. */
async function visit(page: Page, g: Guard, url: string, screen: string, what: string, status = 200): Promise<void> {
  g.reset(url);
  const res = await page.goto(url, { waitUntil: "domcontentloaded" });
  /* page.goto() follows redirects and reports the page it ended on, so a 301
     or the edge's language 302 would otherwise pass as a 200 of somebody
     else's page. The response's own URL is the address the document was
     served for (app.js may rewrite the bar afterwards; this is before). */
  expect(res?.url(), `${what}: GET ${url} was redirected`).toBe(url);
  expect(res?.status(), `${what}: GET ${url}`).toBe(status);
  await expect(page.locator(`body[data-screen="${screen}"]`), `${what}: app.js should paint "${screen}"`).toBeAttached();
  /* The storefront paints synchronously and then settles — the boot probes
     (/api/overrides/, /api/bundles/) land a moment later and re-render. Wait
     for the network to go quiet so the console and response checks below see
     the finished page rather than the first frame of it. */
  await page.waitForLoadState("networkidle").catch(() => {});

  expect(g.writes, `${what}: this suite is read-only — a write was attempted:\n${g.writes.join("\n")}`).toEqual([]);
  expect(g.watch.pageErrors, `${what}: uncaught page error(s):\n${g.watch.pageErrors.join("\n")}`).toEqual([]);
  expect(g.watch.consoleErrors, `${what}: console.error(s):\n${g.watch.consoleErrors.join("\n")}`).toEqual([]);
  expect(g.broken, `${what}: same-origin request(s) the page could not load:\n${g.broken.join("\n")}`).toEqual([]);
}

/* ------------------------------------------------------------------------ */
/* XML, parsed by a real parser                                              */
/* ------------------------------------------------------------------------ */

/**
 * Is this valid XML, and what is in it? Parsed with the browser's own
 * `DOMParser` rather than a regex, because "valid XML" is exactly the claim
 * being made about a sitemap — a stray `&` in a product title that a regex
 * would sail past is a file Google rejects whole. There is no XML library in
 * this repository's dependencies and a smoke suite is a poor reason to add
 * one; the browser Playwright already started has a conforming parser in it.
 */
async function parseXml(page: Page, xml: string, what: string): Promise<{ root: string; locs: string[] }> {
  const out = await page.evaluate((src) => {
    const doc = new DOMParser().parseFromString(src, "application/xml");
    const err = doc.querySelector("parsererror");
    return {
      error: err ? (err.textContent || "parse error").slice(0, 400) : "",
      root: doc.documentElement ? doc.documentElement.nodeName : "",
      locs: [...doc.getElementsByTagName("loc")].map((n) => (n.textContent || "").trim()),
    };
  }, xml);
  expect(out.error, `${what}: not valid XML — ${out.error}`).toBe("");
  return { root: out.root, locs: out.locs };
}

/* ------------------------------------------------------------------------ */
/* The tests                                                                 */
/* ------------------------------------------------------------------------ */

test.describe(`deployed shop — ${BASE}`, () => {
  /* ---------------------------------------------------------------- pages */

  test("every page kind answers 200 and draws its own content, in all three languages", async ({ request }) => {
    const { kinds } = await discover(request);

    /* The shell — public/shop2/index.html — is what a page falls back to when
       a rewrite misses, and it is also the English home page, served at `/`
       (next.config.ts routes `/` to it), which is why "did I get the shell?"
       cannot be answered by looking for a marker. It is answered by
       comparing: the shell's own prerendered block is the home page's, so any
       other page whose block equals it was not served its own file. That is
       the exact failure the Estonian «Бренды» had until 07.09.2026, when it
       lived at /shop2/et/brands/ (docs/seo.md) — the right URL, a 200, and the
       home page in it. It matters more since 08.10.2026, not less: every page
       now reaches its file through a rewrite from a Shopify address, and a
       rewrite that misses lands on the catch-all, which hands out this shell.

       Asked with get(), so the way a crawler asks — no Accept-Language, no
       cookie: an unprefixed address must answer as the English page itself,
       never with the edge's 302 to a twin. */
    const shellBlock = prerenderBlockOf(await getText(request, abs("/"), "the shell (the English home page)"));
    expect(shellBlock.length, "the shell has no prerendered block at all").toBeGreaterThan(200);

    const titles = new Map<string, string>();
    for (const { lang, html } of LANGS) {
      const homePath = publicPath(lang, "/");
      const homeBlock = prerenderBlockOf(await getText(request, abs(homePath), `${lang} home`));

      for (const { kind, path } of kinds) {
        const url = abs(inLang(path, lang));
        const at = `${lang} · ${kind} · ${url}`;
        const res = await get(request, url);
        expect(res.status(), `${at}: should answer 200 with no redirect`).toBe(200);
        expect(res.headers()["content-type"] || "", `${at}: should be served as HTML`).toContain("text/html");
        const body = await res.text();

        expect(langOf(body), `${at}: <html lang>`).toBe(html);
        expect(canonicalOf(body), `${at}: canonical must be this address`).toBe(url);
        expect(robotsMetaOf(body), `${at}: robots meta for this deployment`).toBe(EXPECTED_ROBOTS_META);

        const block = prerenderBlockOf(body);
        expect(block.length, `${at}: no prerendered content — this is the bare shell`).toBeGreaterThan(200);
        if (kind !== "home") {
          expect(block, `${at}: served the ${lang} home page's content, not its own`).not.toBe(homeBlock);
          expect(block, `${at}: served the shell's (English home page's) content, not its own`).not.toBe(shellBlock);
        }

        /* A title two pages share is a title Google has to choose between, and
           it is also the cheapest possible tell that one page was served for
           another. Collected across the whole matrix rather than compared
           pairwise so the failure names both addresses. */
        const title = titleOf(body).trim();
        expect(title.length, `${at}: empty <title>`).toBeGreaterThan(0);
        const seen = titles.get(title);
        expect(seen, `${at}: shares its <title> with ${seen}\n  «${title}»`).toBeUndefined();
        titles.set(title, url);
      }
    }
  });

  test("the link-preview card of the home page and of a product is really there", async ({ request }) => {
    /* prerender:check proves every og:image is on disk and is 1 200×630; what
       it cannot prove is that the deployment serves it. A card that 404s is
       invisible until somebody pastes a link into Telegram. Both homes — `/`
       is the link anybody types, and the cards are drawn per language — and
       the product the walk picked. The cards themselves still live under
       /shop2/og/ (assets did not move on 08.10.2026). */
    const { kinds } = await discover(request);
    const homes = [publicPath("EN", "/"), publicPath("RU", "/")];
    for (const path of [...homes, ...kinds.filter((k) => k.kind === "product").map((k) => k.path)]) {
      const html = await getText(request, abs(path), `og:image of ${path}`);
      const card = ogImageOf(html);
      expect(card, `${path}: no og:image`).toMatch(/^https?:\/\//);
      const res = await get(request, card);
      expect(res.status(), `${path}: og:image ${card}`).toBe(200);
      expect(res.headers()["content-type"] || "", `${path}: og:image ${card}`).toContain("image/");
    }
  });

  for (const { lang } of LANGS) {
    test(`${lang}: every page kind renders in a browser with no console error`, async ({ page, request }) => {
      const { kinds } = await discover(request);
      /* One policy page rather than five: the five differ only in the prose
         inside a screen whose rendering the first of them already proved, and
         a browser load of a deployed page costs a real app.min.js download —
         240 KB over the wire and 1.3 MB to parse. The other four are checked
         as served HTML by the test above. */
      const walk = kinds.filter((k) => !k.kind.startsWith("info:") || k.kind === "info:privacy");
      const g = await guardPage(page);
      for (const { kind, path, screen } of walk) {
        await visit(page, g, abs(inLang(path, lang)), screen, `${lang} · ${kind}`);
      }
    });
  }

  /* --------------------------------------------------------------- robots */

  test("robots.txt is the policy this environment should be serving", async ({ request }) => {
    /* The two policies travel with every deployment (public/robots.production.txt
       and public/robots.staging.txt, written by the same run of the prerender
       that writes robots.txt itself — docs/seo.md). Reading them off the
       deployment rather than off this checkout is not a shortcut: it is the
       only version of the comparison that means anything, since the files are
       gitignored generated output and a working tree's copy was written by
       whatever base URL happened to be set the last time somebody ran the
       tool. It also lets the GitHub workflow run without checking out the
       repository at all beyond this suite. */
    const [served, open, closed] = await Promise.all([
      getText(request, abs("/robots.txt"), "robots.txt"),
      getText(request, abs("/robots.production.txt"), "the production policy"),
      getText(request, abs("/robots.staging.txt"), "the staging policy"),
    ]);

    /* The two files are the two policies, and they are not each other. */
    expect(open, "robots.production.txt should be the open policy").toMatch(/^User-agent: \*\nAllow: \/$/m);
    expect(open, "robots.production.txt must not close the whole site").not.toMatch(/^Disallow: \/$/m);
    expect(closed, "robots.staging.txt should close the site to general crawlers").toMatch(/^User-agent: \*\nDisallow: \/$/m);
    expect(closed, "robots.staging.txt should still let the link-preview scrapers in").toContain("facebookexternalhit");
    /* Both keep the cart, the checkout and the account out of an index, and
       that half of the policy is the half that must never be dropped by
       accident — it is the one part of robots.txt with a shopper behind it.
       Since 08.10.2026 those screens are at Shopify's own addresses, which are
       Shopify's own Disallow lines too: the panel at /admin (no language), the
       state screens unprefixed and again under /ru and /et (/checkout covers
       the receipt at /checkout/done). Compared line by line, so a
       `Disallow: /ru/checkout` cannot pass for `Disallow: /checkout`. */
    const lines = (body: string) => body.split(/\r?\n/).map((l) => l.trim());
    const shut = ["/admin", "/api/"];
    for (const pre of ["", "/ru", "/et"]) for (const p of ["/checkout", "/cart", "/account", "/search"]) shut.push(pre + p);
    for (const [name, body] of [["production", open], ["staging", closed]] as const) {
      for (const path of shut) {
        expect(lines(body), `robots.${name}.txt should disallow ${path}`).toContain(`Disallow: ${path}`);
      }
      /* …and NOT the old /shop2/ addresses. Every one of them is a 301 now
         (src/middleware.ts), and a crawler that is told not to fetch one can
         never learn where the page went — the old Disallow lines would have
         pinned Google to addresses that no longer have pages. */
      expect(
        lines(body).filter((l) => /^Disallow: \/shop2(?:\/|$)/.test(l)),
        `robots.${name}.txt still closes an old /shop2/ address — a crawler has to be let through to follow its 301`,
      ).toEqual([]);
    }
    /* Inside the closed /api/, the read-only answers a page is drawn from are
       opened again, in the production policy (tools/prerender-shop2.mjs,
       ALLOW_API): Googlebot renders a page, and with /api/overrides/ shut its
       renderer drew live sold-out products as InStock (SEO audit, 08.10.2026).
       The longest matching rule wins, so the Allow line is what does it. */
    expect(lines(open), "robots.production.txt should let the renderer read the live prices and stock").toContain(
      "Allow: /api/overrides/",
    );

    /* The `Sitemap:` line is the one line that legitimately differs between
       the policy file and the robots.txt built from it, because it names the
       host — so it is compared separately and the rest byte for byte. */
    const sitemapLine = (body: string) => (/^Sitemap: (\S+)$/m.exec(body) || ["", ""])[1];
    const policyBody = (body: string) => body.replace(/^Sitemap: \S+$/m, "").trimEnd();

    const expected = LIVE ? open : closed;
    const which = LIVE ? "production" : "staging";
    expect(
      policyBody(served),
      `${BASE} serves a robots.txt that is not the ${which} policy — see docs/seo.md, "The three noindex layers"`,
    ).toBe(policyBody(expected));
    expect(sitemapLine(served), "robots.txt should point at this host's own sitemap").toBe(abs("/sitemap.xml"));
  });

  test("the X-Robots-Tag header agrees with the robots meta and with robots.txt", async ({ request }) => {
    /* The third of the three layers (docs/seo.md). It is keyed on the request
       host rather than on the build, so it is the only one of the three a file
       check can never see — and the one that would have quietly outranked
       every canonical on the day the DNS moved, had it stayed the global rule
       it used to be in vercel.json. Both homes — `/` is the English one now,
       and the Russian one is /ru — then a file and an API route. */
    for (const path of ["/", "/ru", "/robots.txt", "/api/geo/"]) {
      const res = await get(request, abs(path));
      const tag = res.headers()["x-robots-tag"];
      if (LIVE) {
        expect(tag, `${path}: the live shop must not be told not to index itself`).toBeUndefined();
      } else {
        expect(tag, `${path}: a host that is not rempireshop.com must be noindex`).toBe("noindex, nofollow");
      }
    }
  });

  /* -------------------------------------------------------------- sitemap */

  test("the sitemap index and every sitemap it names are valid XML that resolves", async ({ page, request }) => {
    const indexXml = await getText(request, abs("/sitemap.xml"), "the sitemap index");
    const index = await parseXml(page, indexXml, "sitemap.xml");
    expect(index.root, "sitemap.xml is always a sitemapindex — docs/seo.md").toBe("sitemapindex");

    const named = index.locs;
    for (const loc of named) {
      expect(loc, `sitemap.xml names ${loc}, which is not on this host`).toContain(`${BASE}/`);
    }
    /* The two the app serves at request time. They are in the index precisely
       because a file written at build time cannot un-name a product Renat
       switched off this morning, nor name a blog post he published — so a
       deployment that has stopped naming them has silently gone back to a
       sitemap that lies (docs/seo.md, "The sitemaps the app serves"). */
    for (const must of ["/sitemap-1.xml", "/sitemap-products.xml", "/sitemap-custom.xml"]) {
      expect(named, `sitemap.xml should name ${must}`).toContain(abs(must));
    }

    const everyLoc: string[] = [];
    for (const loc of named) {
      const res = await get(request, loc);
      expect(res.status(), `${loc}: named by the index and not served`).toBe(200);
      expect(res.headers()["content-type"] || "", `${loc}: content type`).toMatch(/(application|text)\/xml/);
      const one = await parseXml(page, await res.text(), loc);
      expect(one.root, `${loc}: should be a <urlset>`).toBe("urlset");
      for (const u of one.locs) {
        expect(u, `${loc}: names ${u}, which is not on this host`).toContain(`${BASE}/`);
        /* …and names the page, not a hop to it. Since 08.10.2026 every page
           has exactly one address (src/lib/shop-paths.mjs): not under /shop2/
           (those are 301s now), no trailing slash, a section in its own
           language's handle. parseShopPath() reading the address back to
           itself is that whole rule in one comparison — a sitemap that lists
           redirects is a sitemap Google learns not to trust. Two of the three
           files are written by the app at request time, so this is a question
           only a deployment can answer. */
        const path = new URL(u).pathname;
        expect(
          parseShopPath(path)?.canonical,
          `${loc}: names ${u}, which is not a page address in the shop's own spelling`,
        ).toBe(path);
      }
      everyLoc.push(...one.locs);
    }

    /* Hundreds of URLs across the three; a smoke run walks a seeded sample of
       them. Fixed seed, so the same twenty are walked every time and a failure
       is reproducible — and the sample is drawn from the pooled list rather
       than per file, so it is weighted the way the sitemap itself is. Asked
       as a crawler asks (get(): no Accept-Language), so an unprefixed English
       address has to be a 200 itself, not a 302 to a twin. */
    expect(everyLoc.length, "the sitemaps between them should offer a catalogue's worth of URLs").toBeGreaterThan(100);
    const walk = sample(makeRng(SWEEP_SEED), [...new Set(everyLoc)], 20);
    for (const url of walk) {
      const res = await get(request, url);
      expect(res.status(), `sitemap URL that does not answer 200 (seed ${SWEEP_SEED}): ${url}`).toBe(200);
    }
  });

  /* ---------------------------------------------------------- asset token */

  test("the asset token in the served shell is the hash of the assets it is serving", async ({ request }) => {
    /* This is the check that would have caught 07.09.2026. The token is a hash
       of the files it versions (tools/lib/asset-token.mjs); `prerender:check`
       already recomputes it against the working tree, but a working tree
       always agrees with itself — the question only has teeth when it is asked
       of the bytes a deployment is handing to browsers. Same function, same
       rule, a reader that fetches instead of one that opens files. The shell
       is read at `/`: the English home page is public/shop2/index.html itself
       (next.config.ts), and the files it versions are still under /shop2/ —
       the page addresses moved on 08.10.2026, the assets did not. */
    const shell = await getText(request, abs("/"), "the shell (the English home page)");
    const token = currentToken(shell);
    expect(token, "the shell carries no ?v= token at all").toMatch(/^[0-9a-f]{12}$/);

    const assets = versionedAssets(shell);
    expect(assets.length, "the shell should version a dozen-odd files, not none").toBeGreaterThan(8);

    const served = await assetTokenWith(shell, async (url: string) => {
      /* Asked for with the token, exactly as the browser asks — so this both
         hashes the right bytes and proves the tokened URL resolves. A 404 is
         handed back as null, which the hash records as a named absence: that
         is how public/shop/bundles.js, which is genuinely optional, behaves on
         disk too, and the two readers have to agree about it. */
      const res = await get(request, abs(`${url}?v=${token}`));
      return res.status() === 200 ? res.text() : null;
    });

    expect(
      served,
      `${BASE} serves index.html with ?v=${token} but the files behind it hash to ${served}.\n` +
        "A versioned file was deployed without the shell that versions it — every returning browser is\n" +
        "still running the copy it cached. Re-run `npm run prerender` and deploy. See tools/lib/asset-token.mjs.",
    ).toBe(token);
  });

  test("every script and stylesheet the shell asks for loads at the token it asks for", async ({ request }) => {
    const shell = await getText(request, abs("/"), "the shell (the English home page)");
    const token = currentToken(shell);

    /* The tags carrying the shared token, plus the one that carries its own
       (/shop/content.js?v=c2 — deliberately not part of the set, see
       tools/lib/asset-token.mjs) so it cannot rot unnoticed either. */
    const tagged = [...shell.matchAll(/(?:href|src)="(\/[^"?\s]+)\?v=([^"'\s]*)"/g)].map(([, url, v]) => `${url}?v=${v}`);
    expect(tagged.length, "the shell has no versioned asset tags").toBeGreaterThan(8);

    const TYPES: Array<[RegExp, RegExp]> = [
      [/\.js$/, /(javascript|ecmascript)/],
      [/\.css$/, /text\/css/],
      [/\.(webp|jpe?g|png|svg)$/, /image\//],
    ];
    for (const rel of [...new Set(tagged)]) {
      const res = await get(request, abs(rel));
      expect(res.status(), `asset tag in the shell that does not load: ${rel}`).toBe(200);
      const type = res.headers()["content-type"] || "";
      const want = TYPES.find(([ext]) => ext.test(rel.split("?")[0]));
      if (want) expect(type, `${rel}: served as ${type}`).toMatch(want[1]);
      expect((await res.body()).length, `${rel}: served empty`).toBeGreaterThan(0);
    }
    expect(tagged.some((t) => t.endsWith(`?v=${token}`)), "no tag carries the shared token").toBe(true);
  });

  /* ------------------------------------------------------------------ 404 */

  test("a page that must not exist answers 404 with noindex, in every language", async ({ page, request }) => {
    /* Since 07.09.2026 an address the shop has no page for is never a 200
       with the home page in it — a soft 404 is the one thing Google asks a
       site not to do, because a page that says "found" while showing
       something else is indexed, then quietly dropped, and it drags the pages
       it links to down with it (src/lib/notfound-page.ts). The name below is
       deliberately something no product, section, brand or post could be
       called.

       Since 08.10.2026 the shop is the whole site, at Shopify's addresses, and
       an unknown address has one of two honest answers rather than one:

         · a real 404 page — for an address of no shop shape at all, and for a
           set id nobody has;
         · ONE 301 to the nearest page that exists — for the shapes Shopify
           had (/collections/…, /products/…, /pages/…, /policies/…), where
           Google still holds thousands of addresses from years of the old
           store, and a 404 would throw away what each of them had earned
           (src/lib/legacy-redirects.ts). */
    const NOPE = "smoke-test-no-such-page-8f2c1";

    /* The 404s the root catch-all (src/app/[...path]) answers itself: a real
       404 page, in the language of the prefix, with a canonical that is its
       own address. The unprefixed one is the English 404 — there is no
       "outside the shop" for an unknown address to fall into any more.

       `set/<id>` is held here for a reason worth keeping. On 08.09.2026, when
       the shop lived under /shop2/, it was measured as a 200: it had been
       accepted whatever the id, on the stated grounds that it had "its own
       request-time route that answers 404 for an id nobody has" — true of
       products and blog posts, never true of sets. Sets are the owner's to
       create and hide, so the id is asked of the `bundles` table, exactly as a
       brand slug is. (Its sibling that day, `info/<slug>`, was a 200 on every
       host because the check read directories only a developer's disk has;
       an unknown policy address is a 301 now, below.) Both were soft 404s in
       unlimited numbers, noindex on staging only for as long as the whole
       host is, and indexable on rempireshop.com. */
    for (const { lang, prefix, html } of LANGS) {
      for (const path of [`${prefix}/${NOPE}`, `${prefix}/collections/sets/${NOPE}`]) {
        const url = abs(path);
        const at = `${lang} · ${url}`;
        const res = await get(request, url);
        expect(res.status(), `${at}: should be a real 404`).toBe(404);
        const body = await res.text();
        expect(robotsMetaOf(body), `${at}: a 404 must be noindex whatever the environment`).toMatch(/^noindex/);
        expect(canonicalOf(body), `${at}: canonical should be this address`).toBe(url);
        expect(langOf(body), `${at}: <html lang> should follow the prefix`).toBe(html);
      }

      /* The Shopify shapes: ONE 301, to a page in the same language, and the
         page answers 200 itself — a hop, never a chain and never a page that
         is not the address's own.

           · a collection handle nobody has → «Все товары» (asked of the
             database first, in case it is a brand only the owner's own
             products carry — notFoundPageResponse());
           · a product handle that is no product, no alias and starts with no
             brand → «Все товары» too;
           · a policy or a page nobody has → «Контакты». */
      const allProducts = publicPath(lang, "/c/all/");
      const contact = publicPath(lang, "/info/contact/");
      const moved: Array<[string, string]> = [
        [`${prefix}/collections/${NOPE}`, allProducts],
        [`${prefix}/products/${NOPE}`, allProducts],
        [`${prefix}/pages/${NOPE}`, contact],
        [`${prefix}/policies/${NOPE}`, contact],
      ];
      for (const [path, to] of moved) {
        const url = abs(path);
        const at = `${lang} · ${url}`;
        const res = await get(request, url);
        expect(res.status(), `${at}: should be one 301 to ${to}`).toBe(301);
        const location = new URL(res.headers()["location"] || "", url).toString();
        expect(location, `${at}: should move to ${to}`).toBe(abs(to));
        expect((await get(request, location)).status(), `${at} → ${to}: the target should be a page, not another hop`).toBe(200);
      }

      /* A product id nobody has in the owner's own `c-…` shape is the one
         product address that stays a 404 — **with the noindex shell**, byte
         for byte what a hidden product gets, so that a product switched off in
         the panel and a product that never existed behave identically
         (docs/seo.md, "A product id nobody has is a 404 too"). Any other
         handle is a Shopify address first and gets the 301 above. The shell's
         head is the English home page's, so the canonical and the <html lang>
         are not this address and are not asserted here — app.js settles it on
         «Страница не найдена» a moment later, which
         e2e/sweep-storefront.spec.ts drives. The status and the noindex are
         the whole of the server-side contract, and they are what is checked. */
      const prod = abs(`${prefix}/products/c-${NOPE}`);
      const res = await get(request, prod);
      expect(res.status(), `${lang} · ${prod}: an id nobody has should be a 404`).toBe(404);
      expect(robotsMetaOf(await res.text()), `${lang} · ${prod}: must be noindex`).toMatch(/^noindex/);
    }

    /* Not a page address at all — an API route nobody has. A plain 404, not
       the shop's page: notFoundPageResponse() keeps that for addresses a
       shopper could have typed. */
    expect((await get(request, abs(`/api/${NOPE}`))).status(), "an unknown /api/ address").toBe(404);

    await visit(page, await guardPage(page), abs(publicPath("RU", `/${NOPE}/`)), "notfound", "the 404 screen", 404);
  });

  /* --------------------------------------------------------- empty shelves */

  test("an empty «Наборы» and an empty blog are nowhere on the shop", async ({ page, request }) => {
    /* Dim, 28.09.2026: «Blog and Sets will be off initially, before any blog
       post is written and any set by Renat done». The go-live reset deletes
       every set and every post (tools/go-live-reset.mjs --test-content), and
       from then on the shop must show neither — no header entry, no home row,
       no crumb, no sitemap row, and the two addresses are the ordinary 404 —
       until the first one comes back by itself. The live answers decide which
       half applies: a set switched on or an article published since the build
       is on /api/ before it is in any file. */
    const setsRes = await get(request, abs("/api/bundles/"));
    expect(setsRes.status(), "GET /api/bundles/").toBe(200);
    const noSets = (((await setsRes.json()).bundles || []) as unknown[]).length === 0;
    const blogRes = await get(request, abs("/api/blog/?lang=RU&page=1"));
    expect(blogRes.status(), "GET /api/blog/").toBe(200);
    const noPosts = !(Number((await blogRes.json()).total) > 0);
    test.skip(!noSets && !noPosts, "the shop has sets and articles — the page walk above covers both");

    /* «Наборы» is /collections/sets and «Блог» /blogs/news since 08.10.2026,
       in each language's prefix — publicPath() spells both. */
    for (const { lang } of LANGS) {
      if (noSets) {
        const url = abs(publicPath(lang, "/sets/"));
        expect((await get(request, url)).status(), `${lang} · ${url} with no set on sale`).toBe(404);
      }
      if (noPosts) {
        const url = abs(publicPath(lang, "/blog/"));
        const res = await get(request, url);
        expect(res.status(), `${lang} · ${url} with no published article`).toBe(404);
        expect(robotsMetaOf(await res.text()), `${lang} · ${url}: a 404 must be noindex`).toMatch(/^noindex/);
      }
    }
    /* Read by route, not by spelling: a set page is any address whose route
       is /sets/ or /set/<id>/, in whichever language's prefix. */
    const listed = shopPages(locsOf(await getText(request, abs("/sitemap-1.xml"), "the static sitemap")));
    const named = (re: RegExp) => listed.filter((p) => re.test(p.rest)).map((p) => p.path);
    if (noSets) expect(named(/^\/sets?\//), "the sitemap names a set page with no set on sale").toEqual([]);
    if (noPosts) expect(named(/^\/blog\//), "the sitemap names a blog page with no article").toEqual([]);

    /* …and in a browser, once app.js has taken over and the boot probes have
       answered (visit() waits for the network to go quiet). */
    const g = await guardPage(page);
    await visit(page, g, abs(publicPath("RU", "/")), "home", "home with an empty shelf");
    if (noSets) {
      await expect(page.locator("[data-nav-bundles]"), "«Наборы» in the header with no set on sale").toHaveCount(0);
      await expect(page.locator(".sec--bundles"), "a sets row on the home page with no set on sale").toHaveCount(0);
    }
    if (noPosts) await expect(page.locator("[data-nav-blog]"), "«Блог» in the header with no article").toHaveCount(0);
    if (noSets) {
      await visit(page, g, abs(publicPath("RU", "/gift/")), "gift", "the gift card with no set on sale");
      await expect(page.locator('.crumbs [data-go="bundles"]'), "a «Наборы» crumb over the gift card").toHaveCount(0);
      await visit(page, g, abs(publicPath("RU", "/sets/")), "notfound", "«Наборы» with no set on sale", 404);
    }
    if (noPosts) await visit(page, g, abs(publicPath("RU", "/blog/")), "notfound", "«Блог» with no article", 404);
  });

  /* ------------------------------------------------------------- redirects */

  test("every old address answers ONE redirect to its page, and / is a page", async ({ request }) => {
    /* Since 08.10.2026 the shop answers at Shopify's own addresses
       (src/lib/shop-paths.mjs) and `/` is the English home page itself — a
       200, where until that night it was a 307 to /shop2/. Every address that
       is not the page answers ONE 301 to it (src/middleware.ts,
       src/lib/legacy-redirects.ts), and one is the number that matters: each
       extra hop is another round trip on a phone and a link Google follows
       with less confidence. So nothing here follows a redirect — each hop is
       read off the first response, and its target must answer 200 by itself.

         · /shop2/… — the shop's address from 25.08 to the night of 08.10.2026:
           in sent letters, in Montonio's trip back from the bank, on Renat's
           home screen (/shop2/admin/). Unprefixed was RUSSIAN there, so
           /shop2/c/hair/ is /ru/…, and /shop2/en/… is the unprefixed page.
         · /shop — the prototype's, same convention.
         · /products/<id>/ — no page address ends in a slash any more.
         · /en-lv/… — one of Shopify's regional English storefronts, still in
           Google's index.

       The product is the one the page walk picked from the sitemap, so this
       never names an id the shop has stopped selling. */
    const { kinds } = await discover(request);
    const id = kinds.find((k) => k.kind === "product")!.path.split("/").pop();

    const home = await get(request, abs("/"));
    expect(home.status(), "/ is the English home page — a 200, not a redirect").toBe(200);

    const hops: Array<[string, string, number]> = [
      ["/shop", "/ru", 301],
      ["/shop2/", "/ru", 301],
      ["/shop2/ru/", "/ru", 301],
      ["/shop2/ru/c/hair/", "/ru/collections/uhod-za-volosami", 301],
      ["/shop2/c/hair/", "/ru/collections/uhod-za-volosami", 301],
      [`/shop2/en/p/${id}/`, `/products/${id}`, 301],
      ["/shop2/admin/", "/admin", 301],
      [`/products/${id}/`, `/products/${id}`, 301],
      [`/en-lv/products/${id}`, `/products/${id}`, 301],
      /* …and a Merchant Center link to it keeps its campaign, minus Shopify's own parameters */
      [`/en-lv/products/${id}?country=LV&currency=EUR&utm_source=google`, `/products/${id}?utm_source=google`, 301],
      /* The names a human types for the hand-written pages (next.config.ts).
         Dim asked for the checklist as /tests twice, from his phone, and got
         a 404 both times — a page whose whole job is to be opened from a chat
         message cannot fail on the plural. 307, because nothing should have
         cached them. */
      ["/tests", "/test", 307],
      ["/checklist", "/test", 307],
      ["/card", "/cards", 307],
      ["/karty", "/cards", 307],
      ["/guides", "/guide", 307],
    ];
    for (const [from, to, code] of hops) {
      const res = await get(request, abs(from));
      expect(res.status(), `${from}: should answer ${code}`).toBe(code);
      const location = new URL(res.headers()["location"] || "", abs(from)).toString();
      expect(location, `${from} should move to ${to}`).toBe(abs(to));
      const landed = await get(request, location);
      expect(landed.status(), `${from} → ${to}: the target should be the page itself — one hop, no more`).toBe(200);
    }
  });

  test("the payment webhook answers both spellings of its address without a redirect", async ({ request }) => {
    /* The other half of «no page address ends in a slash», and the half that
       is money. Montonio POSTs every payment notice to /api/payments/notify/,
       the address registered with it — and a webhook sender is not a
       browser: most do not follow a redirect at all, and one that does may
       resend the POST as a GET. A 301 or 308 here is not a slower answer, it
       is a payment the shop never hears about, and an order that reads
       «ожидает оплаты» for ever. So the API is outside the trailing-slash
       rule (next.config.ts skipTrailingSlashRedirect, the middleware's
       matcher) and answers both spellings itself.

       postEmpty() sends no body, which the route refuses (`bad_body`) with a
       400 before it has looked up an order: the status is the whole answer.
       400 rather than "anything but 3xx", because a 404 (the route gone) or a
       503 (no payment provider configured) would be a fault of its own. */
    for (const path of ["/api/payments/notify/", "/api/payments/notify"]) {
      const res = await postEmpty(request, abs(path));
      expect(res.status(), `POST ${path} with an empty body should be refused by the route itself`).toBe(400);
    }
  });

  /* ------------------------------------------------------------- language */

  test("an unprefixed page is English to a crawler and a 302 to /ru for a Russian browser", async ({ request }) => {
    /* Since 08.10.2026 an unprefixed address is English — Shopify's scheme, and
       the x-default — and the edge sends a browser that asked for Russian or
       Estonian to the twin in its language (src/middleware.ts): the saved
       choice first (the `rempire_lang` cookie the switcher writes), else
       Accept-Language. A 302, never a 301 — the same address answers
       differently for different visitors, and a permanent redirect would be
       cached as the answer for all of them — with `Vary: Accept-Language,
       Cookie` on both answers, so no cache between the edge and a browser hands
       a Russian visitor's redirect to a crawler, or the crawler's English page
       to a Russian visitor. Googlebot sends no Accept-Language, and it must be
       given the English page itself: anything else and the x-default is not
       indexable at all. */
    const { kinds } = await discover(request);
    const ruProduct = kinds.find((k) => k.kind === "product")!.path;
    const enProduct = abs(inLang(ruProduct, "EN"));

    /* No Accept-Language and no cookie: get() sends neither. */
    const bare = await get(request, enProduct);
    expect(bare.status(), `${enProduct} with no language asked for: the English page itself`).toBe(200);
    expect(langOf(await bare.text()), `${enProduct}: <html lang> with no language asked for`).toBe("en");
    expect(bare.headers()["vary"] || "", `${enProduct}: the English page should say what it was chosen by`).toMatch(
      /accept-language/i,
    );

    const asked = await get(request, enProduct, { headers: { "Accept-Language": "ru-RU" } });
    expect(asked.status(), `${enProduct} for a Russian browser: a 302 to the /ru twin`).toBe(302);
    expect(new URL(asked.headers()["location"] || "", enProduct).toString(), `${enProduct}: where the Russian browser is sent`).toBe(
      abs(ruProduct),
    );
    expect(asked.headers()["vary"] || "", `${enProduct}: the 302 must vary on what decided it`).toMatch(/accept-language/i);
  });

  /* -------------------------------------------------------------- headers */

  test("the security headers next.config.ts sets are on a deployed response", async ({ request }) => {
    const { kinds } = await discover(request);
    const shell = await getText(request, abs("/"), "the shell (the English home page)");
    const token = currentToken(shell);
    const product = kinds.find((k) => k.kind === "product")!.path;

    /* Two families, because next.config.ts sets two policies. Since
       08.10.2026 the shop's pages are the whole site — `/`, `/ru`, every
       product, and the admin panel at /admin, the one screen a stranger's text
       reaches — so the strict policy is the DEFAULT for every path: a
       script-src with no 'unsafe-inline' at all, the rule that turns an
       innerHTML mistake into a broken layout instead of a takeover
       (docs/audit/security-api.md H5). The files those pages load, still
       under /shop2/ (assets did not move), carry it too. The named exceptions
       keep 'unsafe-inline': the API (a few routes answer HTML of their own),
       the prototype's leftovers under /shop/ and the four hand-written pages
       (/test, /guide, /cards, /golive). /admin is asked anonymously, like
       everything here: the shell at 200, the panel's door still shut. */
    const cases: Array<{ url: string; strict: boolean }> = [
      { url: abs("/"), strict: true },
      { url: abs(publicPath("RU", "/")), strict: true },
      { url: abs(product), strict: true },
      { url: abs(inLang(product, "EN")), strict: true },
      { url: abs("/admin"), strict: true },
      { url: abs(`/shop2/app.min.js?v=${token}`), strict: true },
      { url: abs("/api/geo/"), strict: false },
    ];

    for (const { url, strict } of cases) {
      const res = await get(request, url);
      expect(res.status(), `${url}: should answer 200 before its headers mean anything`).toBe(200);
      const h = res.headers();

      expect(h["x-content-type-options"], `${url}: X-Content-Type-Options`).toBe("nosniff");
      expect(h["x-frame-options"], `${url}: X-Frame-Options`).toBe("DENY");
      expect(h["referrer-policy"], `${url}: Referrer-Policy`).toBe("strict-origin-when-cross-origin");
      expect(h["strict-transport-security"], `${url}: HSTS`).toBe("max-age=31536000; includeSubDomains");

      /* The camera and the microphone are the two permissions the shop's
         pages open — the admin's barcode scanner and the assistant's voice
         input, at /admin and /admin/scan — and `(self)` is the whole of each
         opening: no third party and no cross-origin frame gets either. The
         loose family (the API) keeps both shut, and every other permission
         everywhere stays denied. */
      const perms = h["permissions-policy"] || "";
      expect(perms, `${url}: Permissions-Policy`).toContain(strict ? "camera=(self)" : "camera=()");
      expect(perms, `${url}: Permissions-Policy`).toContain(strict ? "microphone=(self)" : "microphone=()");
      for (const denied of ["geolocation=()", "payment=()", "usb=()"]) {
        expect(perms, `${url}: Permissions-Policy should still deny ${denied}`).toContain(denied);
      }

      /* Parsed into directives rather than compared as one string: a CSP is
         edited legitimately (a new video host, the Cloudflare beacon) and a
         byte comparison would fail every one of those edits while saying
         nothing about the property that matters. */
      const csp = Object.fromEntries(
        (h["content-security-policy"] || "")
          .split(";")
          .map((part) => part.trim().split(/\s+/))
          .filter((parts) => parts[0])
          .map((parts) => [parts[0], parts.slice(1)]),
      ) as Record<string, string[]>;

      expect(csp["default-src"], `${url}: CSP default-src`).toEqual(["'self'"]);
      expect(csp["frame-ancestors"], `${url}: CSP frame-ancestors`).toEqual(["'none'"]);
      expect(csp["base-uri"], `${url}: CSP base-uri`).toEqual(["'none'"]);
      expect(csp["object-src"], `${url}: CSP object-src`).toEqual(["'none'"]);
      expect(csp["form-action"], `${url}: CSP form-action should allow only us and the bank`).toContain("'self'");
      expect(csp["connect-src"], `${url}: CSP connect-src should start at 'self'`).toContain("'self'");

      expect(csp["script-src"], `${url}: CSP script-src`).toContain("'self'");
      if (strict) {
        expect(
          csp["script-src"],
          `${url}: the shop's pages and assets must never allow an inline script — this is the policy the audit asked for`,
        ).not.toContain("'unsafe-inline'");
      }
    }
  });

  /* ------------------------------------------------------------ API probes */

  test("the probes the storefront makes on boot answer sanely to a stranger", async ({ request }) => {
    /* What a cold visitor's browser asks for before it has painted anything:
       loadServerOverrides() and loadBundles() fire side by side at the end of
       app.js, and /api/geo/ follows on a first visit that has no saved
       language. All three are GETs, none of them needs a session, and each one
       has a documented fallback — but a fallback is not the same as working,
       and a shop quietly running on its localStorage copy of yesterday's
       prices is exactly the failure nobody notices. */
    const overrides = await get(request, abs("/api/overrides/"));
    expect(overrides.status(), "GET /api/overrides/ — the prices, the stock and the shop's settings").toBe(200);
    const ov = await overrides.json();
    expect(ov.ok, "/api/overrides/ answered {ok:false} — the shop is running on its cached copy").toBe(true);
    expect(typeof ov.overrides, "/api/overrides/ should carry the per-product overrides").toBe("object");
    expect(typeof ov.settings, "/api/overrides/ should carry the public settings").toBe("object");
    /* Only the public keys leave the server (PUBLIC_SETTINGS in the route).
       The wholesale discount is the one that must never be among them. */
    expect(JSON.stringify(ov.settings), "/api/overrides/ leaked a non-public setting").not.toContain("proDiscountPct");

    const bundles = await get(request, abs("/api/bundles/"));
    expect(bundles.status(), "GET /api/bundles/ — «Наборы»").toBe(200);
    const bd = await bundles.json();
    expect(bd.ok, "/api/bundles/ answered {ok:false}").toBe(true);
    expect(Array.isArray(bd.bundles), "/api/bundles/ should answer with a list").toBe(true);

    const geo = await get(request, abs("/api/geo/"));
    expect(geo.status(), "GET /api/geo/ — the first-visit language refinement").toBe(200);
    expect(String((await geo.json()).country || ""), "/api/geo/ should answer a two-letter country").toMatch(/^[A-Z]{2}$/);

    /* Not a probe the storefront makes for a shopper — app.js asks this only
       when the admin screen is opened — but this is the cheapest possible
       assertion that the panel is shut to a stranger, and it costs one GET
       that changes nothing. 401, with no session cookie handed back. */
    const me = await get(request, abs("/api/admin/me/"));
    expect(me.status(), "GET /api/admin/me/ — the admin door must be shut to an anonymous visitor").toBe(401);
    expect(me.headers()["set-cookie"], "an anonymous 401 must not hand out a session").toBeUndefined();
  });
});
