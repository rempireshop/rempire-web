/* Reads published blog posts straight out of Postgres, for
   tools/prerender-shop2.mjs — a build-time-only concern, so it talks to `pg`
   directly rather than going through src/lib/db.ts (that module is written
   for the Next.js server, not for a standalone script, and pulling it in
   here would also pull in its PGlite branch for no reason).

   Nothing here trusts DATABASE_URL to be set: fetchPublishedPosts() returns
   an empty list when it is not, and the caller (prerender-shop2.mjs) treats
   that exactly like "no bundles" or "no legal.en.js" — a build without a
   database configured simply does not get blog pages, and says so once.

   renderPostBody()/sanitizeHtml()/markdownToHtml()/pickLang() below are a
   deliberate, commented duplicate of
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

/* ---------- HTML bodies — the twin of sanitizeHtml() in src/lib/blog.ts.
   Read that function's block comment for the allowlist and the safety
   argument; this copy exists for the same reason markdownToHtml() above
   does. ------------------------------------------------------------------ */

const HTML_ALLOWED = {
  p: true, h2: true, h3: true, strong: true, em: true, ul: true, ol: true, li: true,
  blockquote: true, figure: true, br: true, a: true, img: true,
};
const HTML_VOID = new Set(["br", "img"]);
const HTML_DROP = new Set([
  "script", "style", "iframe", "object", "embed", "noscript", "template",
  "svg", "math", "head", "title", "xml",
]);
const HTML_ALIAS = { b: "strong", i: "em", h1: "h2", h4: "h3", h5: "h3", h6: "h3" };
const MAX_DEPTH = 24;
const TAG_RE = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
const PRODUCT_ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const BARE_AMP = /&(?!#\d{1,7};|#[xX][0-9a-fA-F]{1,6};|[a-zA-Z][a-zA-Z0-9]{1,31};)/g;

function escapeText(s) {
  return s.replace(BARE_AMP, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeUrlAttr(u) {
  return u.replace(BARE_AMP, "&amp;");
}
function safeImageUrl(raw) {
  const v = String(raw || "").trim();
  if (/^https:\/\/[^\s<>"']+$/i.test(v)) return v;
  if (/^\/(?!\/)[^\s<>"']*$/.test(v)) return v;
  return null;
}
function parseAttrs(raw) {
  const out = {};
  const s = raw.replace(/\/\s*$/, "");
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(s))) {
    const key = m[1].toLowerCase();
    let v = m[2] || "";
    if (v.length > 1 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
      v = v.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = v;
  }
  return out;
}
function openTag(name, attrsRaw) {
  if (name !== "a" && name !== "img") return `<${name}>`;
  const attrs = parseAttrs(attrsRaw);
  if (name === "img") {
    const src = safeImageUrl(attrs.src || "");
    if (!src) return null;
    const alt = escapeHtml(String(attrs.alt || "").replace(/\s+/g, " ").trim().slice(0, 160));
    return `<img src="${escapeUrlAttr(src)}" alt="${alt}" loading="lazy">`;
  }
  let out = "<a";
  const pid = String(attrs["data-product"] || "").trim();
  if (PRODUCT_ID_RE.test(pid)) out += ` data-product="${pid}"`;
  const href = attrs.href ? safeUrl(attrs.href) : null;
  if (href) {
    out += ` href="${escapeUrlAttr(href)}"`;
    if (/^https?:\/\//i.test(href)) out += ' target="_blank" rel="noopener noreferrer"';
  }
  return out === "<a" ? null : `${out}>`;
}
function skipElement(src, from, name) {
  const m = new RegExp(`</${name}\\s*>`, "i").exec(src.slice(from));
  return m ? from + m.index + m[0].length : src.length;
}

export function sanitizeHtml(input) {
  const src = String(input || "");
  const out = [];
  const stack = [];
  let i = 0;

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { out.push(escapeText(src.slice(i))); break; }
    if (lt > i) out.push(escapeText(src.slice(i, lt)));

    if (src.startsWith("<!--", lt)) { const e = src.indexOf("-->", lt + 4); i = e < 0 ? src.length : e + 3; continue; }
    if (src.startsWith("<!", lt) || src.startsWith("<?", lt)) { const e = src.indexOf(">", lt); i = e < 0 ? src.length : e + 1; continue; }

    const m = TAG_RE.exec(src.slice(lt));
    if (!m) { out.push("&lt;"); i = lt + 1; continue; }
    i = lt + m[0].length;

    const closing = m[1] === "/";
    const raw = m[2].toLowerCase();
    const name = HTML_ALIAS[raw] || raw;

    if (HTML_DROP.has(raw)) {
      if (!closing) i = skipElement(src, i, raw);
      continue;
    }
    if (!HTML_ALLOWED[name]) continue;

    if (closing) {
      const at = stack.lastIndexOf(name);
      if (at < 0) continue;
      while (stack.length > at) out.push(`</${stack.pop()}>`);
      continue;
    }
    if (HTML_VOID.has(name)) {
      const tag = openTag(name, m[3]);
      if (tag) out.push(tag);
      continue;
    }
    if (stack.length >= MAX_DEPTH) continue;
    const tag = openTag(name, m[3]);
    if (!tag) continue;
    out.push(tag);
    stack.push(name);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return stripDangerous(out.join(""));
}

const HTML_BODY_RE = /^\s*<(?:p|h2|h3|ul|ol|figure|blockquote)(?:\s[^>]*)?>/i;
export function looksLikeHtmlBody(body) {
  return HTML_BODY_RE.test(String(body || ""));
}
/** The one place a stored body becomes HTML — see src/lib/blog.ts. */
export function renderPostBody(body) {
  const src = String(body || "");
  return looksLikeHtmlBody(src) ? sanitizeHtml(src) : markdownToHtml(src);
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
