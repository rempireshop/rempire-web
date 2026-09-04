import { clientIp, rateLimit } from "@/lib/auth";
import { checkGiftCard } from "@/lib/giftcards";

/**
 * POST /api/giftcards/check/  { code }
 *   → { ok: true, code, balance, amount }
 *   → { ok: false, error: "bad_code" | "not_found" | "empty" | "rate_limited" }
 *
 * Public, so it is deliberately quiet: it never says how many cards exist and
 * it never returns the recipient. Guessing a code is 25^8 ≈ 1.5·10¹¹ tries,
 * and the limiter below leaves 30 an hour per IP.
 *
 * NB: POST to "/api/giftcards/check/" WITH the trailing slash — next.config
 * has trailingSlash: true and would 308 the POST away otherwise.
 */

const MAX_BYTES = 2_000;

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (rateLimit("giftcheck", ip, 30, 60 * 60 * 1000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  if (raw.length > MAX_BYTES) {
    return Response.json({ ok: false, error: "too_large" }, { status: 413 });
  }

  let body: { code?: unknown };
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

  const code = typeof body.code === "string" ? body.code : "";
  if (!code) return Response.json({ ok: false, error: "bad_code" }, { status: 400 });

  try {
    const res = await checkGiftCard(code);
    // a wrong code is a normal answer, not a server problem — 200 either way,
    // so the storefront can show the message without treating it as an outage
    return Response.json(res);
  } catch (err) {
    console.error("giftcards/check failed", err);
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}

export function GET() {
  return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
