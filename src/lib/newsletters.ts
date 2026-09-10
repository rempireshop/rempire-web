/**
 * «Рассылка» — the owner's own letter to the people who asked for one.
 *
 * Until 10.09.2026 the tick «Хочу получать скидки и поздравление ко дню
 * рождения» bought a birthday letter and nothing else: there was a stop list,
 * a real «Отписаться» link, stamps on the consent — and no list to send from
 * (src/lib/consent.ts). This module is that list, and the letter.
 *
 * Who gets it (audienceRows): every `customers` row with `marketing = true`,
 * minus the stop list (optedOutSet — an address that pressed «Отписаться» is
 * out whatever its row says), one letter per address however it is spelled.
 * Nothing here decides consent — consent.ts is the only writer of the tick;
 * this only reads it, at the moment the send starts, and freezes the answer
 * in `newsletter_sends`.
 *
 * Which language: the reader's own (`customers.lang`) when the letter has a
 * subject and a body in it; otherwise Russian, the language the owner writes
 * in — and the panel says so before he presses «Отправить» («…получат
 * русскую версию»). A letter with no text at all, or with text but no
 * subject line anywhere, is refused rather than sent half-made.
 *
 * How it goes out (sendNewsletterBatch): the platform gives a function
 * about ten seconds, and Resend takes two requests a second, so one call
 * sends what fits in its budget — two letters at a time, a second per pair —
 * and answers `{ done:false, left }`; the panel calls again until `done`.
 * Every call is safe to repeat: the queue is the `newsletter_sends` table
 * (primary key newsletter + address — a second row for one mailbox cannot
 * exist), a row leaves the queue only when Resend has answered, and each
 * letter carries an idempotency key of its own (`news:<id>:<address>`), so a
 * call that died between Resend's answer and the row update cannot mail the
 * same person twice. `sending_at` is a lease: two calls at once, and the
 * second one is told `busy`; a lease older than the function budget belongs
 * to a call that is dead and is taken over.
 *
 * In the e2e suite there is no RESEND_API_KEY on purpose, and sendMail()
 * records what it was asked to send instead (the sink in src/lib/mail.ts).
 * Under that suite's own double gate — `NODE_ENV` not production AND
 * `E2E_BOOTSTRAP=1` — the sink counts as delivery here, so the browser test
 * can watch a real send finish and read the letters back. Anywhere else a
 * missing key refuses the send before a single row is queued (docs/mail.md).
 */
import catalogueMin from "@/data/catalogue.min.json";
import variantData from "@/data/catalogue.variants.json";
import { normalizeLang } from "@/emails/layout";
import { renderNewsletter, type NewsletterCard } from "@/emails/newsletter";
import type { RenderedEmail } from "@/emails/types";
import { sanitizeHtml } from "@/lib/blog";
import { optedOutSet, unsubscribeHeaders, unsubscribeUrl } from "@/lib/consent";
import { customMinByIds, isCustomId, type MinWithVariants } from "@/lib/custom-products";
import { isEmail, normalizeEmail, normalizeLangCode, type LangCode } from "@/lib/customers";
import { jsonbParam, query, withTx, type Querier } from "@/lib/db";
import { mailConfigured, sendMail, type SendMailResult } from "@/lib/mail";
import { getOverrides, writeAuditSafe } from "@/lib/orders";

/* ---------- shapes -------------------------------------------------------- */

export const NEWS_LANGS = ["RU", "ET", "EN"] as const;
export type NewsLang = (typeof NEWS_LANGS)[number];
export type Trilingual = Record<NewsLang, string>;
export type NewsletterStatus = "draft" | "sending" | "sent";

export interface Newsletter {
  id: string;
  status: NewsletterStatus;
  title: string;
  subject: Trilingual;
  body: Trilingual;
  products: string[];
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  sentCount: number;
  failedCount: number;
  audienceCount: number;
  /** The languages with both a subject and a body — what the letter can go out in. */
  ready: NewsLang[];
}

/** The list row: everything but the texts themselves. */
export type NewsletterSummary = Omit<Newsletter, "subject" | "body"> & { productCount: number };

export interface NewsletterInput {
  title?: unknown;
  subject?: unknown;
  body?: unknown;
  products?: unknown;
}

export interface Audience {
  RU: number;
  ET: number;
  EN: number;
  total: number;
}

export type NewsletterErrorCode =
  | "not_found"
  | "not_draft"
  | "already_sent"
  | "empty_body"
  | "no_subject"
  | "no_recipients"
  | "busy"
  | "no_api_key";

export class NewsletterError extends Error {
  code: NewsletterErrorCode;
  constructor(code: NewsletterErrorCode) {
    super(code);
    this.code = code;
  }
}

/** The HTTP status a refusal answers with — one table for the four routes. */
export function newsletterErrorStatus(code: NewsletterErrorCode | string): number {
  if (code === "not_found") return 404;
  if (code === "not_draft" || code === "already_sent" || code === "busy") return 409;
  if (code === "no_api_key") return 503;
  return 400;
}

export const TITLE_MAX = 120;
export const SUBJECT_MAX = 200;
export const BODY_MAX = 60_000;
export const PRODUCTS_MAX = 8;
/** How many addresses one letter may go to — a cap, not a plan: the shop has hundreds. */
export const AUDIENCE_MAX = 20_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT_ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

export function isNewsletterId(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/* ---------- cleaning ------------------------------------------------------ */

function line(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** The words of an allowlisted body — tags gone, entities decoded enough to count. */
function bodyWords(html: string): string {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A body is something when it has words, a picture or a product card in it. */
function bodyHasContent(html: string): boolean {
  return !!bodyWords(html) || /<img\b|data-product=/.test(html);
}

function tri(raw: unknown, clean: (v: unknown) => string): Trilingual {
  const src = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out = { RU: "", ET: "", EN: "" } as Trilingual;
  for (const L of NEWS_LANGS) out[L] = clean(src[L]);
  return out;
}

function cleanBody(v: unknown): string {
  if (typeof v !== "string") return "";
  const html = sanitizeHtml(v.slice(0, BODY_MAX));
  return bodyHasContent(html) ? html : "";
}

function cleanProducts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const id = typeof v === "string" ? v.trim() : "";
    if (!PRODUCT_ID_RE.test(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= PRODUCTS_MAX) break;
  }
  return out;
}

/** What POST and PATCH store — the whole draft, every field, nothing trusted. */
export function cleanNewsletterInput(raw: NewsletterInput | null | undefined): {
  title: string;
  subject: Trilingual;
  body: Trilingual;
  products: string[];
} {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    title: line(src.title, TITLE_MAX),
    subject: tri(src.subject, (v) => line(v, SUBJECT_MAX)),
    body: tri(src.body, cleanBody),
    products: cleanProducts(src.products),
  };
}

/** The languages a letter can go out in: a subject line and a body, both. */
export function readyLangs(n: { subject: Trilingual; body: Trilingual }): NewsLang[] {
  return NEWS_LANGS.filter((L) => n.subject[L].trim() && bodyHasContent(n.body[L]));
}

/**
 * The language a reader gets: their own when the letter has it, else the
 * owner's Russian, else whatever there is. Null when nothing is ready.
 */
export function langFor(reader: LangCode, ready: NewsLang[]): NewsLang | null {
  if (!ready.length) return null;
  if (ready.includes(reader)) return reader;
  return ready.includes("RU") ? "RU" : ready[0];
}

/* ---------- rows ---------------------------------------------------------- */

type Row = {
  id: string;
  status: string;
  title: string | null;
  subject: unknown;
  body: unknown;
  products: unknown;
  created_at: string | Date;
  updated_at: string | Date;
  sent_at: string | Date | null;
  sending_at: string | Date | null;
  sent_count: number | string;
  failed_count: number | string;
  audience_count: number | string;
};

const COLS =
  "id, status, title, subject, body, products, created_at, updated_at, sent_at, sending_at, sent_count, failed_count, audience_count";

function iso(v: string | Date | null | undefined): string | null {
  if (v == null) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function json(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function mapRow(r: Row): Newsletter {
  const subject = tri(json(r.subject), (v) => line(v, SUBJECT_MAX));
  const body = tri(json(r.body), (v) => (typeof v === "string" ? v.slice(0, BODY_MAX) : ""));
  const n: Newsletter = {
    id: String(r.id),
    status: r.status === "sent" ? "sent" : r.status === "sending" ? "sending" : "draft",
    title: r.title ?? "",
    subject,
    body,
    products: cleanProducts(json(r.products)),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    updatedAt: iso(r.updated_at) ?? new Date(0).toISOString(),
    sentAt: iso(r.sent_at),
    sentCount: Number(r.sent_count) || 0,
    failedCount: Number(r.failed_count) || 0,
    audienceCount: Number(r.audience_count) || 0,
    ready: [],
  };
  n.ready = readyLangs(n);
  return n;
}

export function summaryOf(n: Newsletter): NewsletterSummary {
  const { subject, body, ...rest } = n;
  void subject;
  void body;
  return { ...rest, productCount: n.products.length };
}

/* ---------- CRUD ---------------------------------------------------------- */

export async function listNewsletters(limit = 100): Promise<NewsletterSummary[]> {
  const rows = await query<Row>(`select ${COLS} from newsletters order by updated_at desc, id limit $1`, [
    Math.min(Math.max(Number(limit) || 100, 1), 500),
  ]);
  return rows.map((r) => summaryOf(mapRow(r)));
}

export async function getNewsletter(id: string): Promise<Newsletter | null> {
  if (!isNewsletterId(id)) return null;
  const rows = await query<Row>(`select ${COLS} from newsletters where id = $1`, [id]);
  return rows.length ? mapRow(rows[0]) : null;
}

export async function createNewsletter(raw: NewsletterInput): Promise<Newsletter> {
  const input = cleanNewsletterInput(raw);
  const rows = await query<Row>(
    `insert into newsletters (title, subject, body, products)
     values ($1, $2::jsonb, $3::jsonb, $4::jsonb)
     returning ${COLS}`,
    [input.title, jsonbParam(input.subject), jsonbParam(input.body), jsonbParam(input.products)],
  );
  return mapRow(rows[0]);
}

/** A draft, whole. A letter that has gone out (or is going out) is history and is refused. */
export async function updateNewsletter(id: string, raw: NewsletterInput): Promise<Newsletter> {
  if (!isNewsletterId(id)) throw new NewsletterError("not_found");
  const input = cleanNewsletterInput(raw);
  const rows = await query<Row>(
    `update newsletters
        set title = $2, subject = $3::jsonb, body = $4::jsonb, products = $5::jsonb, updated_at = now()
      where id = $1 and status = 'draft'
      returning ${COLS}`,
    [id, input.title, jsonbParam(input.subject), jsonbParam(input.body), jsonbParam(input.products)],
  );
  if (rows.length) return mapRow(rows[0]);
  const current = await getNewsletter(id);
  throw new NewsletterError(current ? "not_draft" : "not_found");
}

export async function deleteNewsletter(id: string): Promise<Newsletter> {
  if (!isNewsletterId(id)) throw new NewsletterError("not_found");
  const rows = await query<Row>(`delete from newsletters where id = $1 and status = 'draft' returning ${COLS}`, [id]);
  if (rows.length) return mapRow(rows[0]);
  const current = await getNewsletter(id);
  throw new NewsletterError(current ? "not_draft" : "not_found");
}

/* ---------- the audience -------------------------------------------------- */

export interface Recipient {
  email: string;
  lang: LangCode;
}

/**
 * Everybody the letter may go to, right now: the tick on, not on the stop
 * list, one row per address. Read whole — a shop with a few hundred
 * subscribers is a few hundred rows — and never cached, so the count on the
 * confirm card is the count the send will use a second later.
 */
export async function audienceRows(): Promise<Recipient[]> {
  const rows = await query<{ email: string; lang: string | null }>(
    "select email, lang from customers where marketing = true order by email limit $1",
    [AUDIENCE_MAX],
  );
  const blocked = await optedOutSet(rows.map((r) => r.email));
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const r of rows) {
    const email = normalizeEmail(r.email);
    if (!isEmail(email) || blocked.has(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, lang: normalizeLangCode(r.lang) });
  }
  return out;
}

export async function audienceCounts(): Promise<Audience> {
  const rows = await audienceRows();
  const out: Audience = { RU: 0, ET: 0, EN: 0, total: rows.length };
  for (const r of rows) out[r.lang] += 1;
  return out;
}

/* ---------- the cards ----------------------------------------------------- */

type MinRow = { id: string; b: string; n: string; c: string; p: number; s: string };
type Variants = Record<string, { sizes: string[]; prices: number[] } | undefined>;

const MIN_BY_ID = new Map((catalogueMin as MinRow[]).map((r) => [r.id, r]));
const VARIANTS = variantData as Variants;

function cheapest(prices: Array<number | null | undefined>, fallback: number): { price: number; from: boolean } {
  const list = prices.map((p) => Number(p)).filter((p) => Number.isFinite(p) && p > 0);
  if (!list.length) return { price: fallback, from: false };
  return { price: Math.min(...list), from: new Set(list).size > 1 };
}

/**
 * The cards for the ids a letter names: brand, name, the lowest price and
 * the first photo — the owner's own price and gallery winning over the
 * catalogue file, a product he has hidden or one the shop never had left
 * out rather than drawn blank. Best effort on the overrides: a database
 * hiccup costs the owner's price, never the letter.
 */
export async function newsletterCards(ids: string[]): Promise<NewsletterCard[]> {
  const want = cleanProducts(ids);
  if (!want.length) return [];
  let overrides: Awaited<ReturnType<typeof getOverrides>> = {};
  try {
    overrides = await getOverrides(want.filter((id) => !isCustomId(id)));
  } catch (err) {
    console.error("[newsletters] overrides unavailable, catalogue prices used:", err);
  }
  let custom = new Map<string, MinWithVariants>();
  try {
    custom = await customMinByIds(want);
  } catch (err) {
    console.error("[newsletters] custom products unavailable:", err);
  }
  const out: NewsletterCard[] = [];
  for (const id of want) {
    const c = custom.get(id);
    if (c) {
      if (c.min.s === "out") continue;
      const { price, from } = cheapest(c.variants?.prices ?? [c.min.p], c.min.p);
      out.push({ id, brand: c.min.b, name: c.min.n, price, priceFrom: from, img: c.img });
      continue;
    }
    const m = MIN_BY_ID.get(id);
    if (!m) continue;
    const o = overrides[id];
    if (o?.hidden) continue;
    const ladder = o?.sizes?.length ? o.sizes.map((r) => r.price) : (VARIANTS[id]?.prices ?? []);
    const base = o?.price ?? m.p;
    const { price, from } = ladder.length ? cheapest(ladder, base) : { price: base, from: false };
    const photo = o?.gallery?.[0];
    out.push({
      id,
      brand: m.b,
      name: m.n,
      price,
      priceFrom: from,
      img: photo?.thumb || photo?.url || `/shop/img/${id}-0.webp`,
    });
  }
  return out;
}

/* ---------- rendering ----------------------------------------------------- */

/**
 * The footer's company details and the owner's own footer line — the same
 * ambient override every other letter renders through (loadBrand() in
 * src/lib/mail-hooks.ts, imported lazily like the flows do). Best effort:
 * a setting that cannot be read leaves the built-in footer.
 */
export async function loadNewsletterBrand(): Promise<void> {
  try {
    const { loadBrand } = await import("@/lib/mail-hooks");
    await loadBrand();
  } catch (err) {
    console.warn("[newsletters] shop details unavailable, using defaults", err);
  }
}

/** The letter for one reader: their language, their unsubscribe link. */
export async function renderNewsletterFor(
  n: Newsletter,
  lang: NewsLang,
  email: string,
  cards?: NewsletterCard[],
): Promise<RenderedEmail> {
  const list = cards ?? (await newsletterCards(n.products));
  return renderNewsletter(
    {
      subject: n.subject[lang],
      body: n.body[lang],
      products: list,
      unsubscribeUrl: unsubscribeUrl(email, lang, "marketing"),
    },
    normalizeLang(lang),
  );
}

/* ---------- the e2e door -------------------------------------------------- */

/**
 * The e2e suite runs with no RESEND_API_KEY and reads letters off the sink
 * in src/lib/mail.ts. Under the suite's own double gate the sink is the
 * transport: a send the key would have skipped counts as delivered. Shut
 * everywhere else — the same two conditions as every other e2e door
 * (docs/testing.md).
 */
export function e2eSinkTransport(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.E2E_BOOTSTRAP === "1" && !mailConfigured();
}

/** Can a letter leave this deployment at all? */
export function newsletterMailReady(): boolean {
  return mailConfigured() || e2eSinkTransport();
}

/* ---------- the test letter ------------------------------------------------ */

/**
 * «Отправить себе тест»: the letter as it is right now, in `lang` (or in the
 * nearest language that is ready), to the address the owner typed. The
 * subject wears a [test] prefix so it is never mistaken for the real one.
 */
export async function sendNewsletterTest(
  n: Newsletter,
  to: string,
  lang: LangCode,
): Promise<{ result: SendMailResult; lang: NewsLang }> {
  const L = langFor(lang, n.ready);
  if (!L) throw new NewsletterError(n.body.RU || n.body.ET || n.body.EN ? "no_subject" : "empty_body");
  const addr = normalizeEmail(to);
  const mail = await renderNewsletterFor(n, L, addr);
  const result = await sendMail({
    to: addr,
    subject: `[test] ${mail.subject}`,
    html: mail.html,
    text: mail.text,
    tags: { template: "newsletter", lang: L.toLowerCase(), mode: "test" },
    headers: unsubscribeHeaders(addr, L, "marketing"),
  });
  if (!result.ok && result.skipped && result.error === "no_api_key" && e2eSinkTransport()) {
    return { result: { ok: true, id: "e2e-sink" }, lang: L };
  }
  return { result, lang: L };
}

/* ---------- the send ------------------------------------------------------ */

export interface BatchOptions {
  /** How long this call may keep sending before answering `done:false`. */
  budgetMs?: number;
  /** Letters in flight at once — never more than five. */
  concurrency?: number;
  /** Resend's rate: requests per second the batch keeps under. */
  perSecond?: number;
  /** After this long a batch that never reported back is presumed dead. */
  leaseMs?: number;
  /** Rows read per wave. */
  batchSize?: number;
}

export interface BatchProgress {
  done: boolean;
  sent: number;
  failed: number;
  left: number;
  total: number;
  status: NewsletterStatus;
  /** Resend asked for a pause — the panel waits this long before calling again. */
  retryAfterMs?: number;
}

const DEFAULTS: Required<BatchOptions> = {
  budgetMs: 6_500,
  concurrency: 2,
  perSecond: 2,
  leaseMs: 90_000,
  batchSize: 20,
};

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

/**
 * The first half of a send, in one transaction on the letter's own row: the
 * checks, the audience frozen into `newsletter_sends`, the status flipped
 * and the lease taken. Answers the letter as it now is.
 *
 * The audience is read before the transaction opens, not inside it: the
 * consent tables are read through the ordinary query() door, and on PGlite
 * (one connection) a query outside the transaction waits for the
 * transaction — which is waiting for the query. A tick given in the
 * millisecond between the read and the lock catches the next letter.
 */
async function claim(id: string, leaseMs: number): Promise<Newsletter> {
  const readers = await audienceRows();
  return withTx(async (q: Querier) => {
    const rows = await q<Row>(`select ${COLS} from newsletters where id = $1 for update`, [id]);
    if (!rows.length) throw new NewsletterError("not_found");
    const n = mapRow(rows[0]);
    if (n.status === "sent") throw new NewsletterError("already_sent");
    const leaseAt = rows[0].sending_at ? new Date(rows[0].sending_at as string).getTime() : 0;
    if (leaseAt && Date.now() - leaseAt < leaseMs) throw new NewsletterError("busy");

    if (n.status === "draft") {
      const hasBody = NEWS_LANGS.some((L) => bodyHasContent(n.body[L]));
      if (!hasBody) throw new NewsletterError("empty_body");
      if (!n.ready.length) throw new NewsletterError("no_subject");
      const rowsToQueue = readers
        .map((r) => ({ email: r.email, lang: langFor(r.lang, n.ready) }))
        .filter((r): r is { email: string; lang: NewsLang } => !!r.lang);
      if (!rowsToQueue.length) throw new NewsletterError("no_recipients");
      for (let i = 0; i < rowsToQueue.length; i += 200) {
        const chunk = rowsToQueue.slice(i, i + 200);
        const holes = chunk.map((_, j) => `($1, $${j * 2 + 2}, $${j * 2 + 3})`).join(",");
        const params: unknown[] = [id];
        for (const r of chunk) params.push(r.email, r.lang);
        await q(
          `insert into newsletter_sends (newsletter_id, email, lang) values ${holes} on conflict do nothing`,
          params,
        );
      }
      await q(
        `update newsletters set status = 'sending', audience_count = $2, sending_at = now(), updated_at = now() where id = $1`,
        [id, rowsToQueue.length],
      );
      n.status = "sending";
      n.audienceCount = rowsToQueue.length;
    } else {
      await q("update newsletters set sending_at = now() where id = $1", [id]);
    }
    return n;
  });
}

async function counts(id: string): Promise<{ sent: number; failed: number; left: number; total: number }> {
  const rows = await query<{ status: string; n: number | string }>(
    "select status, count(*) as n from newsletter_sends where newsletter_id = $1 group by status",
    [id],
  );
  const by: Record<string, number> = {};
  for (const r of rows) by[r.status] = Number(r.n) || 0;
  const sent = by.sent || 0;
  const failed = by.failed || 0;
  const left = by.queued || 0;
  return { sent, failed, left, total: sent + failed + left };
}

/** «Рассылка «…»: отправлено N, ошибок M» — the journal line, in one place. */
export function newsletterAuditLine(title: string, sent: number, failed: number): string {
  return `Рассылка «${title}»: отправлено ${sent}, ошибок ${failed}`;
}

/**
 * One call's worth of sending — see the module note. Throws NewsletterError
 * for the refusals (the route turns them into 4xx codes); any other error
 * releases the lease and propagates, so the panel offers «Продолжить».
 */
export async function sendNewsletterBatch(
  id: string,
  opts: BatchOptions = {},
): Promise<{ progress: BatchProgress; newsletter: Newsletter }> {
  if (!isNewsletterId(id)) throw new NewsletterError("not_found");
  if (!newsletterMailReady()) throw new NewsletterError("no_api_key");
  const o = { ...DEFAULTS, ...opts };
  const concurrency = Math.min(Math.max(1, Math.round(o.concurrency)), 5);
  const waveMs = Math.ceil((1000 * concurrency) / Math.max(0.1, o.perSecond));
  const started = Date.now();

  const n = await claim(id, o.leaseMs);
  let retryAfterMs: number | undefined;
  try {
    await loadNewsletterBrand();
    const cards = await newsletterCards(n.products);
    // the languages are few and the letters differ only in the footer's
    // link, so the body rows are built once per language and the shell
    // per reader — rendering is string work, not the slow part
    let stop = false;
    while (!stop && Date.now() - started < o.budgetMs) {
      const queued = await query<{ email: string; lang: string }>(
        "select email, lang from newsletter_sends where newsletter_id = $1 and status = 'queued' order by email limit $2",
        [id, o.batchSize],
      );
      if (!queued.length) break;
      for (let i = 0; i < queued.length && !stop; i += concurrency) {
        if (Date.now() - started >= o.budgetMs) {
          stop = true;
          break;
        }
        const wave = queued.slice(i, i + concurrency);
        const waveStart = Date.now();
        const results = await Promise.all(
          wave.map(async (r) => {
            const L = (NEWS_LANGS as readonly string[]).includes(r.lang) ? (r.lang as NewsLang) : "RU";
            const mail = await renderNewsletterFor(n, L, r.email, cards);
            const res = await sendMail({
              to: r.email,
              subject: mail.subject,
              html: mail.html,
              text: mail.text,
              tags: { template: "newsletter", lang: L.toLowerCase(), newsletter: id.slice(0, 8) },
              idempotencyKey: `news:${id}:${r.email}`,
              headers: unsubscribeHeaders(r.email, L, "marketing"),
            });
            return { email: r.email, res };
          }),
        );
        for (const { email, res } of results) {
          if (res.ok) {
            await query(
              "update newsletter_sends set status = 'sent', message_id = $3, error = null, sent_at = now() where newsletter_id = $1 and email = $2",
              [id, email, res.id ?? null],
            );
            continue;
          }
          if (res.skipped && res.error === "no_api_key") {
            if (e2eSinkTransport()) {
              await query(
                "update newsletter_sends set status = 'sent', message_id = 'e2e-sink', error = null, sent_at = now() where newsletter_id = $1 and email = $2",
                [id, email],
              );
              continue;
            }
            // the key went away between the check and the send — nothing is marked, the row waits
            throw new NewsletterError("no_api_key");
          }
          if (res.status === 429) {
            // Resend asks for a pause: the row stays queued, this call ends, the panel waits
            retryAfterMs = 1_500;
            stop = true;
            continue;
          }
          await query(
            "update newsletter_sends set status = 'failed', error = $3, sent_at = now() where newsletter_id = $1 and email = $2",
            [id, email, String(res.error || `http_${res.status ?? 0}`).slice(0, 200)],
          );
        }
        const more = i + concurrency < queued.length;
        if (!stop && more) await sleep(waveMs - (Date.now() - waveStart));
      }
      if (queued.length < o.batchSize && !stop) {
        // the last page: whatever was queued has been answered
        const rest = await query<{ n: number | string }>(
          "select count(*) as n from newsletter_sends where newsletter_id = $1 and status = 'queued'",
          [id],
        );
        if (!(Number(rest[0]?.n) || 0)) break;
      }
    }
  } finally {
    await query("update newsletters set sending_at = null where id = $1", [id]).catch((err) => {
      console.error("[newsletters] lease not released:", err);
    });
  }

  const c = await counts(id);
  const done = c.left === 0;
  if (done) {
    await query(
      `update newsletters set status = 'sent', sent_at = now(), sent_count = $2, failed_count = $3, updated_at = now() where id = $1 and status <> 'sent'`,
      [id, c.sent, c.failed],
    );
    await writeAuditSafe("admin", "newsletter.sent", {
      id,
      title: n.title || n.subject.RU || n.subject.ET || n.subject.EN,
      sent: c.sent,
      failed: c.failed,
      audience: c.total,
      line: newsletterAuditLine(n.title || n.subject.RU || n.subject.ET || n.subject.EN, c.sent, c.failed),
    });
  } else {
    await query("update newsletters set sent_count = $2, failed_count = $3 where id = $1", [id, c.sent, c.failed]);
  }
  const fresh = (await getNewsletter(id)) ?? n;
  const progress: BatchProgress = { done, sent: c.sent, failed: c.failed, left: c.left, total: c.total, status: fresh.status };
  if (retryAfterMs && !done) progress.retryAfterMs = retryAfterMs;
  return { progress, newsletter: fresh };
}

/** Where a letter that is neither draft nor sent stands — what «Продолжить» shows. */
export async function newsletterProgress(id: string): Promise<BatchProgress | null> {
  const n = await getNewsletter(id);
  if (!n) return null;
  const c = await counts(id);
  return { done: n.status === "sent", sent: c.sent, failed: c.failed, left: c.left, total: c.total, status: n.status };
}
