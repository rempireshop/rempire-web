/**
 * The blog editor's own API. Every verb is behind requireAdmin; posts are
 * plain rows in `posts` (db/migrations/070_blog.sql) — there is no demo/undo
 * layer here, a save writes for real straight away (see docs/blog.md).
 *
 * GET    /api/admin/blog/                → { ok, posts: PostSummary[] }  (newest edited first, no body)
 * GET    /api/admin/blog/?id=<uuid>      → { ok, post: Post }            (full, for the editor)
 * GET    /api/admin/blog/?slug=<slug>    → { ok, post: Post }            (same, by slug — the assistant knows slugs, not ids)
 * POST   /api/admin/blog/  { title?, excerpt?, body?, coverUrl?, coverAlt?,
 *                             tags?, products?, seoTitle?, seoDesc?, author? }
 *                                         → { ok, post: Post }            (new post, always created as a draft)
 * PATCH  /api/admin/blog/  { id | slug, publish: true|false }
 *                                         → { ok, post: Post }            (publish / unpublish — publishedAt kept)
 * PATCH  /api/admin/blog/  { id, ...same fields as POST }
 *                                         → { ok, post: Post }            (edit an existing post; status untouched)
 * DELETE /api/admin/blog/?id=<uuid>      → { ok, post: Post }            (soft delete — see deletePost in @/lib/blog)
 *
 * NB: trailing slash on every path — next.config has trailingSlash: true.
 */
import { requireAdmin } from "@/lib/auth";
import {
  BlogError,
  deletePost,
  getPostById,
  getPostBySlug,
  listAllPosts,
  publishPost,
  unpublishPost,
  upsertPost,
  type PostInput,
} from "@/lib/blog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

function bad(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status });
}

/** A post is at most a few pages of text in three languages; anything past
    this is not an article, and `body` here is written straight into the row. */
const MAX_BYTES = 200_000;

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = (await req.text()) || "{}";
  } catch {
    return null;
  }
  if (raw.length > MAX_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  /* `null` is valid JSON and `typeof null === "object"`; so are `5`, `"x"`
     and `[]`. Every field read below would then be `undefined` — today that
     lands on «title_required», but it is one `body.a.b` away from a 500, and
     every other admin route already refuses these four shapes here. */
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/** Postgres `posts.id` is a uuid: a `where id = 'abc'` raises 22P02, which is
    not a BlogError, so the edit path answered 503 «unavailable» for what is
    simply an id that does not exist. Every sibling (publish, unpublish,
    delete, getPostById) already gates on this and answers 404. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everything POST/PATCH accept as content fields, lifted off the body as-is — @/lib/blog does the cleaning. */
function fieldsOf(body: Record<string, unknown>): PostInput {
  return {
    slug: typeof body.slug === "string" ? body.slug : undefined,
    title: body.title,
    excerpt: body.excerpt,
    body: body.body,
    coverUrl: body.coverUrl,
    coverAlt: body.coverAlt,
    tags: body.tags,
    products: body.products,
    seoTitle: body.seoTitle,
    seoDesc: body.seoDesc,
    author: body.author,
  };
}

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const slug = url.searchParams.get("slug");

  try {
    if (id || slug) {
      const post = id ? await getPostById(id) : await getPostBySlug(slug as string);
      if (!post) return bad("not_found", 404);
      return Response.json({ ok: true, post }, { headers: NO_STORE });
    }
    const posts = await listAllPosts();
    return Response.json({ ok: true, posts }, { headers: NO_STORE });
  } catch (err) {
    console.error("admin/blog GET failed", err);
    return bad("unavailable", 503);
  }
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const body = await readJson(req);
  if (!body) return bad("bad_request");

  try {
    const post = await upsertPost(fieldsOf(body));
    return Response.json({ ok: true, post }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof BlogError) return bad(err.code, err.code === "not_found" ? 404 : 400);
    console.error("admin/blog POST failed", err);
    return bad("unavailable", 503);
  }
}

export async function PATCH(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const body = await readJson(req);
  if (!body) return bad("bad_request");

  const idRaw = typeof body.id === "string" ? body.id.trim() : "";
  const slugRaw = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!idRaw && !slugRaw) return bad("no_id");
  if (idRaw && !UUID_RE.test(idRaw)) return bad("not_found", 404);

  try {
    // publish / unpublish: a status transition, nothing else changes
    if (typeof body.publish === "boolean") {
      const target = idRaw || (await getPostBySlug(slugRaw))?.id;
      if (!target) return bad("not_found", 404);
      const post = body.publish ? await publishPost(target) : await unpublishPost(target);
      if (!post) return bad("not_found", 404);
      return Response.json({ ok: true, post }, { headers: NO_STORE });
    }

    // otherwise: an edit. upsertPost needs the row's id, not its slug.
    const id = idRaw || (await getPostBySlug(slugRaw))?.id;
    if (!id) return bad("not_found", 404);
    const post = await upsertPost({ ...fieldsOf(body), id });
    return Response.json({ ok: true, post }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof BlogError) return bad(err.code, err.code === "not_found" ? 404 : 400);
    console.error("admin/blog PATCH failed", err);
    return bad("unavailable", 503);
  }
}

export async function DELETE(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return bad("no_id");

  try {
    const post = await deletePost(id);
    if (!post) return bad("not_found", 404);
    return Response.json({ ok: true, post }, { headers: NO_STORE });
  } catch (err) {
    console.error("admin/blog DELETE failed", err);
    return bad("unavailable", 503);
  }
}
