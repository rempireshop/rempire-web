/**
 * Marketing consent, and the way out of it.
 *
 * The tick «Хочу получать скидки и поздравление ко дню рождения» (the checkout
 * and the account form) lands on `customers.marketing`. Until 10.09.2026 that
 * was a bare boolean — nobody could say when it was ticked or where — and the
 * «Отписаться» link under the three marketing letters only opened the account
 * page, which does nothing for a guest with no account and nothing at all for
 * the abandoned-cart reminder, which never looked at the tick. The owner chose
 * the honest minimum (db/migrations/052_marketing_consent.sql):
 *
 *   · the consent is stamped — `marketing_at` (when it was switched on),
 *     `marketing_source` (where: checkout / account / admin) and
 *     `marketing_off_at` (when it was last switched off);
 *   · the link in the letter is real — `/api/mail/unsubscribe/?u=…&t=…`, one
 *     HMAC per mailbox, no sign-in needed — and every marketing letter carries
 *     the `List-Unsubscribe` + `List-Unsubscribe-Post` headers (RFC 8058), so
 *     the mail client's own «Отписаться» button works too;
 *   · `mail_optouts` is the stop list. An address in it gets no abandoned-cart
 *     reminder and no birthday letter, whether or not a customers row exists —
 *     a guest with a cart has none. A «снова в наличии» alert is something the
 *     shopper asked for by name, so it is never blocked by that list; its own
 *     link (kind "backstock") cancels the person's pending alerts instead.
 *
 * The rule that keeps the two halves honest: the latest expression of will
 * wins. The link takes an address out (and turns the tick off on the row); a
 * later tick at the checkout or in the account puts it back and clears the
 * opt-out. Nothing here is a newsletter — there is still no list to send from.
 *
 * Nothing in here is allowed to be a hard dependency of the shop: the consent
 * writers never throw (a consent that could not be stored must not fail an
 * order that has already been paid for); the readers may, and the flows treat
 * "the stop list could not be read" as "send nothing" — the safe direction.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { baseUrl } from "@/emails/layout";
import { isEmail, normalizeEmail, normalizeLangCode, type LangCode } from "@/lib/customers";
import { query, withTx } from "@/lib/db";
import { replyToAddress } from "@/lib/mail";

/** Where a consent was given. */
export type ConsentSource = "checkout" | "account" | "admin";

/** Which letter's link took the address out. */
export type OptOutKind = "marketing" | "backstock";

/** How: the page a human opened, or the mail client's one-click POST. */
export type OptOutSource = "link" | "one-click";

const KINDS: readonly OptOutKind[] = ["marketing", "backstock"];

/* ---------- the tick ------------------------------------------------------ */

/**
 * The tick went ON — at the checkout (`POST /api/orders`, `newsletter: true`),
 * in the account form, or by the owner. Creates the row for an address that
 * has never signed in (that is what makes a guest's consent storable at all)
 * and stamps when and where. A tick on a row that is already on keeps its
 * original stamp: the panel's «согласие с …» is the day it was given, not the
 * day the form was last saved.
 *
 * Clears the address from mail_optouts — a fresh, explicit yes supersedes an
 * older «Отписаться» (see the note at the top). Never throws.
 */
export async function recordMarketingConsent(
  email: string,
  lang?: unknown,
  source: ConsentSource = "checkout",
): Promise<boolean> {
  const addr = normalizeEmail(email);
  if (!addr || !isEmail(addr)) return false;
  try {
    await withTx(async (q) => {
      await q(
        `insert into customers (email, lang, marketing, marketing_at, marketing_source)
         values ($1, $2, true, now(), $3)
         on conflict (email) do update set
           marketing = true,
           marketing_at = case
             when customers.marketing and customers.marketing_at is not null then customers.marketing_at
             else now() end,
           marketing_source = case
             when customers.marketing and customers.marketing_at is not null then customers.marketing_source
             else $3 end`,
        [addr, normalizeLangCode(lang), source],
      );
      await q("delete from mail_optouts where email = $1", [addr]);
    });
    return true;
  } catch (err) {
    console.error("[consent] marketing consent not stored:", err);
    return false;
  }
}

/**
 * The tick went OFF — the account form, or the owner. Only ever an update:
 * an address with no row has nothing to withdraw. The off-stamp moves only on
 * the real transition, so saving an already-unticked form changes nothing.
 *
 * `source` is where the withdrawal came from. It is not stored — the owner's
 * honest minimum has one off-stamp and no off-source — but every call site
 * says it, so a column can follow without touching them. Never throws.
 */
export async function withdrawMarketingConsent(email: string, source: ConsentSource = "account"): Promise<boolean> {
  const addr = normalizeEmail(email);
  if (!addr || !isEmail(addr)) return false;
  try {
    await query(
      `update customers set
         marketing = false,
         marketing_off_at = case when marketing then now() else marketing_off_at end
       where email = $1`,
      [addr],
    );
    return true;
  } catch (err) {
    console.error(`[consent] marketing consent not withdrawn (${source}):`, err);
    return false;
  }
}

/* ---------- the stop list ------------------------------------------------- */

/**
 * «Отписаться» from a letter. Puts the address on the stop list (a second
 * click only moves the date), turns the tick off on the customers row when
 * there is one, and — for the back-in-stock link — cancels every alert this
 * address is still waiting on, so the letter the person just refused is the
 * last of its kind. Alerts already sent are history and stay as they are.
 *
 * Throws when the database does: the route answers 503 and the person can
 * try the link again, which is better than a page that says «отписаны» over a
 * row that was never written.
 */
export async function optOut(email: string, kind: OptOutKind, source: OptOutSource = "link"): Promise<boolean> {
  const addr = normalizeEmail(email);
  if (!addr || !isEmail(addr)) return false;
  const k: OptOutKind = KINDS.includes(kind) ? kind : "marketing";
  await withTx(async (q) => {
    await q(
      `insert into mail_optouts (email, at, kind, source) values ($1, now(), $2, $3)
       on conflict (email) do update set at = now(), kind = $2, source = $3`,
      [addr, k, source === "one-click" ? "one-click" : "link"],
    );
    await q(
      `update customers set
         marketing = false,
         marketing_off_at = case when marketing then now() else marketing_off_at end
       where email = $1`,
      [addr],
    );
    if (k === "backstock") {
      await q("delete from stock_alerts where email = $1 and sent_at is null", [addr]);
    }
  });
  return true;
}

/** Is this address on the stop list? */
export async function isOptedOut(email: string): Promise<boolean> {
  const addr = normalizeEmail(email);
  if (!addr) return false;
  const rows = await query<{ email: string }>("select email from mail_optouts where email = $1", [addr]);
  return rows.length > 0;
}

/**
 * The subset of `emails` that is on the stop list — one query for a whole
 * batch of carts or birthdays. Placeholders rather than an array parameter:
 * the two drivers disagree about how a JS array becomes a Postgres one, and a
 * batch is a hundred holes at most.
 */
export async function optedOutSet(emails: string[]): Promise<Set<string>> {
  const list = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  const out = new Set<string>();
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    const holes = chunk.map((_, j) => `$${j + 1}`).join(",");
    const rows = await query<{ email: string }>(`select email from mail_optouts where email in (${holes})`, chunk);
    for (const r of rows) out.add(r.email);
  }
  return out;
}

/* ---------- the link ------------------------------------------------------ */

/* The same key and the same fallback as the resume link (resumeKey() in
   src/lib/flows.ts): one secret for the links a letter carries. The `unsub.`
   prefix keeps this signature apart from that one, so a resume token can
   never be replayed as an unsubscribe token or the other way round. */
function signingKey(): string {
  const s = process.env.SESSION_SECRET;
  return s && s.length >= 16 ? s : "rempire-resume-cart";
}

/**
 * One token per mailbox, no expiry: the link in a letter from last year has
 * to keep working, and the worst a stolen one can do is take its own address
 * off a list. Base64url of HMAC-SHA256(`unsub.<address>`).
 */
export function unsubscribeToken(email: string): string {
  return createHmac("sha256", signingKey()).update(`unsub.${normalizeEmail(email)}`).digest("base64url");
}

/** What a link carries besides the token: the address, the letter's kind, the letter's language. */
export interface UnsubscribeParams {
  email: string;
  kind: OptOutKind;
  lang: LangCode;
}

function encodeParams(email: string, kind: OptOutKind, lang: LangCode): string {
  return Buffer.from(`${email}|${kind}|${lang}`, "utf8").toString("base64url");
}

/**
 * `${baseUrl()}/api/mail/unsubscribe/?u=<base64url "email|kind|lang">&t=<token>`
 * — absolute, with the trailing slash the app's routes answer at (a mail
 * client's one-click POST follows no redirect, so the address has to be the
 * final one from the start).
 */
export function unsubscribeUrl(email: string, lang: unknown, kind: OptOutKind): string {
  const addr = normalizeEmail(email);
  const u = encodeParams(addr, KINDS.includes(kind) ? kind : "marketing", normalizeLangCode(lang));
  return `${baseUrl()}/api/mail/unsubscribe/?u=${u}&t=${unsubscribeToken(addr)}`;
}

/**
 * The bare mailbox behind the reply-to policy (`MAIL_REPLY_TO`, or the shop's
 * info@) — where a hand-written «отпишите меня» lands, and the address the
 * error page tells people to write to. Empty when nothing usable is set.
 */
export function supportAddress(): string {
  const reply = replyToAddress();
  const raw = String((Array.isArray(reply) ? reply[0] : reply) ?? "").trim();
  const m = /<([^<>\s]+)>/.exec(raw);
  const addr = (m ? m[1] : raw).trim();
  return isEmail(addr) ? addr : "";
}

/**
 * RFC 8058: the https link and the one-click marker, plus the mailto form for
 * clients that only speak that one. Passed to sendMail() as `headers`.
 */
export function unsubscribeHeaders(email: string, lang: unknown, kind: OptOutKind): Record<string, string> {
  const url = unsubscribeUrl(email, lang, kind);
  const mailbox = supportAddress();
  return {
    "List-Unsubscribe": mailbox ? `<${url}>, <mailto:${mailbox}?subject=unsubscribe>` : `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export type UnsubscribeCheck =
  | ({ ok: true } & UnsubscribeParams)
  | { ok: false; lang: LangCode };

/**
 * Verifies `u` against `t`. The language comes back even when the token does
 * not check out, so the refusal is worded in the letter's language rather
 * than in Russian for everybody; nothing else from a bad link is trusted.
 */
export function readUnsubscribeParams(u: string | null | undefined, t: string | null | undefined): UnsubscribeCheck {
  const raw = String(u ?? "").slice(0, 400);
  const token = String(t ?? "").slice(0, 200);
  const decoded = /^[A-Za-z0-9_-]+$/.test(raw) ? Buffer.from(raw, "base64url").toString("utf8") : "";
  const [rawEmail = "", rawKind = "", rawLang = ""] = decoded.split("|");
  const lang = normalizeLangCode(rawLang);
  const email = normalizeEmail(rawEmail);
  if (!isEmail(email) || !KINDS.includes(rawKind as OptOutKind)) return { ok: false, lang };
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return { ok: false, lang };
  const want = Buffer.from(unsubscribeToken(email));
  const got = Buffer.from(token);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, lang };
  return { ok: true, email, kind: rawKind as OptOutKind, lang };
}

/** `renat@example.com` → `r***@example.com` — enough to recognise, nothing to harvest. */
export function maskEmail(email: string): string {
  const addr = normalizeEmail(email);
  const at = addr.indexOf("@");
  if (at < 1) return "***";
  return `${addr[0]}***${addr.slice(at)}`;
}
