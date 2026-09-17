/**
 * POST /api/orders — the checkout's one write.
 *
 * The body carries ids, not prices: {lang, items:[{id, variant?, qty}],
 * customer:{name,email,phone}, shipping:{method,country,carrier?,pointId?,
 * pointName?,pointType?,address?}, discountCode?, notes?}. Everything money-shaped is
 * recomputed in src/lib/orders.ts, so a doctored cart cannot buy a 25 € bottle
 * for 1 €; every shipping field is rebuilt there from a whitelist.
 *
 * ONE ORDER PER TAP. The checkout sends an `Idempotency-Key` header, minted
 * when the shopper commits to this order and kept for as long as the answer is
 * unknown (payNow() in public/shop2/app.js). The worst case this is for: the
 * shopper taps «Оплатить», the phone changes cell, the answer never arrives —
 * the shop has numbered the order and, for «По счёту», already mailed a real
 * invoice to a real customer — and the shopper taps again. With the key, the
 * second tap is handed the FIRST order back, byte for byte, and creates
 * nothing. Without one (an older cached app.min.js) the route behaves exactly
 * as it did before: runOnce() runs an unkeyed call straight through.
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { recordMarketingConsent } from "@/lib/consent";
import { getCustomer, normalizeEmail, sessionEmail } from "@/lib/customers";
import { fingerprintOf, type IdempotentAnswer, readIdempotencyKey, runOnce } from "@/lib/idempotency";
import { createOrder, OrderError } from "@/lib/orders";
import { orderStatusToken } from "@/lib/payments/order-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* An order is a few hundred bytes. Anything past this is someone testing what
   the jsonb columns will swallow — read the text first, cap it, then parse
   (audit M2), the same shape reviews/ and giftcards/ already use. */
const MAX_BYTES = 16_000;

/** What the key is stored against — see src/lib/idempotency.ts `mismatch`. */
const ROUTE = "POST /api/orders";
const NO_STORE = { "cache-control": "no-store" };

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (rateLimit("orders", ip, 10, 60_000)) {
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

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
  }

  /* Everything below happens at most once per key. The guards above are
     deliberately outside it: a rate limit and a malformed body are answers
     about THIS request, and there is no order to protect from a second one. */
  const done = await runOnce(
    { key: readIdempotencyKey(req), route: ROUTE, fingerprint: fingerprintOf(raw) },
    async (): Promise<IdempotentAnswer> => {
      /* wholesale/loyalty: who is checking out, if anyone — resolved from the
         signed `rmp_cust` cookie, never from the body. createOrder() uses this
         both for pro pricing and to stamp orders.customer_id, so a signed-in
         shopper's order is theirs even before this page existed to say so. */
      let customerId: string | null = null;
      /* …and, separately, WHICH mailbox that session belongs to. The lookup
         below can fail (a database hiccup prices the order as a guest and says
         so); the address itself comes straight off the signed cookie and is
         the only proof this route has that the person typing an address into
         the checkout owns it. Read before createOrder, used after it — see the
         consent note below. */
      const signedInAs = sessionEmail(req);
      try {
        if (signedInAs) customerId = (await getCustomer(signedInAs))?.id ?? null;
      } catch (err) {
        console.error("[api/orders] customer lookup failed, pricing as a guest:", err);
      }

      try {
        /* `channel` and `posDiscountPercent` belong to the in-salon till
           (POST /api/admin/pos-orders, behind requireAdmin) — createOrder() reads
           both straight off its input, so passing this body through unchanged let
           an anonymous shopper send {"channel":"pos","posDiscountPercent":90} and
           price their own order at a tenth. This door is the web checkout: it
           says so itself and never takes the till's percent from a browser. */
        const input = { ...(body as Parameters<typeof createOrder>[0]), channel: "web" as const, posDiscountPercent: null };
        const order = await createOrder(input, { customerId });
        /* «По счёту — для компаний»: the order was numbered and the invoice
           mailed inside createOrder() (src/lib/invoices.ts); the checkout shows
           the number, the due date and where the letter went, and calls no
           payment page. Absent on every other order. */
        /* «Хочу получать скидки и поздравление ко дню рождения» — stored against
           the address the order was placed from, after the order exists and never
           before: a consent recorded for a checkout that then failed would be a
           subscriber who never bought anything. Awaited but never fatal (the
           helper swallows its own errors), stamped «checkout», and it only ever
           switches the consent ON: not ticking a box at a checkout is not a
           withdrawal — the shopper may have said yes in their account last month,
           and an order is no place to revoke that silently (src/lib/consent.ts).

           `proven` is the whole of Dim's answer of 17.09.2026. This door is
           open to guests by design, and it asks for no proof that the address
           in the box is the poster's — so a tick here may record a consent but
           may NOT take an address off the stop list somebody else put it on.
           Only a shopper signed in ON THAT MAILBOX has proved it is theirs;
           the comparison is against the signed cookie and against nothing in
           the body, which is the same reasoning that makes createOrder() take
           `customerId` from the session and never from the JSON. */
        if ((body as { newsletter?: unknown }).newsletter === true) {
          await recordMarketingConsent(order.email, (body as { lang?: unknown }).lang, "checkout", {
            proven: !!signedInAs && normalizeEmail(signedInAs) === normalizeEmail(order.email),
          });
        }

        const inv = order.invoice;
        const invoice = inv && typeof inv.number === "string"
          ? {
              number: inv.number,
              dueAt: String(inv.dueAt ?? ""),
              dueDays: Number(inv.dueDays) || 7,
              email: String(inv.email ?? order.email),
              /* Whether the letter really left. A blank IBAN blocks the send
                 (src/lib/invoices.ts invoiceSendBlock) and so does a mail outage;
                 the receipt must not say «Счёт отправлен на …» when nothing was. */
              sent: !!inv.sentAt,
            }
          : undefined;
        /* `statusToken` — the one thing the browser that placed this order
           may later prove about it: that it is allowed to ask whether the
           order was paid (POST /api/orders/status/). It is an HMAC of the id
           under SESSION_SECRET, not a second id, so it gives this answer away
           to nobody else and unlocks nothing but that one bit. The shop parks
           it beside the basket it is about to send to the bank (holdCart() in
           public/shop2/app.js) — see src/lib/payments/order-status.ts for
           what it is for. "" on a shop with no SESSION_SECRET, which the shop
           reads as «there is nothing to ask with» and simply does not ask. */
        return {
          status: 201,
          body: {
            ok: true, orderId: order.id, number: order.number, total: order.total,
            statusToken: orderStatusToken(order.id),
            ...(invoice ? { invoice } : {}),
          },
        };
      } catch (err) {
        /* Caught here rather than thrown on: a refusal is an answer, and
           runOnce() lets the key go on anything past 399 — so the shopper
           whose address was refused fixes it and sends the corrected order
           under the same key instead of being handed the old complaint. */
        if (err instanceof OrderError) {
          return { status: 400, body: { ok: false, error: err.code, detail: err.detail } };
        }
        console.error("[api/orders] failed:", err);
        return { status: 500, body: { ok: false, error: "server_error" } };
      }
    },
  );

  /* Not an error, and the checkout must not dress it as one: the shopper's own
     first tap is still being carried out somewhere else, so there is nothing to
     answer with yet and nothing was run here. */
  if (done.outcome === "in_flight") {
    return Response.json({ ok: false, error: "in_progress" }, { status: 409, headers: NO_STORE });
  }
  /* This key already belongs to a different body or a different route — a
     client that lost track of itself. Refused rather than answered with
     somebody else's order; the checkout mints a fresh key and tries again. */
  if (done.outcome === "mismatch") {
    return Response.json({ ok: false, error: "key_reused" }, { status: 409, headers: NO_STORE });
  }
  return Response.json(done.body, { status: done.status, headers: NO_STORE });
}
