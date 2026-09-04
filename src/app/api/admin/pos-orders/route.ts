/**
 * POST /api/admin/pos-orders/ — «Продажа в салоне», the in-salon quick sale.
 *
 * Body: { items: [{id, variant?, qty}], customer?: {email?, phone?, name?},
 *         payment: {method: "cash"|"terminal"}, discountPercent?: 0..90 }
 *
 * Unlike POST /api/orders/ (the storefront checkout) this never touches
 * Montonio: the till already has the money the moment this call is made, so
 * the order is created and marked paid in the same request — createOrder()
 * with channel:'pos' (see src/lib/orders.ts), then setOrderPayment/
 * setOrderStatus, exactly the shape a verified web payment would leave
 * behind. Stock is decremented per product line with reason 'sale_pos'
 * (src/lib/inventory.ts), best effort: the sale is already done in the room,
 * a stock hiccup must not make the register screen show a failure.
 */
import { requireAdmin } from "@/lib/auth";
import { createOrder, OrderError, setOrderPayment, setOrderStatus } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 16_000;
const METHODS = new Set(["cash", "terminal"]);

type Body = {
  items?: Array<{ id?: unknown; variant?: unknown; qty?: unknown }>;
  customer?: { email?: unknown; phone?: unknown; name?: unknown };
  payment?: { method?: unknown };
  discountPercent?: unknown;
};

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  if (raw.length > MAX_BYTES) return Response.json({ ok: false, error: "too_large" }, { status: 413 });

  let body: Body;
  try {
    body = JSON.parse(raw) as Body;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  /* `null` is valid JSON and `typeof null === "object"`, so the parse above
     lets it through and every field read below throws — a 500 from a
     two-byte body. Same door for a bare number, string or array. */
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return Response.json({ ok: false, error: "empty_order" }, { status: 400 });
  const cleanItems = items.map((it) => ({
    id: String(it?.id ?? ""),
    variant: it?.variant == null ? undefined : String(it.variant),
    qty: Math.trunc(Number(it?.qty)),
  }));

  const method = typeof body.payment?.method === "string" ? body.payment.method : "";
  if (!METHODS.has(method)) return Response.json({ ok: false, error: "bad_payment_method" }, { status: 400 });

  const pctRaw = Number(body.discountPercent);
  const discountPercent = Number.isFinite(pctRaw) ? Math.min(90, Math.max(0, Math.round(pctRaw))) : 0;

  const customer = body.customer ?? {};

  try {
    const order = await createOrder({
      channel: "pos",
      items: cleanItems,
      customer: {
        name: typeof customer.name === "string" ? customer.name : undefined,
        email: typeof customer.email === "string" ? customer.email : undefined,
        phone: typeof customer.phone === "string" ? customer.phone : undefined,
      },
      shipping: { method: "pickup", country: "EE" },
      posDiscountPercent: discountPercent,
    });

    const paidAt = new Date().toISOString();
    await setOrderPayment(order.id, { provider: "pos", method, status: "paid", at: paidAt });
    const paid = (await setOrderStatus(order.id, "paid", "admin:pos")) ?? order;

    // Best effort — the sale already happened; a stock hiccup must not turn
    // into a failure on the register screen.
    try {
      const { move } = await import("@/lib/inventory");
      for (const line of paid.items) {
        if (line.kind !== "product" || !line.qty) continue;
        await move({
          productId: line.id,
          variant: line.variant ?? "",
          delta: -Math.abs(line.qty),
          reason: "sale_pos",
          ref: paid.number,
          actor: "admin",
        });
      }
    } catch (err) {
      console.error("[api/admin/pos-orders] stock decrement failed:", err);
    }

    return Response.json(
      { ok: true, orderId: paid.id, number: paid.number, total: paid.total },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof OrderError) {
      return Response.json({ ok: false, error: err.code, detail: err.detail }, { status: 400 });
    }
    console.error("[api/admin/pos-orders] failed:", err);
    return Response.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
