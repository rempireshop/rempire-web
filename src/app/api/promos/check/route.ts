/**
 * POST /api/promos/check   { code, subtotal?, shipping? }
 *   → { ok: true,  code, kind, value, discount, freeShipping, minSubtotal }
 *   → { ok: false, error }
 *
 * The checkout's «Промокод» box. Read-only: it quotes what the code would take
 * off this basket and spends nothing — the use is counted when the payment is
 * confirmed (src/lib/payments/apply.ts).
 *
 * Public, so it is rate-limited per IP: 20 tries a minute is generous for a
 * shopper retyping a code and useless for walking the code space. Errors are
 * deliberately specific («срок вышел», «не хватает до 40 €») — the code was
 * printed on a flyer, and «неверный код» for an expired one just costs Renat
 * a support message.
 *
 * NB: POST to "/api/promos/check/" WITH the trailing slash (trailingSlash: true).
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { normalisePromoCode, quotePromo } from "@/lib/promos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2_000;
const NO_STORE = { "cache-control": "no-store" } as const;

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (rateLimit("promo-check", ip, 20, 60_000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  if (raw.length > MAX_BYTES) {
    return Response.json({ ok: false, error: "too_large" }, { status: 413, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400, headers: NO_STORE });
  }

  const code = normalisePromoCode(body.code);
  if (!code) {
    return Response.json({ ok: false, error: "bad_code" }, { status: 400, headers: NO_STORE });
  }

  const subtotal = Math.max(0, Math.min(100_000, Number(body.subtotal) || 0));
  const shipping = Math.max(0, Math.min(1_000, Number(body.shipping) || 0));

  try {
    const quote = await quotePromo(code, subtotal, shipping);
    if (!quote.ok) {
      return Response.json(
        { ok: false, error: quote.error, code, minSubtotal: quote.minSubtotal },
        { status: 200, headers: NO_STORE },
      );
    }
    return Response.json(
      {
        ok: true,
        code: quote.code,
        kind: quote.kind,
        value: quote.value,
        discount: quote.discount,
        freeShipping: quote.freeShipping,
        minSubtotal: quote.minSubtotal,
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("[api/promos/check] failed:", err);
    // No database is not «код неверный» — say so, so the shopper retries later
    return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
