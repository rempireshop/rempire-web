/**
 * The owner's own pings — Telegram + Resend e-mail. **Not** customer mail:
 * that is src/lib/mail.ts, and it goes to the address on the order.
 *
 * These are the "a new order arrived" messages a shopkeeper wants on his
 * phone. The only caller today is src/lib/mail-hooks.ts (pingOwner).
 *
 * Each channel is gated on its own environment variables:
 *  - Telegram: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 *  - E-mail:   RESEND_API_KEY **and RESEND_TO** (+ optional RESEND_FROM)
 *
 * RESEND_TO has no default and must not get one. Until 07.09.2026 it fell
 * back to `info@diipsolutions.eu` — the developer's own address — with
 * Resend's `onboarding@resend.dev` as the sender, so an unconfigured
 * production shop mailed a third party every order it took, and looked
 * configured while doing it (Appendix B 10, docs/audit/2026-09-07-cleanup.md).
 * Now: no RESEND_TO, no letter, and a line in the log saying so. Better the
 * owner misses a ping he can switch on than a stranger reads his orders.
 * The intended value is the shop's own address, `shop@rempireshop.com` —
 * docs/accounts.md.
 *
 * Neither channel ever throws — a forwarding failure returns false so it can
 * never fail the caller's request. The order is the contract, not the ping.
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

/* The sender the shop's customer mail already uses (src/lib/mail.ts) — a
   verified address on the shop's own domain. It is a safe default because it
   says who the letter is from; the *recipient* is the one that may not have
   one. */
const DEFAULT_FROM = "Rempire <shop@rempireshop.com>";

export async function forwardEmail(
  subject: string,
  text: string,
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;

  /* Once per ping, deliberately, not once per instance: this shop takes a
     handful of orders a month, so the line is cheap, and a misconfiguration
     that only prints on a cold start is one nobody finds. */
  const to = (process.env.RESEND_TO ?? "").trim();
  if (!to) {
    console.warn(
      "[notify] RESEND_TO is not set — the owner's e-mail pings are off. " +
        "Set it to the shop's address (shop@rempireshop.com, docs/accounts.md). " +
        "Nothing is sent rather than a letter to whoever the default used to be.",
    );
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: (process.env.RESEND_FROM ?? "").trim() || DEFAULT_FROM,
        to: [to],
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
