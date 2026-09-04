import { requireAdmin } from "@/lib/auth";
import { listReviews, reviewCounts, setReviewStatus, type ReviewStatus } from "@/lib/reviews";

/**
 * Review moderation. Both verbs are behind requireAdmin.
 *
 * GET   /api/admin/reviews/?status=pending   → { ok, reviews, counts }
 *         status omitted = every review, newest first.
 * PATCH /api/admin/reviews/  { id, status }  → { ok, review }
 *         status is "approved" | "rejected" | "pending".
 *
 * NB: trailing slash on both (next.config has trailingSlash: true).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: ReviewStatus[] = ["pending", "approved", "rejected"];

/* Moderation data — customer names and unpublished text. Every other admin
   route says so; this one used to leave it to the browser (audit L10). */
const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const raw = new URL(req.url).searchParams.get("status");
  const status = raw && (STATUSES as string[]).includes(raw) ? (raw as ReviewStatus) : undefined;
  if (raw && !status) return Response.json({ ok: false, error: "bad_status" }, { status: 400 });

  try {
    const [reviews, counts] = await Promise.all([listReviews(status), reviewCounts()]);
    return Response.json({ ok: true, reviews, counts }, { headers: NO_STORE });
  } catch (err) {
    console.error("admin/reviews GET failed", err);
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let body: { id?: unknown; status?: unknown };
  try {
    body = JSON.parse((await req.text()) || "{}");
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  /* `null` is valid JSON and `typeof null === "object"`, so the parse above
     lets it through and every field read below throws — a 500 from a
     two-byte body. Same door for a bare number, string or array. */
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!id) return Response.json({ ok: false, error: "no_id" }, { status: 400 });
  if (!(STATUSES as string[]).includes(status)) {
    return Response.json({ ok: false, error: "bad_status" }, { status: 400 });
  }

  try {
    const review = await setReviewStatus(id, status as ReviewStatus);
    if (!review) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    return Response.json({ ok: true, review }, { headers: NO_STORE });
  } catch (err) {
    console.error("admin/reviews PATCH failed", err);
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
