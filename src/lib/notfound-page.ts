/**
 * «Страница не найдена» — the shop's own 404, written at request time.
 *
 * Until 07.09.2026 every unrecognised `/shop2/…` address answered **200**
 * with the home page: the `/shop2/:path+` fallback rewrite in next.config.ts
 * hands the shell to anything it does not otherwise route, and app.js's
 * router ended its cascade on `S.screen = "home"`. That is a soft 404 — the
 * one thing Google asks a site not to do, because a page that says "found"
 * while showing something else is indexed, then quietly dropped, and it drags
 * the neighbours it links to down with it. A customer following a stale link
 * fared no better: the shop simply looked like it had forgotten the page.
 *
 * Dim's answer (07.09.2026) was «Make a page not found». So:
 *
 *   · the status is a real 404, from `src/app/shop2/[...path]/route.ts`;
 *   · the body is the shop's own 404 screen, in the page's own language,
 *     with a link home and a link to the catalogue;
 *   · the head says `noindex, nofollow` — whatever `PUBLIC_BASE_URL` says
 *     about every other page (docs/seo.md § «The three noindex layers»);
 *   · app.js agrees once it boots: routeFromPath() ends on
 *     `S.screen = "notfound"` and screenNotFound() paints the same words on
 *     the same address.
 *
 * What is NOT a 404 is decided by `isKnownShopPath()` below — deliberately the
 * same set of shapes app.js's router accepts, so the server and the script
 * never disagree about whether an address exists.
 *
 * One shape answers differently in the two, on purpose. `set/<id>` is accepted
 * by app.js's router whatever the id, because the list of sets arrives from
 * /api/bundles/ a moment after boot and deciding a route from data that has
 * not landed used to turn an old link into the home page; screenBundle() then
 * says «Набор не найден» rather than bouncing. The server has the row in front
 * of it and no such excuse, so it answers 404 — the same words to the human,
 * and the truth to a crawler, which is the entire point of this file.
 */
import catalogueMin from "@/data/catalogue.min.json";
import legalSlugsGenerated from "@/data/legal-slugs.json";
import { readShell } from "@/lib/product-page";
import {
  baseFrom,
  breadcrumbLD,
  crumbs,
  esc,
  headBlock,
  href,
  langBySeg,
  langNav,
  langPath,
  OG_DEFAULT,
  patchShell,
  ROBOTS_CLOSED,
  slugify,
  T,
} from "@/lib/seo-head.mjs";

type Lang = { code: "RU" | "ET" | "EN"; seg: string; tag: string; htmlLang: string; ogLocale: string };

const HTML = "text/html; charset=utf-8";
/* Never cached: the same address can start answering 200 the moment the
   owner publishes a product or a post with that slug. */
const NO_STORE = "no-store";

/* ---------- what exists, and what does not ------------------------------- */

type MinProduct = { id: string; b: string; c: string };
const CATALOGUE = catalogueMin as MinProduct[];

/** The catalogue's own section keys, plus the `all` pseudo-section. */
const CATEGORIES = new Set<string>(["all", ...CATALOGUE.map((p) => p.c)]);
/** Every brand slug the catalogue has a page for — the same slugify() the prerender uses. */
const BRAND_SLUGS = new Set<string>(CATALOGUE.map((p) => slugify(p.b)));

/* The five policy slugs, derived rather than copied here, so they cannot
   drift from the pages that exist: tools/pack-legal.mjs writes this file in
   `prebuild` from `Object.keys(LEGAL)` in public/shop/legal.js — the exact
   expression tools/prerender-shop2.mjs uses to decide which
   public/shop2/info/<slug>/ directories to write, and the list app.js's own
   router gates on.

   Until 08.09.2026 this function read those directories at request time,
   which is the same list one step later and one step too late: only
   public/shop2/index.html is traced into the function bundle
   (`outputFileTracingIncludes` in next.config.ts), so the readdir always
   failed in a deployment, the check fell through to "let every slug through",
   and /shop2/info/<anything>/ answered 200 with the shell — a soft 404,
   unbounded in number, measured against staging. A check that works on the
   developer's disk and nowhere else is worse than no check: it reads as done.
   A module the source names is traced because the source names it. */
const LEGAL_SLUGS = new Set<string>(legalSlugsGenerated as string[]);

/**
 * `/shop2/et/c/hair/` → `{ seg: "et", segs: ["c", "hair"] }`.
 * Null when the path is not under `/shop2` at all (nothing else reaches here).
 */
export function shopPath(pathname: string): { seg: string; segs: string[] } | null {
  const clean = String(pathname || "").split("?")[0];
  if (!/^\/shop2(\/|$)/.test(clean)) return null;
  let rest = clean.replace(/^\/shop2/, "").replace(/^\/+|\/+$/g, "");
  let seg = "";
  const m = /^(et|en|ru)(?:\/|$)/i.exec(rest);
  if (m) {
    // /shop2/ru/… is 301'd to the unprefixed path by next.config.ts; accepted
    // here for the same reason app.js's router accepts it — a hand-typed URL.
    seg = m[1].toLowerCase() === "ru" ? "" : m[1].toLowerCase();
    rest = rest.slice(m[1].length).replace(/^\/+/, "");
  }
  const segs = rest ? rest.split("/").map((s) => decodeSafe(s)) : [];
  return { seg, segs };
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/* The screens that exist without a file behind them. Six of them need state
   to mean anything and are robots-disallowed; `brands` is a real landing.
   `scan` and `admin` are the owner's, and answering 404 for them would be a
   lie about a page that does exist. */
const CLIENT_SCREENS = new Set(["search", "brands", "account", "checkout", "done", "admin", "scan"]);
/* The single pages the prerender writes. Listed so a tree that has not been
   prerendered still serves them — the same reason next.config.ts lists them
   off disk rather than assuming. */
const SINGLE_PAGES = new Set(["sets", "gift", "blog"]);

/**
 * Does the shop have a page at this address? The shapes are app.js's
 * `routeFromPath()` cascade, in the same order, so the server's 404 and the
 * script's 404 are the same answer.
 *
 * `p/<id>` and `blog/<slug>` are accepted without checking the id: a custom
 * product and a post both live in the database, they each have their own
 * request-time route that answers 404 for an id nobody has
 * (src/app/shop2/{,et/,en/}p/[id] and .../blog/[slug]), and guessing here
 * from a build-time file would 404 a page the owner published an hour ago.
 * `set/<id>` used to be in that sentence too and had no such route behind it,
 * so every id anybody typed answered 200 with the shell — the soft 404 this
 * whole file exists to remove, measured against staging on 08.09.2026. Sets
 * are owner-editable (the `bundles` table), so a build-time list would go
 * stale the same way; the id is asked of the database instead, in
 * notFoundPageResponse() below, exactly as a brand is.
 *
 * Categories and policy slugs are closed sets known at build time, so those
 * are checked here; brands are only half closed (see below).
 */
export function isKnownShopPath(segs: string[]): boolean {
  if (segs.length === 0) return true; // the home page in one of the three languages
  const [kind, id] = segs;
  if (segs.length === 1) return CLIENT_SCREENS.has(kind) || SINGLE_PAGES.has(kind);
  if (segs.length !== 2 || !id) return false;
  if (kind === "p" || kind === "blog") return true;
  if (kind === "c") return CATEGORIES.has(id);
  /* Brands are the one set that is only half closed. The catalogue's brands
     are known here; a brand the owner typed on a product of his own is not,
     and is asked of the database by notFoundPageResponse() below. Deciding it
     from the catalogue alone 404s a page the shop really serves — found by
     e2e/admin-products.spec.ts on 07.09.2026, where a new product's brand page
     answered 404 while the product's own page answered 200. */
  if (kind === "b") return BRAND_SLUGS.has(id);
  if (kind === "info") return LEGAL_SLUGS.has(id);
  return false;
}

/* ---------- the page ----------------------------------------------------- */

function notFoundContent(lang: Lang): string {
  const t = T[lang.code];
  return (
    '<div class="wrap wrap--narrow">' +
    crumbs([[t.home, href(lang.seg, "/")], [t.notFound, null]]) +
    '<section class="sec nf">' +
    '<p class="nf__code num" aria-hidden="true">404</p>' +
    '<h1 class="display h1">' +
    esc(t.notFound) +
    "</h1>" +
    '<p class="sec__intro">' +
    esc(t.notFoundText) +
    "</p>" +
    '<p><a href="' +
    href(lang.seg, "/") +
    '">' +
    esc(t.home) +
    '</a> · <a href="' +
    href(lang.seg, "/c/all/") +
    '">' +
    esc(t.all) +
    "</a></p>" +
    "</section>" +
    langNav(lang.seg, "/", t) +
    "</div>"
  );
}

/**
 * The 404 page for one address. `rest` is the path under `/shop2` (with its
 * leading slash and a trailing one), used only for the canonical — which is
 * this address itself, carrying `noindex`, rather than a canonical pointing
 * at the home page, which is what the shell used to claim.
 */
export function renderNotFoundPage(shell: string, lang: Lang, rest: string, base: string): string {
  const t = T[lang.code];
  const head = headBlock({
    base,
    robots: ROBOTS_CLOSED,
    lang,
    seg: lang.seg,
    rest,
    title: t.notFound + " — REMPIRE",
    desc: t.notFoundText,
    image: base + OG_DEFAULT,
    imageAlt: "REMPIRE",
    ogType: "website",
    jsonld: [breadcrumbLD(base, [[t.home, langPath(lang.seg, "/")], [t.notFound, null]])],
    // no Product here, so nothing takes the id="ldjson" slot setHead() owns
    ldMain: false,
  });
  return patchShell(shell, head, notFoundContent(lang), lang.htmlLang);
}

/**
 * GET anything under `/shop2/` that has no page: the shell, patched into the
 * 404 screen, at HTTP 404. A path the shop *does* serve client-side gets the
 * plain shell at 200 — that is the behaviour every one of those screens has
 * always had.
 */
/**
 * Is this a brand only the owner's own products carry? Asked only when the
 * catalogue has never heard of the slug, so a shop without custom products
 * never reaches the database from here. A database that is down answers
 * "maybe": serving the shell at 200 is the older, softer wrong answer, and a
 * far better one than telling a crawler that a real brand page is gone because
 * Postgres blinked.
 */
async function isCustomBrand(slug: string): Promise<boolean> {
  try {
    const { listCustomProducts } = await import("@/lib/custom-products");
    const rows = await listCustomProducts({ activeOnly: true });
    return rows.some((r) => slugify(r.brand) === slug);
  } catch (err) {
    console.error("[notfound] custom brands unavailable:", err);
    return true;
  }
}

/**
 * Does the shop sell a set with this id? The same question as the brand above
 * and answered the same way, because a set has the same shape of life: the
 * owner creates, renames and hides one in the panel (`bundles`,
 * db/migrations/120), so no list written at build time can be trusted, and
 * asking the row is the only honest answer.
 *
 * The eight sets that shipped with the build have a prerendered page each, and
 * the static layer serves those before this route is reached — so what arrives
 * here is a set created after the build, one the owner switched off, or an id
 * nobody ever had. `active` is what separates the first from the other two:
 * /api/bundles/ is active-only, so a hidden set is «Набор не найден» in the
 * browser as well, and the status now says the same thing.
 *
 * A database that is down answers "maybe", for the reason the brand check
 * does: the shell at 200 is the older, softer wrong answer, and a far better
 * one than telling a crawler that a real set is gone because Postgres blinked.
 */
async function isPublishedSet(id: string): Promise<boolean> {
  try {
    const { getBundle } = await import("@/lib/bundles");
    const row = await getBundle(id);
    return !!row && row.active;
  } catch (err) {
    console.error("[notfound] sets unavailable:", err);
    return true;
  }
}

export async function notFoundPageResponse(pathname: string): Promise<Response> {
  const shell = readShell();
  const parsed = shopPath(pathname);
  if (!parsed) return html(shell, 200);

  const lang = (langBySeg(parsed.seg) as Lang | null) ?? (langBySeg("") as Lang);
  if (isKnownShopPath(parsed.segs)) return html(shell, 200);
  /* The two shapes whose ids only the database knows, asked only once the
     closed lists above have said no. A brand slug reaches Postgres only when
     the catalogue has never heard of it; a set id reaches it whenever the
     static layer did not already answer with a prerendered page, which is
     what the request-time question is for. */
  if (parsed.segs.length === 2) {
    const [kind, id] = parsed.segs;
    if (kind === "b" && (await isCustomBrand(id))) return html(shell, 200);
    if (kind === "set" && (await isPublishedSet(id))) return html(shell, 200);
  }

  /* The canonical is the address that was asked for, normalised the way the
     rest of the shop writes one: lower-cased prefix, one trailing slash. */
  const rest = "/" + parsed.segs.map((s) => encodeURIComponent(s)).join("/") + "/";
  const base = baseFrom(process.env.PUBLIC_BASE_URL);
  return html(renderNotFoundPage(shell, lang, rest, base), 404);
}

function html(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": HTML, "cache-control": NO_STORE } });
}
