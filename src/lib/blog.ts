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
 * public API or in a prerendered page, 'published' is live.
 *
 * `deleted_at` is the other one, and it is not the same thing (migration 195).
 * «Удалить статью» used to be `status = 'draft'` and nothing more — the same
 * outcome as «Снять с публикации» one button higher — so the article stayed in
 * «Блог» for ever and Renat's reading of it was the plain one: articles cannot
 * be deleted (18.09.2026). `deletePost()` stamps `deleted_at` now, and EVERY
 * read below carries `deleted_at is null`: the admin list, both lookups, the
 * public list and page, publish and unpublish. The article is gone from the
 * panel and from the shop.
 *
 * The row itself stays, and `slugExists()` is the one query that deliberately
 * does not filter, because the slug is the reason: 070_blog.sql promises a slug
 * is never reused for a different article, so a link shared in January can
 * never open somebody else's text in March. Nothing reads a deleted row back —
 * bringing one back is a hand-written `update posts set deleted_at = null`.
 *
 * The body is HTML now. The admin editor is a small visual box (a
 * contenteditable in `public/shop2/app.js`), so what it saves is a handful of
 * tags, not markdown — `sanitizeHtml()` is the allowlist that HTML is measured
 * against, both when it is saved and again when it is read. Older posts (and
 * anything the assistant drafts) are still markdown, and `markdownToHtml()`
 * still renders those: `renderPostBody()` is the one place that decides which
 * of the two a body is, so nothing that was written before the editor changed
 * has to be migrated to keep rendering.
 *
 * All four of those live in src/lib/blog-html.mjs and are re-exported below,
 * so `@/lib/blog` stays the one address a caller needs. They moved there
 * because tools/prerender-shop2.mjs renders the same bodies at build time and
 * cannot import TypeScript — it used to carry a hand-kept copy, which drifted
 * twice. The safety argument for each door, and the story of those two drifts,
 * is in that file's header and above each function.
 */
import { writeCoverFocus } from "@/lib/blog-cover.mjs";
import { jsonbParam, query } from "@/lib/db";
import type { Lang3, Trilingual } from "@/lib/content";
import {
  looksLikeHtmlBody as looksLikeHtmlBodyJs,
  markdownToHtml as markdownToHtmlJs,
  renderPostBody as renderPostBodyJs,
  sanitizeHtml as sanitizeHtmlJs,
} from "@/lib/blog-html.mjs";

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
  /** Which part of the cover each frame keeps — `"<mode> <x> <y>"` (one point
      for all three frames) or `"<mode> list <x> <y> <zoom> post … og …"` (a
      point and a zoom per frame), or null for the covers written before there
      was anything to choose. The one reader is src/lib/blog-cover.mjs, whose
      header says what the words mean and why it is a point and not a crop. */
  coverFocus: string | null;
  /** The Russian set — what `tags` has always been. */
  tags: string[];
  /** The Estonian and English sets (db/migrations/209_blog_tags_i18n.sql); a page picks with pickTags(). */
  tagsI18n: TagsI18n;
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
  cover_focus: string | null;
  tags: string[] | null;
  tags_i18n: Partial<Record<"ET" | "EN", unknown>> | null;
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
    /* Through the same door on the way out as on the way in: a row written
       before the column existed, or by hand with a word this vocabulary does
       not have, reads back as null — which is what every old post is. */
    coverFocus: writeCoverFocus(r.cover_focus),
    tags: Array.isArray(r.tags) ? r.tags : [],
    tagsI18n: readTagsI18n(r.tags_i18n),
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
  "id, slug, status, title, excerpt, cover_url, cover_alt, cover_focus, tags, tags_i18n, products, seo_title, seo_desc, author, published_at, created_at, updated_at";
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

/* The ONE read of `posts` with no `deleted_at is null` on it, and the reason
   migration 195 keeps the row instead of deleting it: a deleted article's slug
   stays taken, so the next article with the same title becomes «…-2» and a link
   shared before the delete can never open somebody else's text. */
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

/* ---------- the body renderer ---------------------------------------------
 *
 * Both doors a stored body can come through — markdown from before the visual
 * editor, HTML from it — live in src/lib/blog-html.mjs, together with the
 * allowlist, the URL check and the safety argument for each. Plain ESM, so
 * tools/prerender-shop2.mjs can render an article with the very same code
 * this module serves one with; the header of blog-html.mjs says why that
 * matters and what it cost to learn.
 *
 * Re-exported here, annotated, because `@/lib/blog` is the address the eight
 * callers already use and the .mjs has no types of its own to give them.
 */
export const markdownToHtml: (md: string) => string = markdownToHtmlJs;
export const sanitizeHtml: (input: string) => string = sanitizeHtmlJs;
export const looksLikeHtmlBody: (body: string) => boolean = looksLikeHtmlBodyJs;
export const renderPostBody: (body: string) => string = renderPostBodyJs;

/* ---------- validation ----------------------------------------------------- */

/** A title, an excerpt, an alt or an SEO line: one line, however it arrived. */
function cleanLine(v: string): string {
  return v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
}

/**
 * The article body, which is the one field where a line break is content.
 *
 * This used to run `cleanLine()` too, and every body came out of it as a
 * single endless line: a markdown `## Масло каждый день` on its own line
 * ended up in the middle of the paragraph above it, both markers glued to
 * their neighbours, and the article rendered as one wall of text. Runs of
 * spaces and tabs still collapse, control and format characters still go,
 * and three or more blank lines still become one — `\n` is simply not
 * whitespace to be squeezed out here.
 */
function cleanBody(v: string): string {
  return v
    .replace(/\r\n?/g, "\n")                                     // CRLF, and a lone CR from an old paste
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\n" ? c : " "))  // tabs, NUL, bidi marks — but not the breaks
    .replace(/[^\S\n]+/g, " ")                                   // runs of spaces (and NBSP) → one space
    .replace(/ *\n */g, "\n")                                    // no space left dangling at a line end
    .replace(/\n{3,}/g, "\n\n")                                  // at most one blank line between blocks
    .trim();
}

/**
 * `tooLong` — the BlogError code to raise instead of cutting. Only `body`
 * passes one: a title or an SEO description past its limit is a field being
 * clipped to the length Google reads anyway, but a body past its limit is
 * the article itself, and `.slice()` took the end of it off while the panel
 * answered «Сохранено ✓». Everything after the cut — the last sections, the
 * product cards in them — was gone from the row and from the editor's next
 * open, with nothing said. Refusing is the only answer that keeps the text:
 * it stays in the box in front of the owner, who is told to shorten it.
 */
function trilingual(raw: unknown, max: number, multiline = false, tooLong = ""): Trilingual {
  /* A bare string is the Russian text — the panel always sends {RU,ET,EN},
     but the assistant's draft and a hand-written API call may not, and a
     title that silently vanished used to publish a post with an empty <h1>
     and the fallback slug "post". */
  const src =
    typeof raw === "string"
      ? { RU: raw }
      : raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
  const out = { ...EMPTY3 };
  for (const l of LANGS) {
    const v = src[l];
    if (typeof v !== "string") continue;
    const clean = multiline ? cleanBody(v) : cleanLine(v);
    if (tooLong && clean.length > max) throw new BlogError(tooLong);
    out[l] = clean.slice(0, max);
  }
  return out;
}

export interface TagsI18n {
  ET: string[];
  EN: string[];
}
const CYRILLIC = /[Ѐ-ӿ]/;
/** A stored {ET, EN} as two lists — whatever an older row or a hand-written one holds. */
function readTagsI18n(raw: unknown): TagsI18n {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return { ET: cleanList(o.ET, 12, 30), EN: cleanList(o.EN, 12, 30) };
}
/**
 * The Estonian and English tag sets a save carries, cleaned — or null when it
 * carries none, which keeps what the row holds (a cover-only PATCH must not
 * wipe them). A Russian word is not an Estonian or English tag: dropped, the
 * same script test the article writer's tags go through (tagInLang in
 * src/app/api/admin/ai/text/route.ts).
 */
function cleanTagsI18n(raw: unknown): TagsI18n | null {
  if (raw === undefined || raw === null) return null;
  const t = readTagsI18n(raw);
  return { ET: t.ET.filter((x) => !CYRILLIC.test(x)), EN: t.EN.filter((x) => !CYRILLIC.test(x)) };
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
  if (/^https?:\/\/[^\s<>"']+$/i.test(v)) return v;
  /* …or a picture this shop already serves. The sample posts seeded by
     071_blog_samples.sql use a product photo under /shop/img/ as their cover,
     and opening one of them in the editor and pressing «Сохранить» must not
     quietly blank the cover just because it is not on R2. */
  if (/^\/(?!\/)[^\s<>"']*$/.test(v)) return v;
  return null;
}

export interface PostInput {
  id?: string;
  slug?: string;
  title?: unknown;
  excerpt?: unknown;
  body?: unknown;
  coverUrl?: unknown;
  coverAlt?: unknown;
  coverFocus?: unknown;
  tags?: unknown;
  /** {ET: [...], EN: [...]} — absent keeps what is stored. */
  tagsI18n?: unknown;
  products?: unknown;
  seoTitle?: unknown;
  seoDesc?: unknown;
  author?: unknown;
}

/** One language's article, cleaned: a few pages of HTML. Past this, `upsertPost`
    refuses with «body_too_long» rather than saving a cut-off article. */
export const BODY_MAX = 20_000;

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
      `select ${SUMMARY_COLS} from posts where status = 'published' and deleted_at is null
       order by published_at desc nulls last, created_at desc
       limit $1 offset $2`,
      [size, (p - 1) * size],
    ),
    query<{ n: string | number }>("select count(*) as n from posts where status = 'published' and deleted_at is null"),
  ]);
  return { posts: rows.map(toSummary), total: Number(countRows[0]?.n || 0), page: p, perPage: size };
}

export async function getPublishedBySlug(slug: string): Promise<Post | null> {
  const rows = await query<PostRow>(
    `select ${FULL_COLS} from posts where slug = $1 and status = 'published' and deleted_at is null`,
    [slug],
  );
  return rows.length ? toPost(rows[0]) : null;
}

/** Admin list — every post that still exists, newest edited first. No body: the list is a table, not a reader. */
export async function listAllPosts(limit = 200): Promise<PostSummary[]> {
  const rows = await query<PostRow>(
    `select ${SUMMARY_COLS} from posts where deleted_at is null order by updated_at desc limit $1`,
    [Math.min(500, Math.max(1, limit))],
  );
  return rows.map(toSummary);
}

/* posts.id is a uuid column. Anything that is not uuid-shaped makes Postgres
   raise 22P02 ("invalid input syntax for type uuid"), which every caller
   reports as a 503 — so an unknown id reads as an outage. It is a 404: the
   same guard src/lib/orders.ts and src/lib/loyalty.ts already use. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getPostById(id: string): Promise<Post | null> {
  if (!UUID_RE.test(String(id ?? ""))) return null;
  const rows = await query<PostRow>(`select ${FULL_COLS} from posts where id = $1 and deleted_at is null`, [id]);
  return rows.length ? toPost(rows[0]) : null;
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  const rows = await query<PostRow>(`select ${FULL_COLS} from posts where slug = $1 and deleted_at is null`, [slug]);
  return rows.length ? toPost(rows[0]) : null;
}

/* ---------- writes ----------------------------------------------------------- */

/** Create (no `id`) or edit the fields of an existing post. Never touches status. */
export async function upsertPost(input: PostInput): Promise<Post> {
  const title = trilingual(input.title, 200);
  const excerpt = trilingual(input.excerpt, 500);
  const body = trilingual(input.body, BODY_MAX, true, "body_too_long"); // the one field where "\n" is content
  const coverAlt = trilingual(input.coverAlt, 160);
  const seoTitle = trilingual(input.seoTitle, 70);
  const seoDesc = trilingual(input.seoDesc, 170);
  const tags = cleanList(input.tags, 12, 30);
  const tagsI18n = cleanTagsI18n(input.tagsI18n);
  const products = cleanList(input.products, 12, 80);
  const coverUrl = cleanUrl(input.coverUrl);
  /* Deliberately not `undefined`-aware, unlike the title check below: a save
     that carries no coverFocus is the panel saying «nothing chosen», and the
     same save carries the cover the point belonged to. The two go together —
     a photo replaced through the assistant's set_post_cover must not keep a
     point that was dragged onto the picture before it. */
  const coverFocus = writeCoverFocus(input.coverFocus);
  const author = (typeof input.author === "string" ? input.author.trim() : "").slice(0, 60) || "Rempire";

  /*
   * The slug: an explicit one always wins. Otherwise — creating a new post —
   * it comes from the title. Editing an existing one is the case worth
   * getting right: with no explicit slug, this KEEPS the row's current slug
   * rather than re-deriving it from a title the admin only tweaked, or an
   * already-shared /shop2/blog/<slug>/ link would move out from under it the
   * next time someone just fixes a typo and saves.
   */
  /* No title in any language is not a post — refused here rather than
     published as an empty <h1> under the fallback slug "post". On an edit
     the check runs only when a title was actually sent: a slug-only or
     publish-only PATCH does not carry one and must keep working. */
  const titleGiven = input.title !== undefined;
  if ((!input.id || titleGiven) && !title.RU && !title.ET && !title.EN) throw new BlogError("title_required");

  let wantedSlug: string;
  if (input.id) {
    if (typeof input.slug === "string" && input.slug.trim()) {
      wantedSlug = input.slug;
    } else {
      const current = await query<{ slug: string }>(
        "select slug from posts where id = $1 and deleted_at is null",
        [input.id],
      );
      if (!current.length) throw new BlogError("not_found");
      wantedSlug = current[0].slug;
    }
  } else {
    wantedSlug = typeof input.slug === "string" && input.slug.trim() ? input.slug : title.RU || title.ET || title.EN;
  }
  const slug = await uniqueSlug(wantedSlug || "post", input.id);

  const params = [
    slug,
    jsonbParam(title),
    jsonbParam(excerpt),
    jsonbParam(body),
    coverUrl,
    jsonbParam(coverAlt),
    coverFocus,
    tags,
    products,
    jsonbParam(seoTitle),
    jsonbParam(seoDesc),
    author,
    tagsI18n ? jsonbParam(tagsI18n) : null,
  ];

  if (input.id) {
    const rows = await query<PostRow>(
      `update posts set
         slug = $1, title = $2::jsonb, excerpt = $3::jsonb, body = $4::jsonb,
         cover_url = $5, cover_alt = $6::jsonb, cover_focus = $7, tags = $8, products = $9,
         seo_title = $10::jsonb, seo_desc = $11::jsonb, author = $12,
         tags_i18n = coalesce($13::jsonb, tags_i18n), updated_at = now()
       where id = $14 and deleted_at is null
       returning ${FULL_COLS}`,
      [...params, input.id],
    );
    if (!rows.length) throw new BlogError("not_found");
    return toPost(rows[0]);
  }

  const rows = await query<PostRow>(
    `insert into posts (slug, title, excerpt, body, cover_url, cover_alt, cover_focus, tags, products, seo_title, seo_desc, author, tags_i18n)
     values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6::jsonb, $7, $8, $9, $10::jsonb, $11::jsonb, $12, coalesce($13::jsonb, '{}'::jsonb))
     returning ${FULL_COLS}`,
    params,
  );
  return toPost(rows[0]);
}

/** status → 'published'. Keeps the original publishedAt when republishing. */
export async function publishPost(id: string): Promise<Post | null> {
  if (!UUID_RE.test(String(id ?? ""))) return null;
  const rows = await query<PostRow>(
    `update posts set status = 'published', published_at = coalesce(published_at, now()), updated_at = now()
     where id = $1 and deleted_at is null returning ${FULL_COLS}`,
    [id],
  );
  return rows.length ? toPost(rows[0]) : null;
}

/** status → 'draft'. publishedAt is kept — "was live until this was clicked", not erased. */
export async function unpublishPost(id: string): Promise<Post | null> {
  if (!UUID_RE.test(String(id ?? ""))) return null;
  const rows = await query<PostRow>(
    `update posts set status = 'draft', updated_at = now() where id = $1 and deleted_at is null returning ${FULL_COLS}`,
    [id],
  );
  return rows.length ? toPost(rows[0]) : null;
}

/**
 * Delete: the article leaves «Блог» and leaves the shop.
 *
 * Until 18.09.2026 this was `status = 'draft'` and a forgotten `publishedAt` —
 * which is «Снять с публикации» with a redder button, so the article the owner
 * had just deleted was still sitting in his list. See migration 195 and the
 * header of this file.
 *
 * `deleted_at` is stamped, every read filters on it, and the row and its slug
 * stay behind so a shared link can never be handed to a different article.
 * `status` and `published_at` are cleared with it, so nothing that reads a row
 * without knowing about `deleted_at` — a hand-written query, tools/lib/
 * blog-export.mjs at build time — can mistake it for something to publish.
 */
export async function deletePost(id: string): Promise<Post | null> {
  if (!UUID_RE.test(String(id ?? ""))) return null;
  const rows = await query<PostRow>(
    `update posts set status = 'draft', published_at = null, deleted_at = now(), updated_at = now()
     where id = $1 and deleted_at is null returning ${FULL_COLS}`,
    [id],
  );
  return rows.length ? toPost(rows[0]) : null;
}

/* `getPostByIdOrSlug()` was written for admin routes that accept either; no
   route ever did — they take one or the other and call getPostById() or
   getPostBySlug() directly. Removed 07.09.2026
   (docs/audit/2026-09-07-cleanup.md); in git at 448cbd7. */
