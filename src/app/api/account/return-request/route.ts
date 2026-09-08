/**
 * POST /api/account/return-request — «Хочу вернуть заказ».
 *
 * Body `{number}`. Requires the `rmp_cust` cookie: this is a signed-in
 * customer ticking their own delivered order, never something a guest — or
 * somebody holding another customer's order number — can ask for. The order is
 * looked up by number and then matched against the address the cookie proved;
 * an order belonging to anybody else answers `not_found`, exactly as a number
 * that does not exist does, so the route tells a guesser nothing.
 *
 * All the tick does is record that a return was asked for and when
 * (src/lib/returns.ts — Montonio gives the shop no return codes and no return
 * endpoint, so there is nothing else it could honestly do). The owner sees it
 * in «Сделать сегодня» on «Обзор», the same queue a new review and a partner
 * request arrive in, and on the order's own card; then a person writes back.
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { normalizeEmail, sessionEmail } from "@/lib/customers";
import { getOrderByNumber, writeAuditSafe } from "@/lib/orders";
import { recordReturnRequest } from "@/lib/returns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 500;
const NO_STORE = { "cache-control": "no-store" } as const;

export async function POST(req: Request) {
  const email = sessionEmail(req);
  if (!email) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (rateLimit("return-request", clientIp(req), 10, 60_000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400, headers: NO_STORE });
  }
  if (raw.length > MAX_BYTES) {
    return Response.json({ ok: false, error: "too_large" }, { status: 413, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400, headers: NO_STORE });
  }

  const number = String(body.number ?? "").trim().slice(0, 40);
  if (!number) {
    return Response.json({ ok: false, error: "bad_order" }, { status: 400, headers: NO_STORE });
  }

  try {
    const order = await getOrderByNumber(number);
    if (!order || normalizeEmail(order.email) !== normalizeEmail(email)) {
      return Response.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });
    }

    const out = await recordReturnRequest(order);
    if (!out.ok) {
      return Response.json({ ok: false, error: out.error }, { status: 409, headers: NO_STORE });
    }
    /* The journal gets the tick once, on the first one — a second tap changes
       nothing on the order and must not fill the log with repeats. The actor
       is the customer's own address: this is the one row in admin_audit that
       nobody in the panel wrote. */
    if (!out.repeat) {
      await writeAuditSafe(normalizeEmail(email), "order.return_request", {
        orderId: order.id,
        number: order.number,
        at: out.at,
      });
    }
    return Response.json({ ok: true, at: out.at }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/account/return-request] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
