import { NextResponse } from "next/server";
import { getOrderByNumber, getOrderByShipmentId, setOrderStatus, type Order } from "@/lib/orders";
import { allow, clientIp } from "@/lib/payments/ratelimit";
import { montonioShippingConfig, saveShipmentOnOrder } from "@/lib/shipping/montonio";
import {
  recordShipmentStatus,
  ShipmentWebhookError,
  verifyShipmentWebhook,
  type ShipmentEvent,
} from "@/lib/shipping/webhook";

/**
 * POST /api/shipping/notify/ — Montonio Shipping's `shipment.statusUpdated`.
 *
 * The parcel half of what /api/payments/notify/ is for money, and built to the
 * same rules, because the reasons are the same ones:
 *
 *   · the signed token is the security boundary. It is verified with our own
 *     secret, HS256 only, and refused if it names another store's accessKey —
 *     src/lib/shipping/webhook.ts, which follows the payment provider's
 *     verifyToken() line for line;
 *   · Montonio retries a failed delivery for 48 hours and expects 200/201, so
 *     this answers 200 for anything it has understood — including a repeat, and
 *     including an event about a shipment this shop has no order for. It
 *     answers 4xx only when the token itself is unusable, which retrying cannot
 *     fix, and 503 when our own database is the thing that failed;
 *   · nothing here is written twice. The status word goes into
 *     `settings.shipping_statuses` under its own name, and the order only
 *     changes on the one transition that has not happened yet.
 *
 * Why it exists at all: until today `src/lib/delivery.ts` guessed at the
 * carrier's vocabulary from a white list of six words, because Montonio's
 * reference does not print the values of that field. Dim, 08.09.2026:
 * «register `shipment.statusUpdated` and watch what actually arrives». So the
 * first job of this route is to write down every distinct status it is sent;
 * the white list still decides what to do with one, and stays marked as the
 * stopgap it is.
 *
 * Renat has to point Montonio at this address once — Partner system →
 * Shipping → Webhooks — the same way `notificationUrl` points at the payment
 * one. The trailing slash matters: `trailingSlash` is on in next.config.ts and
 * a POST without it becomes a 308. See docs/shipping.md.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Same generous-but-finite limit as the payment webhook: the token is what
   makes this safe, the limiter is what stops a replay loop from becoming a
   bill. A busy day is a few dozen parcels moving a few steps each. */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

export async function POST(req: Request) {
  if (!allow(`ship:notify:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const config = montonioShippingConfig();
  if (!config) {
    /* No keys ⇒ nothing signed can be checked, so nothing can be believed —
       the same refusal the payment webhook makes without a provider (audit C1).
       A shop with no Montonio keys has no Montonio parcels either. */
    console.error("shipping/notify: montonio is not configured");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  let event: ShipmentEvent;
  try {
    event = verifyShipmentWebhook(body, config);
  } catch (err) {
    console.error(
      "shipping/notify: token rejected",
      err instanceof ShipmentWebhookError ? err.code : err,
    );
    // Never retryable, and never something to act on: refuse it and say so.
    return NextResponse.json({ ok: false, error: "bad_token" }, { status: 400 });
  }

  /* The recording comes before anything else this route does. It is the
     reason the endpoint exists, it is the same one line whether or not the
     order is ours, and a database that cannot take it is worth a retry. */
  let seen;
  try {
    seen = await recordShipmentStatus(event);
  } catch {
    return NextResponse.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
  if (!seen.word) {
    // An event with no status in it — a sibling webhook, or a shape we do not
    // read yet. Understood, nothing to write: 200, so it is not redelivered.
    return NextResponse.json({ ok: true, ignored: "no_status" });
  }

  let order: Order | null;
  try {
    order = event.orderRef ? await getOrderByNumber(event.orderRef) : null;
    if (!order && event.shipmentId) order = await getOrderByShipmentId(event.shipmentId);
  } catch (err) {
    // A database blip IS retryable — ask for the redelivery.
    console.error("shipping/notify: lookup failed", err);
    return NextResponse.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
  if (!order) {
    /* Nothing to update and nothing a retry would fix — a parcel booked
       elsewhere, or an order deleted since. The word itself is already
       recorded, which is the part worth keeping. */
    console.error("shipping/notify: no order for shipment", event.shipmentId || event.orderRef);
    return NextResponse.json({ ok: true, status: seen.word, ignored: "unknown_shipment" });
  }

  /* Only the status is merged into `orders.shipping.montonio`, never an id or
     a tracking code: those were written by «Создать этикетку» from Montonio's
     own answer, and a webhook is not the place to invent a parcel the panel
     never booked. */
  try {
    await saveShipmentOnOrder(order.id, { status: seen.word, statusAt: new Date().toISOString() });
  } catch (err) {
    // Worth recording, not worth a redelivery: the vocabulary already has it.
    console.error("shipping/notify: could not store the status on the order", err);
  }

  /* The white-list fallback, doing the one thing it is trusted with. Only from
     `shipped`, so an order Renat has already closed by hand is not touched, a
     repeat of the same webhook finds nothing to do, and a parcel that has come
     back (looksReturned → "returned") is deliberately left open: it is on its
     way to Renat, not to the customer. `system` is the actor the nightly cron
     uses for the same transition, and the journal says «магазин сам». */
  let applied = "";
  if (seen.meaning === "delivered" && order.status === "shipped") {
    try {
      await setOrderStatus(order.id, "delivered", "system");
      applied = "delivered";
    } catch (err) {
      console.error(`shipping/notify: could not close ${order.number}`, err);
      return NextResponse.json({ ok: false, error: "apply_failed" }, { status: 503 });
    }
  }

  return NextResponse.json({
    ok: true,
    status: seen.word,
    meaning: seen.meaning || "unknown",
    number: order.number,
    applied: applied || undefined,
  });
}

export function GET() {
  return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
