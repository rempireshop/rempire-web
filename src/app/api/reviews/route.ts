import { createHash } from "node:crypto";
import { clientIp, rateLimit } from "@/lib/auth";
import { addReview, approvedReviews, ratingFor, validateReview } from "@/lib/reviews";

/**
 * GET  /api/reviews/?product=<id>   → { ok, reviews: [...], avg, n }
 *        approved reviews only; safe to cache for a minute.
 *
 * POST /api/reviews/  { product, name, rating, text, lang, consent, website }
 *        → { ok: true, status: "pending" }
 *        `website` is the honeypot; `consent` must be true.
 *        Three a hour per IP. Everything lands as 'pending' — the owner
 *        approves it in the admin before anyone else sees it.
 *
 * NB: POST to "/api/reviews/" WITH the trailing slash (trailingSlash: true).
 */

const MAX_BYTES = 8_000;

/**
 * Salted — the raw IP is never written to the database.
 *
 * There is no fallback salt (audit M4): a SHA-256 over the 32-bit IPv4 space
 * with a salt that is published in this repository is not a hash, it is an
 * encoding, and db/migrations/021_reviews.sql promises otherwise. No
 * SESSION_SECRET, no ip_hash — the column is nullable for exactly this.
 */
function ipHash(ip: string): string | null {
  const salt = process.env.SESSION_SECRET;
  if (!salt) return null;
  return createHash("sha256")
    .update(salt + "|" + ip)
    .digest("base64url")
    .slice(0, 22);
}

export async function GET(req: Request) {
  const product = new URL(req.url).searchParams.get("product") || "";
  if (!product) return Response.json({ ok: false, error: "no_product" }, { status: 400 });

  try {
    const [reviews, rating] = await Promise.all([approvedReviews(product), ratingFor(product)]);
    return Response.json(
      { ok: true, reviews, avg: rating.avg, n: rating.n },
      { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=600" } },
    );
  } catch (err) {
    console.error("reviews GET failed", err);
    // the product page must still render — an empty list is the honest answer
    return Response.json({ ok: true, reviews: [], avg: 0, n: 0, degraded: true });
  }
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (rateLimit("review", ip, 3, 60 * 60 * 1000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  if (raw.length > MAX_BYTES) {
    return Response.json({ ok: false, error: "long_text" }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  /* `null` is valid JSON and `typeof null === "object"`, so the parse above
     lets it through and every field read below throws — a 500 from a
     two-byte body. Same door for a bare number, string or array. */
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const check = validateReview(body);
  if (!check.ok) {
    /* A bot that tripped the honeypot is told "thank you" and nothing is
       stored — telling it what gave it away only helps it come back. */
    if (check.error === "bot") return Response.json({ ok: true, status: "pending" });
    return Response.json({ ok: false, error: check.error }, { status: 400 });
  }

  try {
    const review = await addReview(check.value, ipHash(ip));
    return Response.json({ ok: true, status: review.status, id: review.id });
  } catch (err) {
    console.error("reviews POST failed", err);
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
