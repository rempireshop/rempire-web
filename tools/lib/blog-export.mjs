/* Reads published blog posts straight out of Postgres, for
   tools/prerender-shop2.mjs — a build-time-only concern, so it talks to `pg`
   directly rather than going through src/lib/db.ts (that module is written
   for the Next.js server, not for a standalone script, and pulling it in
   here would also pull in its PGlite branch for no reason).

   Nothing here trusts DATABASE_URL to be set: fetchPublishedPosts() returns
   an empty list when it is not, and the caller (prerender-shop2.mjs) treats
   that exactly like "no bundles" or "no legal.en.js" — a build without a
   database configured simply does not get blog pages, and says so once.

   markdownToHtml()/pickLang() below are a deliberate, commented duplicate of
   the same-named functions in src/lib/blog.ts (same rule as stripTags() in
   public/shop2/app.js, which prerender-shop2.mjs also keeps a twin of): a
   plain .mjs tool cannot import a TypeScript module with no build step, and
   the alternative — lifting the source text out of blog.ts and eval-ing it,
   the trick this file's sibling uses for app.js's UI dictionary — only works
   on plain JavaScript, and blog.ts is typed. Keep the two in sync by hand;
   tests/blog.test.ts and tests/prerender-blog.test.ts both exercise the
   real (TypeScript) renderer, so a drift here is a wrong prerendered page,
   not a security hole — the live API always serves the real one. */

import { sslFor } from "../migrate.mjs";

const LANGS = ["RU", "ET", "EN"];
const EMPTY3 = { RU: "", ET: "", EN: "" };

/** The language shown, falling back to Russian, then to whatever exists. */
export function pickLang(t, lang) {
  const v = t || EMPTY3;
  const L = LANGS.includes(lang) ? lang : "RU";
  return v[L] || v.RU || v.ET || v.EN || "";
}

/* ---------- markdown to HTML — see the file header for why this is a twin
   of markdownToHtml() in src/lib/blog.ts, and not an import of it. ---------- */

const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

function safeUrl(raw) {
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\/[^\s<>"']+$/i.test(v)) return v;
  if (/^mailto:[^\s<>"']+$/i.test(v)) return v;
  if (/^\/(?!\/)[^\s<>"']*$/.test(v)) return v; // "/x" but not "//x"
  return null;
}

function inline(escaped) {
  let s = escaped;
  s = s.replace(/!\[([^\]\n]*)\]\(\s*([^)\s]+)\s*\)/g, (whole, alt, url) => {
    const u = safeUrl(url);
    return u ? `<img src="${u}" alt="${alt}" loading="lazy">` : whole;
  });
  s = s.replace(/\[([^\]\n]*)\]\(\s*([^)\s]+)\s*\)/g, (whole, text, url) => {
    const u = safeUrl(url);
    if (!u) return whole;
    const ext = /^https?:\/\//i.test(u) ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a href="${u}"${ext}>${text || u}</a>`;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  s = s.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  return s;
}
function para(text) {
  const t = text.trim();
  return t ? `<p>${inline(escapeHtml(t))}</p>` : "";
}

function parseBlocks(md) {
  const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { blocks.push({ kind: "h", level: h[1].length, text: h[2] }); i++; continue; }

    if (/^>\s?/.test(line)) {
      const qlines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { qlines.push(lines[i].replace(/^>\s?/, "")); i++; }
      blocks.push({ kind: "quote", lines: qlines });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, "")); i++; }
      blocks.push({ kind: "ul", items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, "")); i++; }
      blocks.push({ kind: "ol", items });
      continue;
    }

    const plines = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s+/.test(lines[i]) &&
           !/^>\s?/.test(lines[i]) && !/^[-*]\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i])) {
      plines.push(lines[i]); i++;
    }
    blocks.push({ kind: "p", lines: plines });
  }
  return blocks;
}

function renderBlock(b) {
  if (b.kind === "h") {
    const lvl = Math.min(6, Math.max(1, b.level));
    return `<h${lvl}>${inline(escapeHtml(b.text.trim()))}</h${lvl}>`;
  }
  if (b.kind === "quote") return `<blockquote>${para(b.lines.join(" "))}</blockquote>`;
  if (b.kind === "ul" || b.kind === "ol") {
    const items = b.items.map((it) => `<li>${inline(escapeHtml(it.trim()))}</li>`).join("");
    return `<${b.kind}>${items}</${b.kind}>`;
  }
  return para(b.lines.join(" "));
}

function stripDangerous(html) {
  return html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

export function markdownToHtml(md) {
  const html = parseBlocks(md).map(renderBlock).filter(Boolean).join("");
  return stripDangerous(html);
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
      `select id, slug, title, excerpt, body, cover_url, cover_alt, tags, products,
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
