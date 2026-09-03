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

const STATUSES: ReviewStatus[] = ["pending", "approved", "rejected"];

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const raw = new URL(req.url).searchParams.get("status");
  const status = raw && (STATUSES as string[]).includes(raw) ? (raw as ReviewStatus) : undefined;
  if (raw && !status) return Response.json({ ok: false, error: "bad_status" }, { status: 400 });

  try {
    const [reviews, counts] = await Promise.all([listReviews(status), reviewCounts()]);
    return Response.json({ ok: true, reviews, counts });
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

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!id) return Response.json({ ok: false, error: "no_id" }, { status: 400 });
  if (!(STATUSES as string[]).includes(status)) {
    return Response.json({ ok: false, error: "bad_status" }, { status: 400 });
  }

  try {
    const review = await setReviewStatus(id, status as ReviewStatus);
    if (!review) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    return Response.json({ ok: true, review });
  } catch (err) {
    console.error("admin/reviews PATCH failed", err);
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
