/**
 * POST /api/admin/pos-orders/ — «Продажа в салоне», the in-salon quick sale.
 *
 * Body: { items: [{id, variant?, qty}], customer?: {email?, phone?, name?},
 *         payment: {method: "cash"|"terminal"}, discountPercent?: 0..90 }
 *
 * Unlike POST /api/orders/ (the storefront checkout) this never touches
 * Montonio: the till already has the money the moment this call is made, so
 * the order is created and settled in the same request — createOrder() with
 * channel:'pos' (see src/lib/orders.ts), then **the same door a confirmed
 * bank payment goes through**, settlePayment() (src/lib/payments/settle.ts).
 *
 * That door is the point. Until 07.09.2026 this route wrote the payment blob
 * and the status by hand, which looked identical and was not: everything that
 * hangs off the single transition into paid was skipped. A sale rung up in
 * the room earned no loyalty points, wrote no `purchase` event (so the salon's
 * takings were missing from «Аналитика» — the one screen that is supposed to
 * say what the shop sold), and sent the customer nothing, while the register
 * screen offered a printable receipt and an e-mail box next to each other.
 * Now the salon sale is a paid order like any other — points, the revenue row,
 * the «Заказ принят» letter when an address was typed — and the only thing
 * kept from the old path is the stock reason: 'sale_pos', not 'sale_web', so
 * «Склад → Продажа в салоне» still tells the two apart (that is what the
 * `decrementStock` dependency below is for). Best effort as before: the sale
 * already happened in the room, and a stock hiccup, a mail outage or a
 * missing points programme must never make the register screen show a
 * failure.
 */
import { requireAdmin } from "@/lib/auth";
import { getCustomer, isEmail, normalizeEmail } from "@/lib/customers";
import { query } from "@/lib/db";
import { createOrder, OrderError, setOrderPayment, type Order } from "@/lib/orders";
import { settlePayment } from "@/lib/payments/settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 16_000;
const METHODS = new Set(["cash", "terminal"]);
/** What the order journal says about a till sale — the method in words. */
const METHOD_WORD: Record<string, string> = { cash: "наличные", terminal: "терминал" };

/**
 * The shelf, the salon way: reason 'sale_pos', so the ledger and its
 * «Продажа в салоне» filter keep telling a till sale from a web one. Handed
 * to settlePayment() as a dependency instead of running after it, because
 * stock belongs to the paid transition and must happen exactly once with it.
 * Per line, best effort: one product's hiccup must not cost the rest.
 */
async function decrementPosStock(order: {
  number: string;
  items: Array<{ id: string; kind?: string; variant?: string | null; qty: number }>;
}): Promise<void> {
  const { move } = await import("@/lib/inventory");
  for (const line of order.items) {
    if (line.kind !== "product" || !line.qty) continue;
    try {
      await move({
        productId: line.id,
        variant: line.variant ?? "",
        delta: -Math.abs(Number(line.qty) || 0),
        reason: "sale_pos",
        ref: order.number,
        actor: "admin",
      });
    } catch (err) {
      console.error(`[api/admin/pos-orders] stock decrement failed on ${line.id}:`, err);
    }
  }
}

/**
 * Tie the sale to the customer card the typed address already belongs to, so
 * the points land somewhere and the sale shows up in «Клиенты».
 *
 * Deliberately NOT done by handing `customerId` to createOrder(): that would
 * also switch the basket to pro pricing, and the register charges what its
 * chips say — the screen and the receipt would stop agreeing the first time a
 * partner salon's own owner bought a bottle for himself. `pricing_tier` is
 * therefore stamped 'retail', which is the honest record of what was charged.
 * Never creates a customer: an address typed at the till is not a sign-up.
 */
async function attachCustomer(order: Order): Promise<Order> {
  const email = normalizeEmail(order.email);
  if (!email || !isEmail(email)) return order;
  try {
    const customer = await getCustomer(email);
    if (!customer) return order;
    await query("update orders set customer_id = $2, pricing_tier = 'retail' where id = $1 and customer_id is null", [
      order.id,
      customer.id,
    ]);
    return { ...order, customerId: customer.id, pricingTier: "retail" };
  } catch (err) {
    console.error("[api/admin/pos-orders] customer lookup failed, settling as a walk-in:", err);
    return order;
  }
}

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

    /* The method is written first and settlePayment()'s blob merges on top of
       it (setOrderPayment() is `||`, not `=`) — the same order the zero-total
       path uses in src/lib/payments/settle.ts, and the reason the order card
       goes on saying «наличные» rather than only «pos». */
    const paidAt = new Date().toISOString();
    await setOrderPayment(order.id, { provider: "pos", method, bank: null, at: paidAt });

    const settled = await attachCustomer(order);
    let mailed = false;
    try {
      await settlePayment(
        settled,
        {
          orderRef: settled.number,
          status: "paid",
          providerRef: "",
          amount: Number(settled.total) || 0,
          currency: settled.currency || "EUR",
          detail: `продажа в салоне, ${METHOD_WORD[method] ?? method}`,
        },
        "pos",
        { decrementStock: decrementPosStock },
      );
      /* What the register screen turns into «чек ушёл на почту»: an address
         was given and the settlement handed the «Заказ принят» letter to the
         mail layer. It is the same claim every other letter in this shop
         makes — src/lib/mail.ts swallows a Resend outage by design — and it
         is deliberately NOT the invoice's `sentAt`: there the shop refuses to
         send at all when the IBAN is blank, which is a state of our own
         making and therefore one the screen must not paper over. */
      mailed = !!settled.email;
    } catch (err) {
      /* The money is in the till and the order row exists; a settlement that
         threw is something to fix on the order card, not a failure to show on
         the register screen while a customer is standing there. */
      console.error("[api/admin/pos-orders] settle failed:", err);
    }

    return Response.json(
      { ok: true, orderId: order.id, number: order.number, total: order.total, mailed },
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
