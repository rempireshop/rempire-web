import { NextResponse } from "next/server";
import { getOrderByNumber, getOrderByShipmentId, type Order } from "@/lib/orders";
import { allow, clientIp } from "@/lib/payments/ratelimit";
import { montonioShippingConfig } from "@/lib/shipping/montonio";
import { applyShipmentUpdate } from "@/lib/shipping/shipment-sync";
import {
  isLabelFileEvent,
  recordShipmentStatus,
  ShipmentWebhookError,
  verifyShipmentWebhook,
  type ShipmentEvent,
} from "@/lib/shipping/webhook";

/**
 * POST /api/shipping/notify/ — Montonio Shipping's parcel events.
 *
 * The parcel half of what /api/payments/notify/ is for money, and built to the
 * same rules, because the reasons are the same ones:
 *
 *   · the signed token is the security boundary. It is verified with our own
 *     secret, HS256 only, and refused if it names another store's accessKey —
 *     src/lib/shipping/webhook.ts, which follows the payment provider's
 *     verifyToken() line for line;
 *   · a 200 for anything it has understood — including a repeat, and including
 *     an event about a shipment this shop has no order for; 4xx only when the
 *     token itself is unusable, which no retry can fix; 503 when our own
 *     database is the thing that failed. The retry policy is Montonio's
 *     answer of 24.09.2026, no longer a guess (audit F27 asked): «15 attempts
 *     total. The first retry happens after about 10 seconds, and the interval
 *     grows exponentially … roughly 1.5–2 days». So a 503 buys a redelivery,
 *     and an event can arrive two days late — after a newer one, which is why
 *     applyShipmentUpdate() (src/lib/shipping/shipment-sync.ts) never moves a
 *     parcel backwards on a webhook;
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
 * Montonio is pointed at this address once, by API — it has no screen for it:
 * `tools/montonio-webhook.mjs register <url>` (Dim, with the live keys). The
 * trailing slash matters: `trailingSlash` is on in next.config.ts and a POST
 * without it becomes a 308. See docs/shipping.md and docs/go-live.md.
 *
 * Which of Montonio's six events do what here (enum confirmed 24.09.2026):
 *   · `shipment.statusUpdated`, `shipment.registered`,
 *     `shipment.registrationFailed`, `shipment.labelsCreated` — a shipment's
 *     status, applied by applyShipmentUpdate(). `registered` also brings the
 *     tracking code of a parcel registered after the button press (a repaired
 *     refusal); `labelsCreated` keeps the stored status current. These four
 *     are tools/montonio-webhook.mjs EVENTS.
 *   · `labelFile.ready`, `labelFile.creationFailed` — about a PDF, not a
 *     parcel. Acknowledged and ignored (isLabelFileEvent): labels are made
 *     synchronously, on the owner's press, and their URL lives five minutes.
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

  /* A label file is not a parcel: its `data.status` is «ready» or «failed»,
     and «failed» in the status vocabulary — or on an order — would read as a
     refused shipment. Signed and ours, so 200; nothing to do. */
  if (isLabelFileEvent(event.event)) {
    return NextResponse.json({ ok: true, ignored: "label_file" });
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

  /* Everything that follows is applyShipmentUpdate() —
     src/lib/shipping/shipment-sync.ts, one update whoever brings the news:
     the word onto the order (never backwards: a retried event can be two days
     late), a tracking code the order lacks (a parcel registered after the
     button press — a repaired refusal), the journal row for a refusal, and
     «delivered» closing a `shipped` order. Only the status and a missing
     tracking code are ever written: the id was written by «Создать этикетку»
     from Montonio's own answer, and a webhook is not the place to invent a
     parcel the panel never booked.

     The refusal is read TWO ways, because only one is documented: the word
     `registrationFailed`, and the event NAME `shipment.registrationFailed`
     that the webhook is registered with (audit F23) — a live body may carry
     the shipment at `pending` with the failure only in `eventType`. Sandbox
     never sends it; it calls no carriers (docs/montonio-untested.md, S1). */
  let result;
  try {
    result = await applyShipmentUpdate(
      order,
      {
        status: seen.word,
        event: event.event,
        shipmentId: event.shipmentId,
        trackingCode: event.trackingCode,
        trackingUrl: event.trackingUrl,
        dropOffPin: event.dropOffPin,
      },
      { source: "webhook" },
    );
  } catch (err) {
    console.error(`shipping/notify: could not close ${order.number}`, err);
    return NextResponse.json({ ok: false, error: "apply_failed" }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    status: seen.word,
    meaning: seen.meaning || "unknown",
    number: order.number,
    applied: result.applied || undefined,
    stale: result.stale || undefined,
    ignored: result.otherShipment ? "other_shipment" : undefined,
  });
}

export function GET() {
  return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
