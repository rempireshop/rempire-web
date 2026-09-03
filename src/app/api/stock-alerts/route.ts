/**
 * POST /api/stock-alerts — «Сообщить о наличии» on a sold-out product page.
 *
 * Body `{email, productId, lang?}`. Asking twice for the same product is one
 * subscription; the letter goes out once, from src/lib/flows.ts, when the
 * owner puts the product back in stock.
 *
 * Answers `{ok:true}` for a well-formed request whether or not the row was new
 * — the page must not become a way of asking "does this address already
 * follow this product".
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { addStockAlert, isEmail, normalizeEmail, sessionEmail } from "@/lib/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 1_000;

export async function POST(req: Request) {
  if (rateLimit("stock-alerts", clientIp(req), 10, 10 * 60 * 1000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  if (raw.length > MAX_BYTES) {
    return Response.json({ ok: false, error: "too_large" }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const email = sessionEmail(req) ?? normalizeEmail(body?.email);
  if (!isEmail(email)) {
    return Response.json({ ok: false, error: "bad_email" }, { status: 400 });
  }

  try {
    const ok = await addStockAlert({ email, productId: body.productId, lang: body.lang });
    if (!ok) return Response.json({ ok: false, error: "unknown_item" }, { status: 400 });
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/stock-alerts] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
