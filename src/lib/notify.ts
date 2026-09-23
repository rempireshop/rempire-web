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
 * Since 20.09.2026 there is a third, and it is NOT in this file: Web Push to
 * the «Админка» on Renat's Home Screen (src/lib/push.ts, VAPID_PUBLIC_KEY +
 * VAPID_PRIVATE_KEY). It keeps its own module because it has a table behind it
 * and these two have nothing but an environment variable. pingOwner() fires
 * all three side by side, and these two remain the fallback: a push permission
 * is a thing a phone can take away without telling anybody.
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
 * …and since 23.09.2026 the owner can see that without a log. Renat: «Phone
 * notification arrived — e-mail to shop@rempireshop.com not.» Part of that is
 * by design (pingOwner() in src/lib/mail-hooks.ts sends the letter only when
 * no phone took the push, and says so in the log now), part of it is this
 * variable: «Подключения» draws a red line from ownerMailConfig() when it is
 * missing, and «Проверить» there sends one real letter through
 * sendOwnerMail(), so a Resend refusal comes back as Resend's own sentence.
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

/**
 * What the owner's letter needs, as the panel may see it — «Подключения» draws
 * its row from this (GET /api/admin/notify/). Whether the key is there, never
 * the key; and the address itself, because it is the shop's own mailbox and
 * the one thing the owner has to recognise.
 */
export interface OwnerMailConfig {
  key: boolean;
  to: string;
}

export function ownerMailConfig(): OwnerMailConfig {
  return {
    key: Boolean((process.env.RESEND_API_KEY ?? "").trim()),
    to: (process.env.RESEND_TO ?? "").trim(),
  };
}

/**
 * Why a letter did or did not go. `not_configured` is RESEND_TO; `send_failed`
 * carries Resend's own status and sentence (an unverified domain, a revoked
 * key) — the words «Подключения» → «Проверить» shows, and the words the log
 * now prints. They used to be thrown away: `res.ok` was all anybody kept.
 */
export type OwnerMailResult =
  | { ok: true; to: string }
  | { ok: false; error: "no_api_key" | "not_configured" | "send_failed"; status?: number; detail?: string };

/** Resend's `message` (or `name`), capped — never the request, never the key. */
async function refusalOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown; name?: unknown };
    const said = typeof body?.message === "string" ? body.message : typeof body?.name === "string" ? body.name : "";
    return said.slice(0, 200);
  } catch {
    return "";
  }
}

export async function sendOwnerMail(subject: string, text: string): Promise<OwnerMailResult> {
  const { key: hasKey, to } = ownerMailConfig();
  const key = (process.env.RESEND_API_KEY ?? "").trim();
  if (!hasKey) {
    /* No key means no mail of any kind — the customers' letters say so in
       their own log line (src/lib/mail.ts); this one says whose letter it was. */
    console.warn("[notify] RESEND_API_KEY is not set — the owner's e-mail ping was not sent.");
    return { ok: false, error: "no_api_key" };
  }

  /* Once per ping, deliberately, not once per instance: this shop takes a
     handful of orders a month, so the line is cheap, and a misconfiguration
     that only prints on a cold start is one nobody finds. */
  if (!to) {
    console.warn(
      "[notify] RESEND_TO is not set — the owner's e-mail pings are off. " +
        "Set it to the shop's address (shop@rempireshop.com, docs/accounts.md). " +
        "Nothing is sent rather than a letter to whoever the default used to be.",
    );
    return { ok: false, error: "not_configured" };
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
    if (res.ok) return { ok: true, to };
    /* The case the log used to swallow whole: RESEND_TO set, the key set, and
       Resend saying no. Status and sentence, so «why did shop@ get nothing»
       has an answer in Vercel's log and not only a `false`. */
    const detail = await refusalOf(res);
    console.error(`[notify] Resend refused the owner's letter to ${to}: ${res.status} ${detail}`.trim());
    return { ok: false, error: "send_failed", status: res.status, ...(detail ? { detail } : {}) };
  } catch (err) {
    console.error("[notify] the owner's letter could not reach Resend:", err);
    return { ok: false, error: "send_failed", detail: "network" };
  }
}

export async function forwardEmail(
  subject: string,
  text: string,
): Promise<boolean> {
  return (await sendOwnerMail(subject, text)).ok;
}
