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
 *
 * HELD TEN SECONDS since 25.09.2026 (admin redesign 1a, Dim's q3 — every
 * customer letter the owner's tap sends waits so «Вернуть» can stop it; see
 * src/lib/letter-hold.ts). Everything that can refuse the letter up front
 * still does — the rate limit, the text, the mail key, the order and its
 * address — and then the route answers at once:
 *
 *   → { ok: true, held: true, kind: "reply", token, ms, messages }
 *
 * `messages` is the thread as it stands (the new letter is not in it yet).
 * Ten seconds later, unless PATCH /api/admin/orders/<id>/ { letterCancel:
 * token } took it back, the letter goes and both sides of the exchange are
 * stored, exactly as they were stored before; a letter Resend refuses then
 * stores nothing, and the panel — which reads the thread again after the
 * hold — says it did not go.
 */
import { clientIp, rateLimit, requireAdmin } from "@/lib/auth";
import { getOrder, getOrderByNumber, writeAuditSafe } from "@/lib/orders";
import { holdAndSend } from "@/lib/letter-hold";
import { mailConfigured, sendMail } from "@/lib/mail";
import { addMessage, listMessages, type OrderMessage } from "@/lib/order-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// the letter leaves from after(), ten seconds after the answer
export const maxDuration = 60;

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

  /* `null` is valid JSON and `typeof null === "object"`, so the parse above
     lets it through and every field read below throws — a 500 from a
     two-byte body. Same door for a bare number, string or array. */
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("bad_body");

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

  /** The send itself — now, when the hold could not be written, or ten
      seconds from now. The address is the order's as it is THEN. */
  let sentNow: { ok: boolean; id: string | null; error?: string } | null = null;
  const deliver = async (now: { id: string; number: string; email: string }) => {
    if (!now.email) return;
    const mail = renderReplyMail(reply, now.number);
    const res = await sendMail({
      to: now.email,
      subject: `Re: заказ ${now.number}`,
      html: mail.html,
      text: mail.text,
      tags: { type: "admin-reply", order: now.number.replace(/[^A-Za-z0-9_-]/g, "") },
    });
    sentNow = { ok: res.ok, id: res.id ?? null, error: res.error };
    if (!res.ok) {
      console.error("[admin/mail/send] send failed", now.number, res.error);
      return;
    }
    try {
      if (customerMessage) await addMessage(now.id, "in", customerMessage);
      await addMessage(now.id, "out", reply, { subject: `Re: заказ ${now.number}`, resendId: res.id ?? null });
    } catch (err) {
      // The letter is already sent — losing the thread row must not look like
      // the reply itself failed, so this is logged, not surfaced as an error.
      console.error("[admin/mail/send] storing the thread failed", now.number, err);
    }
    await writeAuditSafe("admin", "mail.send", { orderId: now.id, number: now.number, resendId: res.id ?? null });
  };

  const letter = await holdAndSend(order.id, "reply", deliver);

  let messages: OrderMessage[];
  try {
    messages = await listMessages(order.id);
  } catch (err) {
    console.error("[admin/mail/send] thread reload failed", err);
    messages = [];
  }

  if (!letter.held) {
    // the old way: it has just gone (or not) inside this request
    const sent = sentNow as { ok: boolean; id: string | null; error?: string } | null;
    if (!sent || !sent.ok) {
      return Response.json({ ok: false, error: (sent && sent.error) || "send_failed" }, { status: 502 });
    }
    return Response.json({ ok: true, messageId: sent.id, messages }, { headers: { "cache-control": "no-store" } });
  }
  return Response.json({ ok: true, ...letter, messages }, { headers: { "cache-control": "no-store" } });
}

export function GET(): Response {
  return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
