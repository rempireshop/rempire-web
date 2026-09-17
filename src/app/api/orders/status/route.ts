/**
 * POST /api/orders/status/  { orderId, token }  →  { ok: true, paid: boolean }
 *
 * The shop's one question about an order it made and then lost sight of: was
 * it paid? Asked at boot by the browser that is still holding the basket that
 * went to the bank, when no receipt ever came back to settle it — see
 * heldAsk() in public/shop2/app.js and src/lib/payments/order-status.ts for
 * why guessing instead is a second payment.
 *
 * ONE BIT, AND NOTHING ELSE. No number, no total, no e-mail, no lines, not
 * even «this order exists». `token` is an HMAC of the id under SESSION_SECRET
 * (POST /api/orders/ handed it to the browser that placed the order), it is
 * checked before the database is touched, and everything that is not a real
 * order with its own token — an invented id, a stolen id with no token, a
 * guessed token, a body of the wrong shape — answers the same 404
 * `not_found`. An order id is therefore worth nothing on its own: it cannot
 * be used to find out that an order exists, to enumerate the ones around it,
 * or to learn anything about whoever placed it.
 *
 * POST rather than GET on purpose: the token is a credential, and a query
 * string ends up in access logs, in `Referer` and in the address bar.
 *
 * Note the trailing slash — next.config has trailingSlash: true, and a POST
 * to the bare path 308s.
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { getOrder } from "@/lib/orders";
import { orderCountsAsPaid, verifyOrderStatusToken } from "@/lib/payments/order-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

/* A browser asks this once per page load, and only while it is holding a
   basket for an order it never saw a receipt for. Anything past this is
   someone working through ids — which learns them nothing anyway, but there
   is no reason to let it run. */
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

/** The one refusal this route has. Every failing path answers exactly this. */
function notFound() {
  return Response.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });
}

export async function POST(req: Request) {
  if (rateLimit("order-status", clientIp(req), RATE_LIMIT, RATE_WINDOW_MS)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return notFound();
  }
  /* `null` is valid JSON and `typeof null === "object"`; so are a bare number
     and an array. All of them read as «no order, no token» below, and all of
     them get the same answer as a wrong token. */
  if (!body || typeof body !== "object" || Array.isArray(body)) return notFound();

  const orderId = typeof (body as { orderId?: unknown }).orderId === "string"
    ? (body as { orderId: string }).orderId.trim()
    : "";
  const token = typeof (body as { token?: unknown }).token === "string"
    ? (body as { token: string }).token.trim()
    : "";

  /* Before the database, always. This is what keeps an order id worthless on
     its own: with no token to check against, a real id and an invented one
     take the same path, cost the same time and get the same answer. */
  if (!orderId || orderId.length > 64 || !verifyOrderStatusToken(orderId, token)) return notFound();

  let row: unknown;
  try {
    row = await getOrder(orderId);
  } catch (err) {
    /* The shop cannot say. The basket stays parked — app.js restores on a
       definite «not paid» and on nothing else. */
    console.error("[api/orders/status] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
  /* A token that verifies for an id no order carries: the order was deleted,
     or the secret was reused across two databases. Same answer as everything
     else — there is nothing to tell. */
  if (!row) return notFound();

  return Response.json(
    { ok: true, paid: orderCountsAsPaid((row as { status?: unknown }).status) },
    { headers: NO_STORE },
  );
}

export function GET() {
  return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405, headers: NO_STORE });
}
