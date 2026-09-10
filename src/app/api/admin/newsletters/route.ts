/**
 * «Рассылка» — the drafts. Every verb is behind requireAdmin; the rows are
 * `newsletters` (db/migrations/160_newsletters.sql, src/lib/newsletters.ts).
 *
 * GET    /api/admin/newsletters/            → { ok, newsletters: NewsletterSummary[] }  (newest edited first, no texts)
 * GET    /api/admin/newsletters/?id=<uuid>  → { ok, newsletter: Newsletter }            (whole, for the editor)
 * POST   /api/admin/newsletters/  { title?, subject?, body?, products? }
 *                                            → { ok, newsletter }                        (a new draft)
 * PATCH  /api/admin/newsletters/  { id, title?, subject?, body?, products? }
 *                                            → { ok, newsletter }                        (the whole draft, replaced)
 * DELETE /api/admin/newsletters/?id=<uuid>  → { ok, newsletter }                        (a draft only)
 *
 * A letter that has gone out (or is going out) is history: PATCH and DELETE
 * answer 409 `not_draft` for it. Sending and the test letter have routes of
 * their own under /api/admin/newsletters/<id>/.
 *
 * NB trailing slash on every path — next.config has trailingSlash: true.
 */
import { requireAdmin } from "@/lib/auth";
import {
  createNewsletter,
  deleteNewsletter,
  getNewsletter,
  isNewsletterId,
  listNewsletters,
  NewsletterError,
  newsletterErrorStatus as statusOf,
  updateNewsletter,
} from "@/lib/newsletters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;
/* Three bodies of allowlisted HTML plus the subjects — well under this. */
const MAX_BYTES = 400_000;

function bad(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status, headers: NO_STORE });
}

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
  // `null`, a number, a string, an array — valid JSON, not a draft
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id");
  try {
    if (id !== null) {
      if (!isNewsletterId(id)) return bad("not_found", 404);
      const newsletter = await getNewsletter(id);
      if (!newsletter) return bad("not_found", 404);
      return Response.json({ ok: true, newsletter }, { headers: NO_STORE });
    }
    return Response.json({ ok: true, newsletters: await listNewsletters() }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/newsletters] GET failed:", err);
    return bad("db_unavailable", 503);
  }
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const body = await readJson(req);
  if (!body) return bad("bad_request");
  try {
    const newsletter = await createNewsletter(body);
    return Response.json({ ok: true, newsletter }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/newsletters] POST failed:", err);
    return bad("db_unavailable", 503);
  }
}

export async function PATCH(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const body = await readJson(req);
  if (!body) return bad("bad_request");
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return bad("no_id");
  if (!isNewsletterId(id)) return bad("not_found", 404);
  try {
    const newsletter = await updateNewsletter(id, body);
    return Response.json({ ok: true, newsletter }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof NewsletterError) return bad(err.code, statusOf(err.code));
    console.error("[api/admin/newsletters] PATCH failed:", err);
    return bad("db_unavailable", 503);
  }
}

export async function DELETE(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return bad("no_id");
  if (!isNewsletterId(id)) return bad("not_found", 404);
  try {
    const newsletter = await deleteNewsletter(id);
    return Response.json({ ok: true, newsletter }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof NewsletterError) return bad(err.code, statusOf(err.code));
    console.error("[api/admin/newsletters] DELETE failed:", err);
    return bad("db_unavailable", 503);
  }
}
