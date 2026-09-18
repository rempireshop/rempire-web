/**
 * The blog editor's own API. Every verb is behind requireAdmin; posts are
 * plain rows in `posts` (db/migrations/070_blog.sql) — there is no demo/undo
 * layer here, a save writes for real straight away (see docs/blog.md).
 *
 * GET    /api/admin/blog/                → { ok, posts: PostSummary[] }  (newest edited first, no body)
 * GET    /api/admin/blog/?id=<uuid>      → { ok, post: Post }            (full, for the editor)
 * GET    /api/admin/blog/?slug=<slug>    → { ok, post: Post }            (same, by slug — the assistant knows slugs, not ids)
 * POST   /api/admin/blog/  { title?, excerpt?, body?, coverUrl?, coverAlt?,
 *                             coverFocus?, tags?, products?, seoTitle?, seoDesc?, author? }
 *                                         → { ok, post: Post }            (new post, always created as a draft)
 * PATCH  /api/admin/blog/  { id | slug, publish: true|false }
 *                                         → { ok, post: Post }            (publish / unpublish — publishedAt kept)
 * PATCH  /api/admin/blog/  { id, ...same fields as POST }
 *                                         → { ok, post: Post }            (edit an existing post; status untouched)
 * DELETE /api/admin/blog/?id=<uuid>      → { ok, post: Post }            (the article is gone — see deletePost in @/lib/blog)
 *
 * NB: trailing slash on every path — next.config has trailingSlash: true.
 *
 * ONE «Создать», ONE ARTICLE. The POST takes an `Idempotency-Key`
 * (src/lib/idempotency.ts): a lost answer used to leave a second draft behind,
 * and uniqueSlug() made room for it quietly, so the blog list grew a twin the
 * owner had to notice and delete. Only the POST — a PATCH already names the
 * row it is editing and a repeat of one changes nothing.
 *
 * The editor does not send the header yet, and until it does this route
 * behaves exactly as it did: runOnce() runs an unkeyed call straight through.
 * The client half is a later pass.
 */
import { requireAdmin } from "@/lib/auth";
import { fingerprintOf, type IdempotentAnswer, readIdempotencyKey, runOnce } from "@/lib/idempotency";
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
/** What the key is stored against — see src/lib/idempotency.ts `mismatch`. */
const ROUTE = "POST /api/admin/blog";

function bad(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status });
}

/** A post is at most a few pages of text in three languages; anything past
    this is not an article, and `body` here is written straight into the row. */
const MAX_BYTES = 200_000;

/**
 * The body, and the bytes it arrived as. POST needs both: fingerprintOf()
 * wants what the editor actually sent, and two objects that differ only in key
 * order hash differently once they have been through a parse and a
 * re-serialise. PATCH takes the parsed half and ignores the rest.
 */
async function readJson(req: Request): Promise<{ raw: string; body: Record<string, unknown> } | null> {
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
  return { raw, body: parsed as Record<string, unknown> };
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
    /* `"<mode> <x> <y>"` — writeCoverFocus() in src/lib/blog-cover.mjs is the
       door, and anything it does not recognise is stored as null, which is
       what a cover with nothing chosen already is. */
    coverFocus: body.coverFocus,
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

  const read = await readJson(req);
  if (!read) return bad("bad_request");
  const { raw, body } = read;

  /* At most once per key — see the header. A DIFFERENT key with the same
     fields is a second article and writes one: uniqueSlug() is happy to make
     room, and the owner may genuinely want two drafts to start from. */
  const done = await runOnce(
    { key: readIdempotencyKey(req), route: ROUTE, fingerprint: fingerprintOf(raw) },
    async (): Promise<IdempotentAnswer> => {
      try {
        const post = await upsertPost(fieldsOf(body));
        return { status: 200, body: { ok: true, post } };
      } catch (err) {
        /* Caught rather than thrown on: a refusal releases the key, so the
           corrected draft goes through under the same key. */
        if (err instanceof BlogError) {
          return { status: err.code === "not_found" ? 404 : 400, body: { ok: false, error: err.code } };
        }
        console.error("admin/blog POST failed", err);
        return { status: 503, body: { ok: false, error: "unavailable" } };
      }
    },
  );

  /* The editor's own first «Создать» is still going through. */
  if (done.outcome === "in_flight") return bad("in_progress", 409);
  /* This key already carries a different draft, or belongs to another route. */
  if (done.outcome === "mismatch") return bad("key_reused", 409);
  return Response.json(done.body, { status: done.status, headers: NO_STORE });
}

export async function PATCH(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const read = await readJson(req);
  if (!read) return bad("bad_request");
  /* No key on the edit path: a PATCH names the row it is changing, so a
     repeat writes the same fields onto the same post rather than making a
     second one. It is the CREATE that has nothing to name. */
  const { body } = read;

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
