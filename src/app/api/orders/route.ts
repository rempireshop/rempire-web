/**
 * POST /api/orders — the checkout's one write.
 *
 * The body carries ids, not prices: {lang, items:[{id, variant?, qty}],
 * customer:{name,email,phone}, shipping:{method,country,pointId?,pointName?,
 * address?}, discountCode?}. Everything money-shaped is recomputed in
 * src/lib/orders.ts, so a doctored cart cannot buy a 25 € bottle for 1 €.
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { createOrder, OrderError } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (rateLimit("orders", ip, 10, 60_000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
  }

  try {
    const order = await createOrder(body as Parameters<typeof createOrder>[0]);
    return Response.json(
      { ok: true, orderId: order.id, number: order.number, total: order.total },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof OrderError) {
      return Response.json({ ok: false, error: err.code, detail: err.detail }, { status: 400 });
    }
    console.error("[api/orders] failed:", err);
    return Response.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
