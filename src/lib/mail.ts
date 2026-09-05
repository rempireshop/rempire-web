/**
 * Outbound customer mail — Resend REST over fetch, no SDK.
 *
 * Same shape as src/lib/notify.ts (which forwards *to us* over the same
 * account): every channel is gated on env, and nothing in here ever throws.
 * An order that was paid for must not fail because a mail provider had a bad
 * minute — the caller gets `{ ok: false }` and the order flow carries on.
 *
 * Env:
 *   RESEND_API_KEY   — required to actually send; missing ⇒ skipped
 *   RESEND_FROM      — "Rempire <shop@rempireshop.com>" by default
 *   MAIL_REPLY_TO    — where customer replies land; info@rempireshop.com by default
 *   MAIL_RETRY_DELAY_MS — pause before the single 5xx retry (default 400)
 */

const ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_REPLY_TO = "info@rempireshop.com";
const DEFAULT_FROM = "Rempire <shop@rempireshop.com>";
const TIMEOUT_MS = 12_000;
const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

export interface MailTag {
  name: string;
  value: string;
}

/**
 * One file riding along with the letter. Resend takes attachments inline as
 * base64 (`{filename, content, content_type}`), so the bytes go in the same
 * POST as the HTML — no second request, no signed URL to expire.
 *
 * The only user of this today is the gift card's own PDF
 * (src/lib/giftcard-pdf.ts, attached in src/lib/mail-hooks.ts): a gift is
 * handed over, and a card you have to fetch from a link is not.
 */
export interface MailAttachment {
  filename: string;
  /** Raw bytes, or an already-base64 string. */
  content: Uint8Array | Buffer | string;
  contentType?: string;
}

export interface SendMailInput {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  /** Overrides MAIL_REPLY_TO for this one letter. */
  replyTo?: string | string[];
  /** Resend tags — `{ template: "order-confirmed" }` or the array form. */
  tags?: Record<string, string> | MailTag[];
  /** Overrides RESEND_FROM. Only for the rare second sender identity. */
  from?: string;
  /** Resend de-duplicates retries carrying the same key for 24 h. */
  idempotencyKey?: string;
  /** Files to send with the letter. Empty/oversized entries are dropped. */
  attachments?: MailAttachment[];
}

export interface SendMailResult {
  ok: boolean;
  /** True when we deliberately did not send (no key, no valid recipient). */
  skipped?: boolean;
  /** Resend message id on success. */
  id?: string;
  status?: number;
  error?: string;
  /** True when the first attempt got a 5xx and the retry was used. */
  retried?: boolean;
}

/* ---------- helpers ----------------------------------------------------- */

function recipients(to: string | string[]): string[] {
  const list = Array.isArray(to) ? to : String(to ?? "").split(/[,;]/);
  const seen = new Set<string>();
  for (const raw of list) {
    const v = String(raw ?? "").trim();
    if (v && EMAIL_RX.test(v)) seen.add(v);
  }
  return [...seen];
}

/** Resend only accepts ASCII letters, digits, `_` and `-` in tags. */
function normalizeTags(
  tags: SendMailInput["tags"],
): MailTag[] | undefined {
  if (!tags) return undefined;
  const pairs: MailTag[] = Array.isArray(tags)
    ? tags
    : Object.entries(tags).map(([name, value]) => ({ name, value }));
  const clean = pairs
    .map((t) => ({
      name: String(t.name ?? "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60),
      value: String(t.value ?? "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60),
    }))
    .filter((t) => t.name && t.value);
  return clean.length ? clean : undefined;
}

/* Resend caps a message (body + attachments, after base64) at 40 MB; a gift
   card is ~25 KB, so anything anywhere near this is a bug upstream, not a big
   present. Dropped rather than sent: a letter with the code in it is still
   worth delivering. */
const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

function attachmentPayload(list: MailAttachment[] | undefined): Array<Record<string, string>> | undefined {
  if (!list || !list.length) return undefined;
  const out: Array<Record<string, string>> = [];
  for (const a of list) {
    const filename = String(a?.filename ?? "").replace(/[^\w.@ -]+/g, "_").slice(0, 120);
    if (!filename || !a?.content) continue;
    const content =
      typeof a.content === "string" ? a.content : Buffer.from(a.content).toString("base64");
    if (!content || content.length > ATTACHMENT_MAX_BYTES * 1.4) {
      console.warn("[mail] attachment dropped (too large):", filename);
      continue;
    }
    const entry: Record<string, string> = { filename, content };
    if (a.contentType) entry.content_type = String(a.contentType).slice(0, 100);
    out.push(entry);
  }
  return out.length ? out : undefined;
}

/** The names only — what the e2e sink records and what the tests assert. */
function attachmentNames(list: MailAttachment[] | undefined): string[] {
  return (list ?? [])
    .map((a) => String(a?.filename ?? "").trim())
    .filter(Boolean);
}

function retryDelay(): number {
  const raw = Number(process.env.MAIL_RETRY_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 400;
}

function sleep(ms: number): Promise<void> {
  return ms > 0
    ? new Promise((r) => setTimeout(r, ms))
    : Promise.resolve();
}

/** The reply-to policy lives in one place: env, unless the caller overrode it. */
export function replyToAddress(
  override?: string | string[],
): string | string[] | undefined {
  if (override && (!Array.isArray(override) || override.length)) return override;
  const env = (process.env.MAIL_REPLY_TO ?? "").trim();
  /* info@rempireshop.com is a real address now — Cloudflare Email Routing
     forwards it to the shop's mailbox — so it is the default a customer sees,
     and it is the same address the letter's own footer prints. MAIL_REPLY_TO
     still wins when someone wants replies elsewhere. */
  return env || DEFAULT_REPLY_TO;
}

export function fromAddress(override?: string): string {
  return (
    (override ?? "").trim() ||
    (process.env.RESEND_FROM ?? "").trim() ||
    DEFAULT_FROM
  );
}

/* ---------- the e2e sink ------------------------------------------------- */

/**
 * What sendMail() was *asked* to send, kept in memory for the e2e suite.
 *
 * The suite runs with `RESEND_API_KEY` empty on purpose, so every send is
 * skipped and there is no mailbox to read (docs/testing.md). Without this
 * there is no way for a browser test to prove that the letter the owner
 * edited in «Письма» is the letter a real paid order produces — only that the
 * *preview* changed, which is the half that could not regress.
 *
 * Double-gated exactly like `/api/e2e/gift-card/`: `NODE_ENV` must not be
 * "production" **and** `E2E_BOOTSTRAP` must be "1". It records the subject and
 * recipient, never the body. Reading it back is `GET /api/e2e/mail/`, which
 * additionally needs the admin cookie.
 *
 * On globalThis, not a module variable: `next dev` re-evaluates modules per
 * route on edit, and the writer (a payment route) and the reader (the e2e
 * route) must see the same array — the same reasoning as the pool in
 * src/lib/db.ts.
 */
export interface CapturedMail {
  at: number;
  to: string[];
  subject: string;
  template: string;
  /** File names only — never the bytes. [] for a letter with no attachment. */
  attachments: string[];
  /**
   * The http(s) links the plain-text body carries, in order, capped — not
   * the body. The order flow's spec has to prove that «Заказ отправлен» went
   * out WITH the carrier's tracking link (the one thing that letter is for),
   * and a link is the smallest thing that proves it. A letter with no plain
   * text records [].
   */
  links: string[];
}

const CAPTURE_MAX = 50;
const g = globalThis as unknown as { __rempireMailSink?: CapturedMail[] };

function sinkOn(): boolean {
  return (
    process.env.NODE_ENV !== "production" && process.env.E2E_BOOTSTRAP === "1"
  );
}

function templateTag(tags: SendMailInput["tags"]): string {
  if (!tags) return "";
  if (Array.isArray(tags)) {
    const hit = tags.find((t) => t && t.name === "template");
    return hit ? String(hit.value ?? "") : "";
  }
  return String(tags.template ?? "");
}

const LINK_RX = /https?:\/\/[^\s<>"')\]]+/g;
const LINKS_MAX = 12;

/** Every http(s) URL in the plain-text body, first LINKS_MAX, each capped. */
function bodyLinks(text: string | undefined): string[] {
  const out: string[] = [];
  for (const m of String(text ?? "").matchAll(LINK_RX)) {
    out.push(m[0].slice(0, 300));
    if (out.length >= LINKS_MAX) break;
  }
  return out;
}

function capture(input: SendMailInput): void {
  if (!sinkOn()) return;
  const list = (g.__rempireMailSink ??= []);
  list.push({
    at: Date.now(),
    to: recipients(input.to),
    subject: String(input.subject ?? "").trim(),
    template: templateTag(input.tags),
    /* Names, not bytes — the same rule as the body: enough for a browser test
       to prove «письмо с карточкой ушло с PDF», nothing a log could leak. */
    attachments: attachmentNames(input.attachments),
    links: bodyLinks(input.text),
  });
  if (list.length > CAPTURE_MAX) list.splice(0, list.length - CAPTURE_MAX);
}

/** Newest last. Empty unless the two e2e gates above are both open. */
export function capturedMail(): CapturedMail[] {
  return sinkOn() ? (g.__rempireMailSink ?? []).slice() : [];
}

/* ---------- send -------------------------------------------------------- */

interface Attempt {
  status: number;
  id?: string;
  error?: string;
  /** Network-level failure — no HTTP status at all. */
  network?: boolean;
}

async function attempt(
  key: string,
  payload: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Attempt> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* Resend answers JSON; a body we cannot parse is not fatal by itself. */
    }
    const rec = (body ?? {}) as { id?: string; message?: string; name?: string };

    if (res.ok) return { status: res.status, id: rec.id };
    return {
      status: res.status,
      error: rec.message || rec.name || `http_${res.status}`,
    };
  } catch (err) {
    return {
      status: 0,
      network: true,
      error: err instanceof Error ? err.message : "network_error",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send one letter. Retries exactly once on a 5xx (or a network error), then
 * gives up and reports. Never throws.
 */
export async function sendMail(
  input: SendMailInput,
): Promise<SendMailResult> {
  // Before the key check: in the e2e suite there is no key, and "what would
  // have gone out" is exactly what the suite needs to see.
  capture(input);

  const key = (process.env.RESEND_API_KEY ?? "").trim();
  if (!key) {
    console.warn(
      "[mail] RESEND_API_KEY is not set — skipping:",
      input.subject,
    );
    return { ok: false, skipped: true, error: "no_api_key" };
  }

  const to = recipients(input.to);
  if (!to.length) {
    console.warn("[mail] no valid recipient — skipping:", input.subject);
    return { ok: false, skipped: true, error: "no_recipient" };
  }

  const subject = String(input.subject ?? "").trim() || "Rempire";
  if (!input.html && !input.text) {
    console.warn("[mail] empty body — skipping:", subject);
    return { ok: false, skipped: true, error: "empty_body" };
  }

  const payload: Record<string, unknown> = {
    from: fromAddress(input.from),
    to,
    subject,
  };
  if (input.html) payload.html = input.html;
  if (input.text) payload.text = input.text;

  const reply = replyToAddress(input.replyTo);
  if (reply) payload.reply_to = reply;

  const tags = normalizeTags(input.tags);
  if (tags) payload.tags = tags;

  const attachments = attachmentPayload(input.attachments);
  if (attachments) payload.attachments = attachments;

  let res = await attempt(key, payload, input.idempotencyKey);
  let retried = false;

  if (!res.id && (res.network || res.status >= 500)) {
    retried = true;
    await sleep(retryDelay());
    res = await attempt(key, payload, input.idempotencyKey);
  }

  if (res.id || (res.status >= 200 && res.status < 300)) {
    return { ok: true, id: res.id, status: res.status, retried };
  }

  console.error(
    "[mail] send failed",
    res.status,
    res.error,
    "→",
    to.join(", "),
  );
  return {
    ok: false,
    status: res.status,
    error: res.error || `http_${res.status}`,
    retried,
  };
}

/** Convenience for the renderers' `{ subject, html, text }` output. */
export async function sendRendered(
  to: string | string[],
  mail: { subject: string; html: string; text: string },
  extra: Omit<SendMailInput, "to" | "subject" | "html" | "text"> = {},
): Promise<SendMailResult> {
  return sendMail({
    to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    ...extra,
  });
}

/** True when a real send would happen — used by the admin test route. */
export function mailConfigured(): boolean {
  return Boolean((process.env.RESEND_API_KEY ?? "").trim());
}
