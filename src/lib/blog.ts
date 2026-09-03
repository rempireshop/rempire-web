/**
 * The shop's blog — articles Renat writes (or the admin assistant drafts for
 * him) in Russian, Estonian and English at once.
 *
 * Storage: db/migrations/070_blog.sql. One row is one article in every
 * language: `title`/`excerpt`/`body`/`coverAlt`/`seoTitle`/`seoDesc` are all
 * `{RU, ET, EN}` objects, exactly like a product's SEO fields elsewhere in
 * this shop. An empty ET or EN string means "show the Russian text" —
 * `pickLang()` is the one place that fallback happens, so the public routes
 * and the prerender tool can never disagree about it.
 *
 * `status` is the only publication switch: 'draft' never appears on the
 * public API or in a prerendered page, 'published' is live. There is no hard
 * delete — `deletePost()` sets status back to 'draft', same as
 * `unpublishPost()`, except it also forgets `publishedAt`, so a post that was
 * genuinely deleted no longer shows up as "was live until…" anywhere. The
 * row and its slug are never gone — an admin who deleted by mistake finds it
 * in the drafts list and can publish it again.
 *
 * Markdown: `markdownToHtml()` is a small hand-written subset — headings,
 * paragraphs, bold/italic, links, lists, images, blockquotes — with no
 * external dependency. Everything else in the source is HTML-escaped, never
 * interpreted, so there is no tag an author (or a prompt-injected assistant
 * reply) can smuggle through. See the comment above that function for the
 * exact safety argument.
 */
import { query } from "@/lib/db";
import type { Lang3, Trilingual } from "@/lib/content";

export const LANGS: readonly Lang3[] = ["RU", "ET", "EN"];

export type PostStatus = "draft" | "published";

export interface Post {
  id: string;
  slug: string;
  status: PostStatus;
  title: Trilingual;
  excerpt: Trilingual;
  body: Trilingual;
  coverUrl: string | null;
  coverAlt: Trilingual;
  tags: string[];
  products: string[];
  seoTitle: Trilingual;
  seoDesc: Trilingual;
  author: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The admin list and the prerender listing page never need the article body. */
export type PostSummary = Omit<Post, "body">;

interface PostRow {
  id: string;
  slug: string;
  status: PostStatus;
  title: Trilingual | null;
  excerpt: Trilingual | null;
  body: Trilingual | null;
  cover_url: string | null;
  cover_alt: Trilingual | null;
  tags: string[] | null;
  products: string[] | null;
  seo_title: Trilingual | null;
  seo_desc: Trilingual | null;
  author: string;
  published_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const EMPTY3: Trilingual = { RU: "", ET: "", EN: "" };
const iso = (d: Date | string | null) => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));

function toPost(r: PostRow): Post {
  return {
    id: r.id,
    slug: r.slug,
    status: r.status,
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
    publishedAt: iso(r.published_at),
    createdAt: iso(r.created_at) as string,
    updatedAt: iso(r.updated_at) as string,
  };
}
function toSummary(r: PostRow): PostSummary {
  const { body: _body, ...rest } = toPost(r);
  void _body;
  return rest;
}

const SUMMARY_COLS =
  "id, slug, status, title, excerpt, cover_url, cover_alt, tags, products, seo_title, seo_desc, author, published_at, created_at, updated_at";
const FULL_COLS = SUMMARY_COLS.replace("excerpt,", "excerpt, body,");

/** The language shown, falling back to Russian, then to whatever exists. */
export function pickLang(t: Trilingual | null | undefined, lang: string): string {
  const v = t || EMPTY3;
  const L = LANGS.includes(lang as Lang3) ? (lang as Lang3) : "RU";
  return v[L] || v.RU || v.ET || v.EN || "";
}

/* ---------- slugs --------------------------------------------------------- */

/** Cyrillic and Estonian letters that do not survive NFKD decomposition. */
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya", і: "i", ї: "yi", ґ: "g",
  ä: "a", ö: "o", ü: "u", õ: "o", š: "s", ž: "z",
};

/**
 * A Russian or Estonian title → a readable Latin slug. Cyrillic and the
 * Estonian õäöüšž go through TRANSLIT letter by letter; anything else with an
 * accent (é, à, …) is flattened by NFKD; whatever is left that is not
 * [a-z0-9] becomes a dash. Never returns an empty string — a title that is
 * all punctuation or emoji falls back to `fallback`, so a post is never
 * created with no address at all.
 */
export function slugify(text: string, fallback = "post"): string {
  const lower = String(text || "").toLowerCase();
  let out = "";
  for (const ch of lower) out += ch in TRANSLIT ? TRANSLIT[ch] : ch;
  out = out.normalize("NFKD").replace(/[̀-ͯ]/g, ""); // any other accent (é, à, ø, …)
  out = out.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "");
  return out || fallback;
}

async function slugExists(slug: string, excludeId?: string): Promise<boolean> {
  const rows = excludeId
    ? await query<{ n: number }>("select 1 as n from posts where slug = $1 and id <> $2 limit 1", [slug, excludeId])
    : await query<{ n: number }>("select 1 as n from posts where slug = $1 limit 1", [slug]);
  return rows.length > 0;
}

/** `base`, or `base-2`, `base-3`, … — the first one nobody else has. */
export async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  const clean = slugify(base);
  let candidate = clean;
  let n = 2;
  while (await slugExists(candidate, excludeId)) {
    candidate = `${clean}-${n}`;
    n += 1;
  }
  return candidate;
}

/* ---------- markdown → safe HTML ------------------------------------------
 *
 * A deliberately small subset, hand-written so there is no dependency to
 * audit: headings (#.. ######), paragraphs, bold (** or __), italic (* or _),
 * [links](url), images (![alt](url)), "- " / "1. " lists, "> " blockquotes.
 * Everything else is not markdown here — it is text, and
 * text is HTML-escaped, never parsed as a tag.
 *
 * Why this is safe against injection (including a prompt-injected assistant
 * reply, since drafts the assistant writes go through this exact renderer
 * the first time a customer opens them):
 *
 *  1. Block structure (heading / quote / list / paragraph) is read off the
 *     RAW line — never off HTML — so escaping never has to "undo" a marker.
 *  2. Every block's own text is HTML-escaped BEFORE any inline markdown
 *     (bold, italic, link, image) is applied. None of the escaped characters
 *     (& < > " ') are markdown syntax, so escaping first cannot break a link
 *     or an emphasis marker, and nothing past that point can introduce a raw
 *     `<`, so no tag other than the ones this function writes can ever
 *     appear.
 *  3. The only attribute values this function builds — `href` and `src` —
 *     are passed through `safeUrl()`, which accepts only `http://`,
 *     `https://`, `mailto:` and a same-site `/path`. `javascript:`, `data:`
 *     and anything else are rejected outright; the original (already
 *     escaped, inert) text is left in place instead.
 *  4. A final pass strips any `<script…>` tag and any `on…=` attribute. Given
 *     1–3 this should never find anything — it exists so a future bug in this
 *     function fails safe instead of failing open, and so this promise is
 *     something a test can assert directly rather than only infer.
 */
const ESC_MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

/** http(s), mailto, or a same-site root-relative path. Nothing else. */
function safeUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\/[^\s<>"']+$/i.test(v)) return v;
  if (/^mailto:[^\s<>"']+$/i.test(v)) return v;
  if (/^\/(?!\/)[^\s<>"']*$/.test(v)) return v; // "/x" but not "//x" (protocol-relative)
  return null;
}

/** Bold, italic, links and images — applied to text that is ALREADY escaped. */
function inline(escaped: string): string {
  let s = escaped;
  // images before links: ![alt](url) would otherwise dangle a bare "!" once
  // the link regex below consumed the [alt](url) part on its own
  s = s.replace(/!\[([^\]\n]*)\]\(\s*([^)\s]+)\s*\)/g, (whole, alt: string, url: string) => {
    const u = safeUrl(url);
    return u ? `<img src="${u}" alt="${alt}" loading="lazy">` : whole;
  });
  s = s.replace(/\[([^\]\n]*)\]\(\s*([^)\s]+)\s*\)/g, (whole, text: string, url: string) => {
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
function para(text: string): string {
  const t = text.trim();
  return t ? `<p>${inline(escapeHtml(t))}</p>` : "";
}

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "p"; lines: string[] };

function parseBlocks(md: string): Block[] {
  const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { blocks.push({ kind: "h", level: h[1].length, text: h[2] }); i++; continue; }

    if (/^>\s?/.test(line)) {
      const qlines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { qlines.push(lines[i].replace(/^>\s?/, "")); i++; }
      blocks.push({ kind: "quote", lines: qlines });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, "")); i++; }
      blocks.push({ kind: "ul", items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, "")); i++; }
      blocks.push({ kind: "ol", items });
      continue;
    }

    const plines: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s+/.test(lines[i]) &&
           !/^>\s?/.test(lines[i]) && !/^[-*]\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i])) {
      plines.push(lines[i]); i++;
    }
    blocks.push({ kind: "p", lines: plines });
  }
  return blocks;
}

function renderBlock(b: Block): string {
  if (b.kind === "h") {
    const lvl = Math.min(6, Math.max(1, b.level));
    return `<h${lvl}>${inline(escapeHtml(b.text.trim()))}</h${lvl}>`;
  }
  if (b.kind === "quote") return `<blockquote>${para(b.lines.join(" "))}</blockquote>`;
  if (b.kind === "ul" || b.kind === "ol") {
    const tag = b.kind;
    const items = b.items.map((it) => `<li>${inline(escapeHtml(it.trim()))}</li>`).join("");
    return `<${tag}>${items}</${tag}>`;
  }
  return para(b.lines.join(" "));
}

/** A defensive last pass — see the block comment above. Should be a no-op. */
function stripDangerous(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

export function markdownToHtml(md: string): string {
  const html = parseBlocks(md).map(renderBlock).filter(Boolean).join("");
  return stripDangerous(html);
}

/* ---------- validation ----------------------------------------------------- */

function trilingual(raw: unknown, max: number): Trilingual {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...EMPTY3 };
  for (const l of LANGS) {
    const v = src[l];
    if (typeof v === "string") {
      out[l] = v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
    }
  }
  return out;
}

function cleanList(raw: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const t = v.replace(/\s+/g, " ").trim().slice(0, maxLen);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

function cleanUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().slice(0, 500);
  return /^https?:\/\/[^\s<>"']+$/i.test(v) ? v : null;
}

export interface PostInput {
  id?: string;
  slug?: string;
  title?: unknown;
  excerpt?: unknown;
  body?: unknown;
  coverUrl?: unknown;
  coverAlt?: unknown;
  tags?: unknown;
  products?: unknown;
  seoTitle?: unknown;
  seoDesc?: unknown;
  author?: unknown;
}

export class BlogError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/* ---------- reads ----------------------------------------------------------- */

export async function listPublished(
  page = 1,
  perPage = 10,
): Promise<{ posts: PostSummary[]; total: number; page: number; perPage: number }> {
  const p = Math.max(1, Math.trunc(page) || 1);
  const size = Math.min(50, Math.max(1, Math.trunc(perPage) || 10));
  const [rows, countRows] = await Promise.all([
    query<PostRow>(
      `select ${SUMMARY_COLS} from posts where status = 'published'
       order by published_at desc nulls last, created_at desc
       limit $1 offset $2`,
      [size, (p - 1) * size],
    ),
    query<{ n: string | number }>("select count(*) as n from posts where status = 'published'"),
  ]);
  return { posts: rows.map(toSummary), total: Number(countRows[0]?.n || 0), page: p, perPage: size };
}

export async function getPublishedBySlug(slug: string): Promise<Post | null> {
  const rows = await query<PostRow>(`select ${FULL_COLS} from posts where slug = $1 and status = 'published'`, [slug]);
  return rows.length ? toPost(rows[0]) : null;
}

/** Admin list — every post, newest edited first. No body: the list is a table, not a reader. */
export async function listAllPosts(limit = 200): Promise<PostSummary[]> {
  const rows = await query<PostRow>(
    `select ${SUMMARY_COLS} from posts order by updated_at desc limit $1`,
    [Math.min(500, Math.max(1, limit))],
  );
  return rows.map(toSummary);
}

export async function getPostById(id: string): Promise<Post | null> {
  const rows = await query<PostRow>(`select ${FULL_COLS} from posts where id = $1`, [id]);
  return rows.length ? toPost(rows[0]) : null;
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  const rows = await query<PostRow>(`select ${FULL_COLS} from posts where slug = $1`, [slug]);
  return rows.length ? toPost(rows[0]) : null;
}

/* ---------- writes ----------------------------------------------------------- */

/** Create (no `id`) or edit the fields of an existing post. Never touches status. */
export async function upsertPost(input: PostInput): Promise<Post> {
  const title = trilingual(input.title, 200);
  const excerpt = trilingual(input.excerpt, 500);
  const body = trilingual(input.body, 20_000);
  const coverAlt = trilingual(input.coverAlt, 160);
  const seoTitle = trilingual(input.seoTitle, 70);
  const seoDesc = trilingual(input.seoDesc, 170);
  const tags = cleanList(input.tags, 12, 30);
  const products = cleanList(input.products, 12, 80);
  const coverUrl = cleanUrl(input.coverUrl);
  const author = (typeof input.author === "string" ? input.author.trim() : "").slice(0, 60) || "Rempire";

  /*
   * The slug: an explicit one always wins. Otherwise — creating a new post —
   * it comes from the title. Editing an existing one is the case worth
   * getting right: with no explicit slug, this KEEPS the row's current slug
   * rather than re-deriving it from a title the admin only tweaked, or an
   * already-shared /shop2/blog/<slug>/ link would move out from under it the
   * next time someone just fixes a typo and saves.
   */
  let wantedSlug: string;
  if (input.id) {
    if (typeof input.slug === "string" && input.slug.trim()) {
      wantedSlug = input.slug;
    } else {
      const current = await query<{ slug: string }>("select slug from posts where id = $1", [input.id]);
      if (!current.length) throw new BlogError("not_found");
      wantedSlug = current[0].slug;
    }
  } else {
    wantedSlug = typeof input.slug === "string" && input.slug.trim() ? input.slug : title.RU || title.ET || title.EN;
  }
  const slug = await uniqueSlug(wantedSlug || "post", input.id);

  const params = [
    slug,
    JSON.stringify(title),
    JSON.stringify(excerpt),
    JSON.stringify(body),
    coverUrl,
    JSON.stringify(coverAlt),
    tags,
    products,
    JSON.stringify(seoTitle),
    JSON.stringify(seoDesc),
    author,
  ];

  if (input.id) {
    const rows = await query<PostRow>(
      `update posts set
         slug = $1, title = $2::jsonb, excerpt = $3::jsonb, body = $4::jsonb,
         cover_url = $5, cover_alt = $6::jsonb, tags = $7, products = $8,
         seo_title = $9::jsonb, seo_desc = $10::jsonb, author = $11, updated_at = now()
       where id = $12
       returning ${FULL_COLS}`,
      [...params, input.id],
    );
    if (!rows.length) throw new BlogError("not_found");
    return toPost(rows[0]);
  }

  const rows = await query<PostRow>(
    `insert into posts (slug, title, excerpt, body, cover_url, cover_alt, tags, products, seo_title, seo_desc, author)
     values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6::jsonb, $7, $8, $9::jsonb, $10::jsonb, $11)
     returning ${FULL_COLS}`,
    params,
  );
  return toPost(rows[0]);
}

/** status → 'published'. Keeps the original publishedAt when republishing. */
export async function publishPost(id: string): Promise<Post | null> {
  const rows = await query<PostRow>(
    `update posts set status = 'published', published_at = coalesce(published_at, now()), updated_at = now()
     where id = $1 returning ${FULL_COLS}`,
    [id],
  );
  return rows.length ? toPost(rows[0]) : null;
}

/** status → 'draft'. publishedAt is kept — "was live until this was clicked", not erased. */
export async function unpublishPost(id: string): Promise<Post | null> {
  const rows = await query<PostRow>(
    `update posts set status = 'draft', updated_at = now() where id = $1 returning ${FULL_COLS}`,
    [id],
  );
  return rows.length ? toPost(rows[0]) : null;
}

/**
 * Soft delete: back to a plain, never-published-looking draft. Unlike
 * `unpublishPost`, this also forgets `publishedAt` — the difference between
 * "take it down for now" and "get rid of it" is exactly that trace. The row,
 * the slug and the text are kept, so a mistaken delete is one «Опубликовать»
 * away from being fixed, in the drafts list.
 */
export async function deletePost(id: string): Promise<Post | null> {
  const rows = await query<PostRow>(
    `update posts set status = 'draft', published_at = null, updated_at = now() where id = $1 returning ${FULL_COLS}`,
    [id],
  );
  return rows.length ? toPost(rows[0]) : null;
}

/** Resolves either an id (uuid-shaped) or a slug to a post, for admin routes that accept both. */
export async function getPostByIdOrSlug(idOrSlug: string): Promise<Post | null> {
  const looksLikeId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  return looksLikeId ? getPostById(idOrSlug) : getPostBySlug(idOrSlug);
}
