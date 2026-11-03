/**
 * Which requests src/middleware.ts runs for — the `config.matcher` it
 * exports, worked out here and copied there.
 *
 * 03.11.2026, Vercel: «used 90% of the included free tier usage for Fluid
 * Active CPU (4 hours)», and half of it was the middleware, which ran before
 * every page view (≈6,400 a day, ≈36 ms of CPU each) although it does
 * something for few of them: an address that has to move (a 301), an
 * unprefixed page for a browser that wants Russian or Estonian (a 302), and a
 * catalogue product the owner switched off (a 404). Every other page view
 * went in and came out untouched. Vercel's routing can decide most of that
 * before any code runs — by the path, a cookie and a header — so the matcher
 * now leaves out what the middleware would only let through:
 *
 *  - the pages at their own canonical address (everyoneEntries below): the homes,
 *    sections, subcollections, brands, the policy pages, the blog and its
 *    articles, the screens, the panel and the hand-written pages;
 *  - and, of those, the unprefixed ones too — unless the request carries the
 *    switcher's cookie or an Accept-Language that names Russian or Estonian
 *    (LANG_ENTRIES), the only case the middleware's language step acts on.
 *
 * Products always run it (the hidden check), and so does everything that is
 * not a canonical page — every spelling legacyTarget() moves, every address
 * the shop has no page for. tests/middleware-matcher.test.ts replays the
 * middleware's own decision for every address of Shopify's sitemap and every
 * page of the shop, misspelt a dozen ways, under every cookie and
 * Accept-Language, and holds src/middleware.ts to exactly this list.
 *
 * One thing it cannot keep: Vercel's router matches without regard to case,
 * so a canonical page asked for in capitals (/ET/collections/juuksehooldus)
 * now gets the page — whose canonical names the lower-case address — instead
 * of the middleware's 301 to it. Nothing in Shopify's sitemap is spelt so.
 *
 * Nothing here reads
 * the catalogue: a collection handle is excluded by its SHAPE, minus the
 * handles that do move — Shopify's other collection names, a section's or a
 * subcollection's spelling in another language, a brand Shopify spelled
 * differently — so a brand Renat adds is covered without touching this file.
 *
 * Next reads the matcher at build time from src/middleware.ts as literals
 * (it cannot import), which is why the list is copied rather than imported.
 */
import { COLLECTION_CAT, SHOPIFY_ARTICLES, legacyTarget } from "@/lib/legacy-redirects";
import {
  BRAND_HANDLES,
  CAT_HANDLES,
  INFO_PATHS,
  LANG_COOKIE,
  RESERVED_COLLECTIONS,
  SUB_HANDLES,
} from "@/lib/shop-paths.mjs";

type Lang = "EN" | "RU" | "ET";
const PREFIX: Readonly<Record<Lang, string>> = { EN: "", RU: "ru/", ET: "et/" };
const ANY_PREFIX = "(?:ru/|et/)?";
/** A handle or slug as the shop spells one: lower-case words and hyphens. */
const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";

/** Every collection handle that could be anything but a brand page at its own address. */
function collectionCandidates(): string[] {
  const out = new Set<string>(["vendors", ...RESERVED_COLLECTIONS, ...Object.keys(COLLECTION_CAT)]);
  for (const per of Object.values(CAT_HANDLES) as Array<Record<Lang, string>>) for (const h of Object.values(per)) out.add(h);
  for (const per of Object.values(SUB_HANDLES) as Array<Record<Lang, string>>) for (const h of Object.values(per)) out.add(h);
  for (const [slug, h] of Object.entries(BRAND_HANDLES)) out.add(slug).add(h);
  return [...out].sort();
}

/** The collection handles that move when asked for under `lang`'s prefix. */
export function movingCollections(lang: Lang): string[] {
  return collectionCandidates().filter((h) => legacyTarget("/" + PREFIX[lang] + "collections/" + h) !== null);
}

/**
 * A collection handle under `lang`'s prefix that is a page at its own address.
 * `end` is what follows the handle where the pattern is used: the end of the
 * path in the matcher, the trailing slash in a slash redirect.
 */
function ownCollection(lang: Lang, end: "$" | "/"): string {
  return `${PREFIX[lang]}collections/(?!(?:${movingCollections(lang).join("|")})${end})${SLUG}`;
}

/** The canonical page addresses other than the collections and the bare homes. */
function otherPages(end: "$" | "/"): string[] {
  const info = Object.values(INFO_PATHS).map((p) => String(p).slice(1)).sort();
  const articles = [...SHOPIFY_ARTICLES].sort();
  return [
    `${ANY_PREFIX}(?:${info.join("|")})`,
    `${ANY_PREFIX}blogs/news(?:/(?!(?:${articles.join("|")})${end})${SLUG})?`,
    `${ANY_PREFIX}(?:search|account|cart|checkout(?:/done)?)`,
    "admin(?:/scan)?",
    "cards|golive|handover",
  ];
}

/** What the matcher never looks at: the API, Next's own files, any file with an extension. */
const EXT = ".*\\.[A-Za-z0-9]+$";
const NEVER = `api(?:/|$)|_next/|${EXT}`;

/**
 * Every address the middleware has a job at, whoever asks — as four entries,
 * because Next refuses a matcher source over 4,096 characters: one per
 * language's collections, where a handle is left out unless it moves, and one
 * for everything else, where the canonical pages are left out.
 */
export function everyoneEntries(): string[] {
  const collections = (["EN", "RU", "ET"] as const).map(
    (lang) => `/${PREFIX[lang]}collections/((?!${EXT}|(?!(?:${movingCollections(lang).join("|")})$)${SLUG}$).*)`,
  );
  const pages = ["(?:ru|et)?", ...otherPages("$")].join("|");
  return [...collections, `/((?!${NEVER}|${ANY_PREFIX}collections/|(?:${pages})$).*)`];
}

/**
 * The one move the matcher cannot leave to the middleware: a canonical page
 * asked for with a trailing slash. Next hands the matcher the path WITHOUT
 * its slash (`next dev` measured 03.11.2026: /ru/ and /collections/hair-care/
 * never reached the middleware), so /ru/ looks like /ru and is left out —
 * while the middleware itself, when it runs, still sees the slash. A config
 * redirect does see it, and runs before the middleware: so these are the
 * same 301 to the same slashless address, query kept, that legacyTarget()
 * answers for them ("slash"). next.config.ts reads them from
 * src/data/slash-redirects.json; tests/middleware-matcher.test.ts holds the
 * file to this list.
 */
export function slashRedirects(): Array<{ source: string; destination: string; statusCode: 301 }> {
  const own = (["EN", "RU", "ET"] as const).map((lang) => ownCollection(lang, "/"));
  return [
    { source: "/:page(ru|et)/", destination: "/:page", statusCode: 301 },
    ...own.map((p) => ({ source: `/:page(${p})/`, destination: "/:page", statusCode: 301 as const })),
    { source: `/:page(${otherPages("/").join("|")})/`, destination: "/:page", statusCode: 301 },
  ];
}

/** The unprefixed storefront addresses — where the language step can act. */
const UNPREFIXED = `/((?!${NEVER}|ru(?:/|$)|et(?:/|$)|admin(?:/|$)|(?:cards|golive|handover)$).*)`;
const RU_OR_ET = "(?:[rR][uU]|[eE][tT])";
const ASKS_RU_OR_ET = `.*${RU_OR_ET}.*`;

/**
 * The language step's three cases (wantedLang() in src/middleware.ts): the
 * saved choice is Russian or Estonian; there is no saved choice and the
 * browser names one of them; the saved choice is not a language we know and
 * the browser names one. A saved `en` is never redirected, whatever the
 * browser says, so it needs no entry. `has` values are whole-value regular
 * expressions (Next anchors them with ^…$).
 */
export const LANG_ENTRIES = [
  { source: UNPREFIXED, has: [{ type: "cookie", key: LANG_COOKIE, value: RU_OR_ET }] },
  {
    source: UNPREFIXED,
    has: [{ type: "header", key: "accept-language", value: ASKS_RU_OR_ET }],
    missing: [{ type: "cookie", key: LANG_COOKIE }],
  },
  {
    source: UNPREFIXED,
    has: [
      { type: "header", key: "accept-language", value: ASKS_RU_OR_ET },
      { type: "cookie", key: LANG_COOKIE, value: "(?!(?:[rR][uU]|[eE][tT]|[eE][nN])$).*" },
    ],
  },
] as const;

/**
 * Shopify's names that still have to move although they carry a dot. The
 * sitemaps were `/sitemap_:name*` until 03.11.2026, which never matched
 * `/sitemap_products_1.xml` — those answered 404 instead of legacyTarget()'s
 * 301 to /sitemap.xml.
 */
export const DOTTED_ENTRIES = ["/(sitemap_.*)", "/agents.md", "/(.*\\.atom)"] as const;

/** The whole matcher, as src/middleware.ts must spell it. */
export function middlewareMatcher() {
  return [...everyoneEntries(), ...LANG_ENTRIES, ...DOTTED_ENTRIES];
}
