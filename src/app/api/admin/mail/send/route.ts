/**
 * POST /api/admin/mail/send — send the owner's reply to a customer.
 *
 *   { orderId: "<uuid or R-100042>", customerMessage?: "...", reply: "..." }
 *   → { ok: true, messageId, messages: OrderMessage[] }
 *
 * Behind requireAdmin, rate-limited 30/hour per admin (same idiom as
 * POST /api/admin/mail/test and POST /api/admin/ai/text). Sends through
 * src/lib/mail.ts (Resend), subject "Re: заказ <number>", reply-to left to
 * sendMail()'s own default (MAIL_REPLY_TO env, else info@rempireshop.com —
 * exactly "reply-to info@" from the task brief, with nothing to override
 * here). On a successful send both sides of the exchange are stored in
 * order_messages (src/lib/order-messages.ts) — the pasted-in customer
 * message (if any) as one 'in' row, the reply as one 'out' row — so the
 * thread under the order is complete from the first reply onward.
 *
 * NB trailing slash: next.config has trailingSlash: true — POST to
 * "/api/admin/mail/send/" or the request 308s and the body is dropped.
 */
import { clientIp, rateLimit, requireAdmin } from "@/lib/auth";
import { getOrder, getOrderByNumber, writeAuditSafe } from "@/lib/orders";
import { mailConfigured, sendMail } from "@/lib/mail";
import { addMessage, listMessages, type OrderMessage } from "@/lib/order-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 20_000;
const RATE_MAX = 30;
const RATE_WINDOW_MS = 3_600_000;

function bad(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status });
}

async function findOrder(id: string) {
  return (await getOrder(id)) ?? (await getOrderByNumber(id));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Small, self-contained letter — not the transactional shell() templates in
 *  src/emails (those are owned by the mail agent and built for receipts, not
 *  a free-form reply); paragraphs from blank-line breaks, inline styles only. */
function renderReplyMail(bodyText: string, orderNumber: string): { html: string; text: string } {
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px;white-space:pre-line">${escapeHtml(p)}</p>`)
    .join("");
  const html = `<div style="background:#edeae1;padding:24px 12px;font-family:'Golos Text',Arial,Helvetica,sans-serif">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e1d6;border-radius:6px;padding:28px 24px;color:#1c1a00;font-size:15px;line-height:1.55">
${paragraphs}
<p style="margin:22px 0 0;padding-top:14px;border-top:1px solid #e5e1d6;color:#6f6b57;font-size:12.5px">Заказ ${escapeHtml(orderNumber)} · rempireshop.com</p>
</div></div>`;
  return { html, text: bodyText };
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  if (rateLimit("mail-send", clientIp(req), RATE_MAX, RATE_WINDOW_MS)) {
    return bad("rate_limited", 429);
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return bad("bad_request");
  }
  if (raw.length > MAX_BYTES) return bad("too_large", 413);

  let body: { orderId?: unknown; customerMessage?: unknown; reply?: unknown };
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return bad("bad_json");
  }

  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const reply = typeof body.reply === "string" ? body.reply.trim() : "";
  const customerMessage = typeof body.customerMessage === "string" ? body.customerMessage.trim() : "";
  if (!orderId) return bad("no_order");
  if (!reply) return bad("empty_reply");
  if (reply.length > 8000) return bad("reply_too_long");

  if (!mailConfigured()) {
    return Response.json({ ok: false, skipped: true, error: "no_api_key" }, { status: 503 });
  }

  let order;
  try {
    order = await findOrder(orderId);
  } catch (err) {
    console.error("[admin/mail/send] order lookup failed", err);
    return bad("db_unavailable", 503);
  }
  if (!order) return bad("order_not_found", 404);
  if (!order.email) return bad("no_customer_email");

  const mail = renderReplyMail(reply, order.number);
  const res = await sendMail({
    to: order.email,
    subject: `Re: заказ ${order.number}`,
    html: mail.html,
    text: mail.text,
    tags: { type: "admin-reply", order: order.number.replace(/[^A-Za-z0-9_-]/g, "") },
  });

  if (!res.ok) {
    console.error("[admin/mail/send] send failed", order.number, res.error);
    return Response.json({ ok: false, error: res.error || "send_failed" }, { status: 502 });
  }

  try {
    if (customerMessage) await addMessage(order.id, "in", customerMessage);
    await addMessage(order.id, "out", reply, { subject: `Re: заказ ${order.number}`, resendId: res.id ?? null });
  } catch (err) {
    // The letter is already sent — losing the thread row must not look like
    // the reply itself failed, so this is logged, not surfaced as an error.
    console.error("[admin/mail/send] storing the thread failed", order.number, err);
  }

  await writeAuditSafe("admin", "mail.send", { orderId: order.id, number: order.number, resendId: res.id ?? null });

  let messages: OrderMessage[];
  try {
    messages = await listMessages(order.id);
  } catch (err) {
    console.error("[admin/mail/send] thread reload failed", err);
    messages = [];
  }

  return Response.json({ ok: true, messageId: res.id ?? null, messages }, { headers: { "cache-control": "no-store" } });
}

export function GET(): Response {
  return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
