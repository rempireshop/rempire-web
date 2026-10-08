/* IndexNow — telling Bing, Yandex, Seznam, Naver and the others that a page
   changed, instead of waiting for their crawlers to come round.

   One POST to https://api.indexnow.org/indexnow shares the list with every
   engine that takes part (https://www.indexnow.org/documentation). Google does
   not take part; it reads the sitemaps. The protocol proves the site is ours
   with a KEY: a file at https://rempireshop.com/<key>.txt whose whole content
   is the key. Keys are public by design — anyone can read the file — so the
   key is a constant committed here and the file is public/<key>.txt;
   tests/indexnow.test.ts holds the two equal.

   Who calls this:
     · src/lib/indexnow-ping.ts — submitIndexNow(), the fire-and-forget the
       admin routes call when the owner publishes, edits or hides a product, a
       blog post or a set;
     · tools/indexnow-submit.mjs — once after a deploy, every URL of the
       production sitemap.

   Plain ESM with no imports beyond its two siblings, like seo-head.mjs: the
   bare-`node` CLI and the Next routes import it unchanged. Nothing here reads
   the environment except indexNowEnabled(), and that only from the object it
   is handed. */

import { isLiveBase, LIVE_ORIGIN } from "./seo-head.mjs";
import { publicPath } from "./shop-paths.mjs";

/** The shop's IndexNow key — public by design; public/<key>.txt serves it. */
export const INDEXNOW_KEY = "164a851b1f1b4b40060d4102b1aff9e8";
/** The one host the key file is on, and the only host a URL list may name. */
export const INDEXNOW_HOST = "rempireshop.com";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_KEY_LOCATION = LIVE_ORIGIN + "/" + INDEXNOW_KEY + ".txt";
/** The protocol takes up to 10 000 URLs in one POST. */
export const INDEXNOW_MAX_URLS = 10000;

/* ---------- which addresses a change touches ---------------------------- */

/* The three languages of one internal route, on the live origin — English
   unprefixed, /ru, /et (src/lib/shop-paths.mjs). */
const CODES = ["EN", "RU", "ET"];
export const routeUrls = rest => CODES.map(code => LIVE_ORIGIN + publicPath(code, rest));

/** A product's page in all three languages (a catalogue id or a custom `c-…`). */
export const productUrls = id => routeUrls("/p/" + encodeURIComponent(String(id)) + "/");
/** An article in all three languages, and the listing it appears in. */
export const blogPostUrls = slug => [...routeUrls("/blog/" + encodeURIComponent(String(slug)) + "/"), ...routeUrls("/blog/")];
/** A set in all three languages, and the sets landing it appears on. */
export const setUrls = id => [...routeUrls("/set/" + encodeURIComponent(String(id)) + "/"), ...routeUrls("/sets/")];

/* ---------- the request -------------------------------------------------- */

/** The URLs the protocol will take from us: absolute, on rempireshop.com, once each. */
export function ownUrls(urls) {
  const out = [];
  const seen = new Set();
  for (const raw of urls || []) {
    let u;
    try { u = new URL(String(raw)); } catch { continue; }
    if (u.protocol !== "https:" || u.hostname !== INDEXNOW_HOST) continue;
    const s = u.href;
    if (!seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

/** The JSON bodies for a list, at most INDEXNOW_MAX_URLS URLs each. */
export function indexNowBodies(urls) {
  const list = ownUrls(urls);
  const out = [];
  for (let i = 0; i < list.length; i += INDEXNOW_MAX_URLS) {
    out.push({
      host: INDEXNOW_HOST,
      key: INDEXNOW_KEY,
      keyLocation: INDEXNOW_KEY_LOCATION,
      urlList: list.slice(i, i + INDEXNOW_MAX_URLS),
    });
  }
  return out;
}

/**
 * POST the list, batch by batch, and say what each batch got back:
 * 200 OK, 202 accepted (the key is still being checked), 400 bad request,
 * 403 the key file does not match, 422 a URL is not the host's, 429 too many.
 * Throws only what `fetch` throws (a network error, the timeout).
 */
export async function postIndexNow(urls, opts) {
  const fetchImpl = (opts && opts.fetch) || globalThis.fetch;
  const timeoutMs = (opts && opts.timeoutMs) || 8000;
  const results = [];
  for (const body of indexNowBodies(urls)) {
    const res = await fetchImpl(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    results.push({ status: res.status, count: body.urlList.length });
  }
  return results;
}

/**
 * May this deployment tell the engines anything? Only the production shop:
 * a production server (`next start` / Vercel — never `next dev`, never the
 * test suite, which sets the live base URL all the time), $PUBLIC_BASE_URL on
 * rempireshop.com (isLiveBase(), the switch that opens robots too) and, on
 * Vercel, the production environment — a preview that inherited the live
 * base URL must not announce pages that are not live.
 */
export function indexNowEnabled(env) {
  const e = env || {};
  if (e.NODE_ENV !== "production") return false;
  if (!isLiveBase(e.PUBLIC_BASE_URL)) return false;
  if (e.VERCEL_ENV && e.VERCEL_ENV !== "production") return false;
  return true;
}

/* ---------- the sitemap, for the CLI ------------------------------------- */

const XML_ENTITY = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = s => String(s).replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => XML_ENTITY[e]).trim();

/**
 * The addresses a sitemap names: `{ sitemaps, urls }` — the child sitemaps
 * of a <sitemapindex>, the pages of a <urlset>. Only each entry's own <loc>:
 * the xhtml:link alternates beside it are the same pages in the other
 * languages, which have <url> entries of their own.
 */
export function sitemapLocs(xml) {
  const src = String(xml || "");
  const pick = tag => [...src.matchAll(new RegExp("<" + tag + ">\\s*<loc>([^<]+)</loc>", "g"))].map(m => unxml(m[1]));
  return { sitemaps: pick("sitemap"), urls: pick("url") };
}
