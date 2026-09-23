/* Reads published blog posts straight out of Postgres, for
   tools/prerender-shop2.mjs — a build-time-only concern, so it talks to `pg`
   directly rather than going through src/lib/db.ts (that module is written
   for the Next.js server, not for a standalone script, and pulling it in
   here would also pull in its PGlite branch for no reason).

   Nothing here trusts DATABASE_URL to be set: fetchPublishedPosts() returns
   an empty list when it is not, and the caller (prerender-shop2.mjs) treats
   that exactly like "no bundles" or "no legal.en.js" — a build without a
   database configured simply does not get blog pages, and says so once.

   renderPostBody()/sanitizeHtml()/markdownToHtml()/looksLikeHtmlBody() are
   re-exported straight from src/lib/blog-html.mjs — not a copy of the
   renderer the live site uses, the same file. The static page and the page
   the API serves therefore cannot disagree about what an article looks like.

   They were a duplicate until 17.09.2026, and this comment used to argue at
   length that they had to stay one: a plain .mjs tool cannot import a
   TypeScript module with no build step, so keep the two in step by hand.
   The premise is true and the conclusion was still wrong — the answer is to
   not write the shared part in TypeScript. src/lib/seo-head.mjs had been
   doing exactly that since it was written, imported by strict TS routes as
   `@/lib/seo-head.mjs` and by this same bare-node build through a relative
   path, with no .d.ts and no build step on either side. It was the only
   .mjs under src/, which is probably why nobody generalised from it.

   What the duplication cost, since that is what the comment should have been
   weighing. «By hand» failed twice, silently, in the same way: an attribute
   added to the real sanitiser and not to the copy here. `data-price` was
   caught by the person who added it. `data-fig` was not — openTag() here
   read attributes for <a> and <img> only, so every <figure> came back bare,
   and the build had been throwing away the size and the placement the owner
   chose for every picture in every prerendered article since those presets
   were built. Both drifts read as a wrong static page and never as a
   security hole — the live API always served the real renderer — which is
   exactly why nothing complained. tests/blog-figure-r22.test.ts runs a
   corpus of bodies through both import paths and demands the same bytes
   from each; with one implementation left it is a regression test rather
   than a tripwire, and the bug it was written for — an attribute that
   exists on one side only — no longer has anywhere to live.

   pickLang(), toPost() and fetchPublishedPosts() below are this module's
   own. pickLang() is still a twin of the one in src/lib/blog.ts: four lines
   of fallback that have never drifted and that the renderer does not need.
   The other two are the query, which is the actual job of this file. */

import { writeCoverFocus } from "../../src/lib/blog-cover.mjs";
import { sslFor } from "../migrate.mjs";
export {
  looksLikeHtmlBody,
  markdownToHtml,
  renderPostBody,
  sanitizeHtml,
} from "../../src/lib/blog-html.mjs";
/* …and the cover's own one-file module, for the same reason. */
export { containingCrop, coverImgStyle } from "../../src/lib/blog-cover.mjs";

const LANGS = ["RU", "ET", "EN"];
const EMPTY3 = { RU: "", ET: "", EN: "" };

/** The language shown, falling back to Russian, then to whatever exists. */
export function pickLang(t, lang) {
  const v = t || EMPTY3;
  const L = LANGS.includes(lang) ? lang : "RU";
  return v[L] || v.RU || v.ET || v.EN || "";
}

/* ---------- the query --------------------------------------------------- */

function toPost(r) {
  return {
    id: r.id,
    slug: r.slug,
    title: { ...EMPTY3, ...(r.title || {}) },
    excerpt: { ...EMPTY3, ...(r.excerpt || {}) },
    body: { ...EMPTY3, ...(r.body || {}) },
    coverUrl: r.cover_url || null,
    coverAlt: { ...EMPTY3, ...(r.cover_alt || {}) },
    /* Read raw, then through writeCoverFocus() in src/lib/blog-cover.mjs, so
       a row this vocabulary does not recognise arrives here as null — the
       same answer src/lib/blog.ts gives the live page for the same row. This
       is the field the build dropped on the floor for a whole round the last
       time a copy of a renderer lived here (see the header): the prerendered
       article would have fitted the picture whole while the live one cropped
       it, and nobody would have seen the difference without publishing. */
    coverFocus: writeCoverFocus(r.cover_focus),
    tags: Array.isArray(r.tags) ? r.tags : [],
    products: Array.isArray(r.products) ? r.products : [],
    seoTitle: { ...EMPTY3, ...(r.seo_title || {}) },
    seoDesc: { ...EMPTY3, ...(r.seo_desc || {}) },
    author: r.author || "Rempire",
    publishedAt: r.published_at instanceof Date ? r.published_at.toISOString() : r.published_at,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  };
}

/**
 * Every published post, newest first. `[]` when DATABASE_URL is not set, or
 * when the database could not be reached — either way `npm run prerender`
 * keeps going and simply writes no blog pages this run (see the header
 * comment); the live API and the SPA are unaffected either way.
 */
export async function fetchPublishedPosts() {
  const url = process.env.DATABASE_URL;
  if (!url) return [];

  let pg;
  try {
    ({ default: pg } = await import("pg"));
  } catch {
    console.warn("! blog-export: the 'pg' package is not installed — no blog pages this run");
    return [];
  }

  const client = new pg.Client({ connectionString: url, ssl: sslFor(url) });
  try {
    await client.connect();
    const res = await client.query(
      `select id, slug, title, excerpt, body, cover_url, cover_alt, cover_focus, tags, products,
              seo_title, seo_desc, author, published_at, updated_at
         from posts
        where status = 'published'
        order by published_at desc nulls last, created_at desc`,
    );
    return res.rows.map(toPost);
  } catch (err) {
    console.warn("! blog-export: could not read posts (" + (err && err.message) + ") — no blog pages this run");
    return [];
  } finally {
    await client.end().catch(() => {});
  }
}
