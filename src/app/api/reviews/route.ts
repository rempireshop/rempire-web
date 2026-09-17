import { createHash } from "node:crypto";
import { clientIp, rateLimit } from "@/lib/auth";
import { sessionEmail } from "@/lib/customers";
import { addReview, approvedReviews, ratingFor, validateReview } from "@/lib/reviews";

/**
 * GET  /api/reviews/?product=<id>   → { ok, reviews: [...], avg, n }
 *        approved reviews only; safe to cache for a minute.
 *
 * POST /api/reviews/  { product, name, rating, text, lang, consent, website }
 *        → { ok: true, status: "pending" }
 *        `website` is the honeypot; `consent` must be true.
 *        Three STORED reviews a hour per IP (thirty calls of any kind).
 *        Everything lands as 'pending' — the owner approves it in the admin
 *        before anyone else sees it.
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

const HOUR = 60 * 60 * 1000;

export async function POST(req: Request) {
  const ip = clientIp(req);
  /* Two doors, and the cheap one first: a flood of anything at all, valid or
     not, stops here, so nothing below is ever reached in bulk. The three-an-
     hour limit that this endpoint is really about has moved past
     validateReview — see the comment there. */
  if (rateLimit("review_flood", ip, 30, HOUR)) {
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

  /* Three a hour per IP — counted here, where a review is about to be STORED,
     and not at the door. Two of the refusals above cannot be anticipated by
     the form: a link or an address in the text, and a word on the profanity
     list. The customer is told to take it out and sends the review again,
     which used to spend one of the three; two such corrections and the shop
     answered «Слишком много отзывов подряд — попробуйте через час» to somebody
     who had not managed to leave a single one. A correction the shop itself
     refused is not a review. */
  if (rateLimit("review", ip, 3, HOUR)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  try {
    /* Who wrote it, when the shop can prove it: the signed `rmp_cust` cookie
       the shopper is already carrying, never a field out of `body` — the
       admin's customer card keys on this column, so an address a stranger
       could type is an address a stranger could pin on somebody else. Signed
       out, the review is stored with none and belongs to no card. */
    const review = await addReview(check.value, ipHash(ip), sessionEmail(req));
    return Response.json({ ok: true, status: review.status, id: review.id });
  } catch (err) {
    console.error("reviews POST failed", err);
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
