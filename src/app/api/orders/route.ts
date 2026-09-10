/**
 * POST /api/orders — the checkout's one write.
 *
 * The body carries ids, not prices: {lang, items:[{id, variant?, qty}],
 * customer:{name,email,phone}, shipping:{method,country,carrier?,pointId?,
 * pointName?,address?}, discountCode?, notes?}. Everything money-shaped is
 * recomputed in src/lib/orders.ts, so a doctored cart cannot buy a 25 € bottle
 * for 1 €; every shipping field is rebuilt there from a whitelist.
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { recordMarketingConsent } from "@/lib/consent";
import { getCustomer, sessionEmail } from "@/lib/customers";
import { createOrder, OrderError } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* An order is a few hundred bytes. Anything past this is someone testing what
   the jsonb columns will swallow — read the text first, cap it, then parse
   (audit M2), the same shape reviews/ and giftcards/ already use. */
const MAX_BYTES = 16_000;

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

  /* wholesale/loyalty: who is checking out, if anyone — resolved from the
     signed `rmp_cust` cookie, never from the body. createOrder() uses this
     both for pro pricing and to stamp orders.customer_id, so a signed-in
     shopper's order is theirs even before this page existed to say so. */
  let customerId: string | null = null;
  try {
    const email = sessionEmail(req);
    if (email) customerId = (await getCustomer(email))?.id ?? null;
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
       and an order is no place to revoke that silently (src/lib/consent.ts). */
    if ((body as { newsletter?: unknown }).newsletter === true) {
      await recordMarketingConsent(order.email, (body as { lang?: unknown }).lang, "checkout");
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
    return Response.json(
      { ok: true, orderId: order.id, number: order.number, total: order.total, ...(invoice ? { invoice } : {}) },
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
