/**
 * Smoke tests against a **deployed** shop — staging by default, production
 * when you say so. Run with `npm run smoke`; the config is
 * playwright.smoke.config.ts and the prose is docs/testing.md § «Smoke tests
 * against a deployed shop».
 *
 * ======================================================================
 *  READ-ONLY. EVERY REQUEST IN THIS FILE MUST BE A GET A CRAWLER COULD MAKE.
 * ======================================================================
 *
 * There is a real shop on the other end of this base URL, with Renat's real
 * catalogue, Renat's real customers and a real payment provider behind it. So:
 * no orders, no letters, no admin writes, no sign-in, no POST, no PUT, no
 * PATCH, no DELETE, nothing that costs a cent or leaves a row. Everything here
 * is a GET of a URL Googlebot would be welcome to fetch, and the only state
 * this suite creates anywhere is a Playwright trace on the runner's own disk.
 *
 * The rule is enforced, not merely written down. `forbidWrites()` below hangs a
 * route handler on every page that answers any non-GET the storefront attempts
 * with a synthetic 200 — the request never reaches the shop — and records it,
 * and every test that opens a page then asserts nothing was recorded. Add a
 * write and the suite goes red on the machine you add it on, before it can
 * ever go red on Renat's database. Requests made without a browser go through
 * `get()`, which is the only door this file opens and takes no body.
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
 *   · **The cart, the checkout screens, `/done`, `/account`, `/search`.**
 *     Robots-disallowed, not prerendered, not in the sitemap, and meaningless
 *     without state (docs/seo.md). A crawler never sees them and neither does
 *     this file.
 *   · **Visual snapshots.** A baseline that has to be renewed whenever Renat
 *     edits a banner would be a suite nobody trusts by the third false alarm.
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { assetTokenWith, currentToken, versionedAssets } from "../tools/lib/asset-token.mjs";
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
/* The only door: GET                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Every request this file makes without a browser. It exists so the read-only
 * rule has one place to be true rather than forty call sites to be trusted at,
 * and so `maxRedirects: 0` is the default everywhere: a page that answers 200
 * today and a 308 tomorrow is a deployment change worth failing over, and a
 * client that quietly follows the hop would report the new page as the old one.
 */
function get(request: APIRequestContext, url: string, opts: { redirects?: boolean } = {}) {
  return request.get(url, { maxRedirects: opts.redirects ? 5 : 0, timeout: 45_000 });
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
 *  answered below: the shell's block is the Russian home page. */
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
  /** One representative URL per kind of page, Russian (no prefix). */
  kinds: Array<{ kind: string; path: string; screen: string }>;
};

let discovery: Promise<Discovered> | null = null;

function discover(request: APIRequestContext): Promise<Discovered> {
  if (!discovery) discovery = discoverOnce(request);
  return discovery;
}

async function discoverOnce(request: APIRequestContext): Promise<Discovered> {
  const staticXml = await getText(request, abs("/sitemap-1.xml"), "the static sitemap");
  const productXml = await getText(request, abs("/sitemap-products.xml"), "the products sitemap");
  const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const all = [...locs(staticXml), ...locs(productXml)];

  /* Russian paths only — the prefixed twins are built from these below, which
     is also how the three-language matrix stays honest: the same page, the
     same id, three prefixes. */
  const paths = all
    .filter((u) => u.startsWith(`${BASE}/shop2/`))
    .map((u) => u.slice(BASE.length))
    .filter((p) => !p.startsWith("/shop2/et/") && !p.startsWith("/shop2/en/"));

  const rng = makeRng(SWEEP_SEED);
  const oneOf = (re: RegExp, what: string): string => {
    const found = paths.filter((p) => re.test(p));
    expect(found.length, `the deployment's sitemaps name no ${what} (${re})`).toBeGreaterThan(0);
    return pickOne(rng, found);
  };

  /* `screen` is what app.js writes into body[data-screen] once it has taken
     over — the same names e2e/sweep-storefront.spec.ts asserts on. */
  const kinds: Discovered["kinds"] = [
    { kind: "home", path: "/shop2/", screen: "home" },
    { kind: "product", path: oneOf(/^\/shop2\/p\/[^/]+\/$/, "product page"), screen: "product" },
    { kind: "category", path: oneOf(/^\/shop2\/c\/[^/]+\/$/, "category page"), screen: "catalog" },
    { kind: "brand", path: oneOf(/^\/shop2\/b\/[^/]+\/$/, "brand page"), screen: "catalog" },
    { kind: "brands", path: "/shop2/brands/", screen: "brands" },
    { kind: "sets", path: "/shop2/sets/", screen: "bundles" },
    { kind: "set", path: oneOf(/^\/shop2\/set\/[^/]+\/$/, "set page"), screen: "bundle" },
    { kind: "gift", path: "/shop2/gift/", screen: "gift" },
    { kind: "blog", path: "/shop2/blog/", screen: "blog" },
    { kind: "blogpost", path: oneOf(/^\/shop2\/blog\/[^/]+\/$/, "blog post"), screen: "blogpost" },
  ];
  /* Every policy page, not a sample: there are five of them, they are the
     pages a shopper reads before deciding to trust the shop, and «Контакты»
     going missing is not something to find out about from a customer. */
  for (const p of paths.filter((p) => /^\/shop2\/info\/[^/]+\/$/.test(p)).sort()) {
    kinds.push({ kind: `info:${p.split("/")[3]}`, path: p, screen: "info" });
  }
  return { all, kinds };
}

/** The three languages, and the prefix each one lives under (docs/seo.md:
 *  Russian is the default, has no prefix, and is the x-default). */
const LANGS = [
  { lang: "RU", seg: "", html: "ru" },
  { lang: "ET", seg: "/et", html: "et" },
  { lang: "EN", seg: "/en", html: "en" },
];

/** `/shop2/p/x/` in Estonian is `/shop2/et/p/x/` — the prefix goes after
 *  `/shop2`, which is what pathFor() in app.js builds and what the prerender
 *  writes to disk. */
const inLang = (path: string, seg: string): string => (seg ? path.replace("/shop2", `/shop2${seg}`) : path);

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
       a rewrite misses, and it is also the Russian home page, which is why
       "did I get the shell?" cannot be answered by looking for a marker. It is
       answered by comparing: the shell's own prerendered block is the home
       page's, so any other page whose block equals it was not served its own
       file. That is the exact failure /shop2/et/brands/ had until 07.09.2026
       (docs/seo.md) — the right URL, a 200, and the Russian home page in it. */
    const shellBlock = prerenderBlockOf(await getText(request, abs("/shop2/"), "the shell"));
    expect(shellBlock.length, "the shell has no prerendered block at all").toBeGreaterThan(200);

    const titles = new Map<string, string>();
    for (const { lang, seg, html } of LANGS) {
      const homePath = inLang("/shop2/", seg);
      const homeBlock = prerenderBlockOf(await getText(request, abs(homePath), `${lang} home`));

      for (const { kind, path } of kinds) {
        const url = abs(inLang(path, seg));
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
          expect(block, `${at}: served the Russian shell's content, not its own`).not.toBe(shellBlock);
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
       invisible until somebody pastes a link into Telegram. */
    const { kinds } = await discover(request);
    for (const path of ["/shop2/", ...kinds.filter((k) => k.kind === "product").map((k) => k.path)]) {
      const html = await getText(request, abs(path), `og:image of ${path}`);
      const card = ogImageOf(html);
      expect(card, `${path}: no og:image`).toMatch(/^https?:\/\//);
      const res = await get(request, card);
      expect(res.status(), `${path}: og:image ${card}`).toBe(200);
      expect(res.headers()["content-type"] || "", `${path}: og:image ${card}`).toContain("image/");
    }
  });

  for (const { lang, seg } of LANGS) {
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
        await visit(page, g, abs(inLang(path, seg)), screen, `${lang} · ${kind}`);
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
       accident — it is the one part of robots.txt with a shopper behind it. */
    for (const [name, body] of [["production", open], ["staging", closed]] as const) {
      for (const shut of ["/shop2/admin", "/shop2/checkout", "/shop2/account", "/api/"]) {
        expect(body, `robots.${name}.txt should disallow ${shut}`).toContain(`Disallow: ${shut}`);
      }
    }

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
       it used to be in vercel.json. */
    for (const path of ["/shop2/", "/robots.txt", "/api/geo/"]) {
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
      }
      everyLoc.push(...one.locs);
    }

    /* Hundreds of URLs across the three; a smoke run walks a seeded sample of
       them. Fixed seed, so the same twenty are walked every time and a failure
       is reproducible — and the sample is drawn from the pooled list rather
       than per file, so it is weighted the way the sitemap itself is. */
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
       rule, a reader that fetches instead of one that opens files. */
    const shell = await getText(request, abs("/shop2/"), "the shell");
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
    const shell = await getText(request, abs("/shop2/"), "the shell");
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
    /* Since 07.09.2026 an unknown address under /shop2/ is a real 404 rather
       than a 200 with the home page in it — a soft 404 is the one thing Google
       asks a site not to do, because a page that says "found" while showing
       something else is indexed, then quietly dropped, and it drags the pages
       it links to down with it (src/lib/notfound-page.ts). The name below is
       deliberately something no product, category or post could be called. */
    const NOPE = "smoke-test-no-such-page-8f2c1";

    /* The shapes the `[...path]` route answers itself: a real 404 page, in the
       language of the path, with a canonical that is its own address.

       `info/` and `set/` were measured as 200 here on 08.09.2026, reported as
       findings rather than asserted, and fixed the same day; this is where
       they are held. They are worth naming because they failed in opposite
       ways, and only one of the two could ever have been caught on a laptop:

         · `info/<slug>` was checked against the directories `npm run prerender`
           writes under public/shop2/info/, which no deployment has — only
           public/shop2/index.html is traced into the function bundle — so the
           check passed locally and was off on every host that serves the shop.
           The five slugs are a build-time module now (src/data/legal-slugs.json,
           tools/pack-legal.mjs), traced because the source names it.
         · `set/<id>` was accepted whatever the id, on the stated grounds that
           it had "its own request-time route that answers 404 for an id nobody
           has" — true of p/<id> and blog/<slug>, and never true of sets. Sets
           are the owner's to create and hide, so the id is asked of the
           `bundles` table, exactly as a brand slug is.

       Both were soft 404s in unlimited numbers, noindex on staging only for as
       long as the whole host is, and indexable on rempireshop.com. */
    for (const { lang, seg, html } of LANGS) {
      for (const path of [
        `/shop2${seg}/${NOPE}/`,
        `/shop2${seg}/c/${NOPE}/`,
        `/shop2${seg}/b/${NOPE}/`,
        `/shop2${seg}/info/${NOPE}/`,
        `/shop2${seg}/set/${NOPE}/`,
      ]) {
        const url = abs(path);
        const at = `${lang} · ${url}`;
        const res = await get(request, url);
        expect(res.status(), `${at}: should be a real 404`).toBe(404);
        const body = await res.text();
        expect(robotsMetaOf(body), `${at}: a 404 must be noindex whatever the environment`).toMatch(/^noindex/);
        expect(canonicalOf(body), `${at}: canonical should be this address`).toBe(url);
        expect(langOf(body), `${at}: <html lang> should follow the path`).toBe(html);
      }

      /* A product id nobody has is a different, deliberate shape: 404 **with
         the noindex shell**, byte for byte what a hidden product gets, so that
         a product switched off in the panel and a product that never existed
         behave identically (docs/seo.md, "A product id nobody has is a 404
         too"). The shell's head is the Russian home page's, so the canonical
         and the <html lang> are not this address and are not asserted here —
         app.js settles it on «Страница не найдена» a moment later, which
         e2e/sweep-storefront.spec.ts drives. The status and the noindex are
         the whole of the server-side contract, and they are what is checked. */
      const prod = abs(`/shop2${seg}/p/${NOPE}/`);
      const res = await get(request, prod);
      expect(res.status(), `${lang} · ${prod}: an id nobody has should be a 404`).toBe(404);
      expect(robotsMetaOf(await res.text()), `${lang} · ${prod}: must be noindex`).toMatch(/^noindex/);
    }

    /* Outside /shop2/ there is no shell to patch, so this is Next's own
       not-found — still a 404, which is the only part that matters. */
    expect((await get(request, abs(`/${NOPE}/`))).status(), "a 404 outside /shop2/").toBe(404);

    await visit(page, await guardPage(page), abs(`/shop2/${NOPE}/`), "notfound", "the 404 screen", 404);
  });

  /* ------------------------------------------------------------- redirects */

  test("the redirects next.config.ts declares still redirect", async ({ request }) => {
    /* `/` is the shop's front door at the switch and a 307 today on purpose —
       a permanent redirect cached in every visitor's browser is the one thing
       that would make moving the shop to the root painful (next.config.ts).
       The `/shop2/ru/…` pair is permanent, and must stay permanent: it is what
       stops a hand-typed prefix becoming a second address for the same page. */
    const hops: Array<[string, string, number[]]> = [
      ["/", "/shop2/", [307]],
      ["/shop", "/shop2/", [307, 308]],
      ["/shop2/ru/", "/shop2/", [301, 308]],
      ["/shop2/ru/c/hair/", "/shop2/c/hair/", [301, 308]],
      /* The names a human types for the three hand-written pages. Dim asked
         for the checklist as /tests/ twice, from his phone, and got a 404
         both times — a page whose whole job is to be opened from a chat
         message cannot fail on the plural. 307, because these pages move to
         the real domain later and nothing should have cached them. */
      ["/tests/", "/test/", [307]],
      ["/checklist/", "/test/", [307]],
      ["/card/", "/cards/", [307]],
      ["/karty/", "/cards/", [307]],
      ["/guides/", "/guide/", [307]],
    ];
    for (const [from, to, codes] of hops) {
      /* The first hop of `/shop` is trailingSlash's own `/shop` → `/shop/`,
         so these follow to the end and compare the destination, with the
         status of the first hop checked separately below. */
      const followed = await get(request, abs(from), { redirects: true });
      expect(followed.url(), `${from} should end up at ${to}`).toBe(abs(to));
      expect(followed.status(), `${from} → ${to} should end in a page`).toBe(200);
      const first = await get(request, abs(from));
      expect(codes, `${from}: first hop answered ${first.status()}`).toContain(first.status());
    }
  });

  /* -------------------------------------------------------------- headers */

  test("the security headers next.config.ts sets are on a deployed response", async ({ request }) => {
    const { kinds } = await discover(request);
    const shell = await getText(request, abs("/shop2/"), "the shell");
    const token = currentToken(shell);

    /* Two families, because next.config.ts sets two policies: /shop2/* — the
       storefront and the admin panel, the one screen a stranger's text reaches
       — gets a script-src with no 'unsafe-inline' at all, and that is the rule
       that turns an innerHTML mistake into a broken layout instead of a
       takeover (docs/audit/security-api.md H5). Everything else keeps
       'unsafe-inline' for the legacy /shop/p/ pages' inline handover script. */
    const cases: Array<{ url: string; strict: boolean }> = [
      { url: abs("/shop2/"), strict: true },
      ...kinds.filter((k) => k.kind === "product").map((k) => ({ url: abs(k.path), strict: true })),
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

      /* The camera and the microphone are the two permissions /shop2/* opens
         — the admin's barcode scanner and the assistant's voice input — and
         `(self)` is the whole of each opening: no third party and no
         cross-origin frame gets either. Everywhere else, and every other
         permission everywhere, stays denied. */
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
          `${url}: /shop2/* must never allow an inline script — this is the policy the audit asked for`,
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
