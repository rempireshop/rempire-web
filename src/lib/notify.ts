/**
 * Shared forwarding to Dmitri — Telegram + Resend email.
 *
 * Extracted from /api/submit so every route that stores something can
 * notify the same way. Each channel is gated on env config:
 *  - Telegram: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 *  - Email:    RESEND_API_KEY (+ optional RESEND_FROM / RESEND_TO)
 * Neither ever throws — a forwarding failure returns false so it can
 * never fail the caller's request. Storage is the contract.
 */

const TELEGRAM_CHUNK = 3500; // API hard limit is 4096 chars per message

export async function forwardTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const chunks = text.match(
      new RegExp(`[\\s\\S]{1,${TELEGRAM_CHUNK}}`, "g"),
    ) ?? [text];
    for (const chunk of chunks) {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: chunk }),
        },
      );
      if (!res.ok) return false;
    }
    return true;
  } catch (err) {
    console.error("telegram forward failed", err);
    return false;
  }
}

export async function forwardEmail(
  subject: string,
  text: string,
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM ?? "REMPIRE QA <onboarding@resend.dev>",
        to: [process.env.RESEND_TO ?? "dim.novare@gmail.com"],
        subject,
        text,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("email forward failed", err);
    return false;
  }
}
