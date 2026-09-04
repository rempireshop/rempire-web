import { query } from "@/lib/db";

/**
 * Product reviews — validation, storage, moderation.
 *
 * Storage: db/migrations/021_reviews.sql.
 *
 * Nothing a stranger types is ever shown by itself: every row lands as
 * 'pending' and only the owner's «Отзывы» tab moves it to 'approved'. The
 * checks below are therefore not a security boundary — they are there so the
 * moderation queue stays readable and the obvious spam never reaches it.
 */

export const MIN_TEXT = 20;
export const MAX_TEXT = 1500;
export const MAX_NAME = 60;

export type ReviewStatus = "pending" | "approved" | "rejected";

export interface Review {
  id: string;
  productId: string;
  name: string;
  rating: number;
  text: string;
  lang: string;
  status: ReviewStatus;
  createdAt: string;
}

interface ReviewRow {
  id: string;
  product_id: string;
  name: string;
  rating: number | string;
  text: string;
  lang: string;
  status: ReviewStatus;
  created_at: Date | string;
}

function toReview(r: ReviewRow): Review {
  return {
    id: r.id,
    productId: r.product_id,
    name: r.name,
    rating: Number(r.rating),
    text: r.text,
    lang: r.lang,
    status: r.status,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

/* ---------- validation ------------------------------------------------ */

export interface ReviewInput {
  product?: unknown;
  name?: unknown;
  rating?: unknown;
  text?: unknown;
  lang?: unknown;
  /** honeypot: a field no human sees, so anything in it is a bot */
  website?: unknown;
  consent?: unknown;
}

export interface ReviewValid {
  ok: true;
  value: { productId: string; name: string; rating: number; text: string; lang: string };
}

export type ReviewError =
  | "bot"
  | "no_product"
  | "no_name"
  | "bad_rating"
  | "short_text"
  | "long_text"
  | "links"
  | "profanity"
  | "no_consent";

export interface ReviewInvalid {
  ok: false;
  /** machine-readable; the storefront maps it to a sentence in its language */
  error: ReviewError;
}

export type ReviewCheck = ReviewValid | ReviewInvalid;

/** Anything that looks like an address a spammer wants clicked. */
const LINK_RX =
  /(https?:\/\/|www\.|\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b|\b[a-z0-9-]+\.(?:com|ru|net|org|shop|site|online|xyz|top|info|biz|ee)\b|t\.me\/|@[a-z0-9_]{4,})/i;

/*
 * A short, deliberately blunt list — three languages, stems only, matched at a
 * word start so «скипидар» is not caught by a substring. It is a first pass in
 * front of a human, not a censor: what it misses simply waits for approval.
 */
const PROFANITY = [
  "хуй", "хуе", "хуё", "пизд", "ебан", "ебат", "ебал", "ёбан", "бляд", "блять",
  "муда", "залуп", "гандон", "пидор", "пидар", "сука",
  "fuck", "shit", "cunt", "bitch", "asshole", "bastard",
  "perse", "vittu", "munn", "türa",
];

function hasProfanity(s: string): boolean {
  const low = s.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ");
  return PROFANITY.some((w) => new RegExp("(^|\\s)" + w, "u").test(low));
}

const LANGS = ["RU", "ET", "EN"];

/** Collapse runs of whitespace; drop control and formatting characters. */
function clean(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function validateReview(input: ReviewInput): ReviewCheck {
  // the honeypot is checked first: a bot that filled it gets no other clue
  if (clean(input.website, 100)) return { ok: false, error: "bot" };

  const productId = clean(input.product, 120);
  if (!productId || !/^[a-z0-9][a-z0-9._-]*$/i.test(productId)) return { ok: false, error: "no_product" };

  const name = clean(input.name, MAX_NAME);
  if (name.length < 2) return { ok: false, error: "no_name" };

  const rating = Math.round(Number(input.rating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return { ok: false, error: "bad_rating" };

  const text = clean(input.text, MAX_TEXT + 1);
  if (text.length < MIN_TEXT) return { ok: false, error: "short_text" };
  if (text.length > MAX_TEXT) return { ok: false, error: "long_text" };

  if (input.consent !== true && input.consent !== "true" && input.consent !== 1) {
    return { ok: false, error: "no_consent" };
  }
  if (LINK_RX.test(text) || LINK_RX.test(name)) return { ok: false, error: "links" };
  if (hasProfanity(text) || hasProfanity(name)) return { ok: false, error: "profanity" };

  const rawLang = String(input.lang ?? "RU").toUpperCase();
  const lang = LANGS.includes(rawLang) ? rawLang : "RU";

  return { ok: true, value: { productId, name, rating, text, lang } };
}

/* ---------- storage ---------------------------------------------------- */

export async function addReview(v: ReviewValid["value"], ipHash?: string | null): Promise<Review> {
  const rows = await query<ReviewRow>(
    `insert into reviews (product_id, name, rating, text, lang, ip_hash)
       values ($1, $2, $3, $4, $5, $6)
     returning id, product_id, name, rating, text, lang, status, created_at`,
    [v.productId, v.name, v.rating, v.text, v.lang, ipHash ?? null],
  );
  return toReview(rows[0]);
}

/** What the product page shows: approved only, newest first. */
export async function approvedReviews(productId: string, limit = 30): Promise<Review[]> {
  const rows = await query<ReviewRow>(
    `select id, product_id, name, rating, text, lang, status, created_at
       from reviews
      where product_id = $1 and status = 'approved'
      order by created_at desc
      limit $2`,
    [productId, Math.min(100, Math.max(1, limit))],
  );
  return rows.map(toReview);
}

/** The admin queue. `status` omitted = everything, newest first. */
export async function listReviews(status?: ReviewStatus, limit = 100): Promise<Review[]> {
  const capped = Math.min(200, Math.max(1, limit));
  const rows = status
    ? await query<ReviewRow>(
        `select id, product_id, name, rating, text, lang, status, created_at
           from reviews where status = $1 order by created_at desc limit $2`,
        [status, capped],
      )
    : await query<ReviewRow>(
        `select id, product_id, name, rating, text, lang, status, created_at
           from reviews order by created_at desc limit $1`,
        [capped],
      );
  return rows.map(toReview);
}

export async function reviewCounts(): Promise<Record<ReviewStatus, number>> {
  const rows = await query<{ status: ReviewStatus; n: string | number }>(
    "select status, count(*) as n from reviews group by status",
  );
  const out: Record<ReviewStatus, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}

/* reviews.id is a uuid column — an id that is not uuid-shaped is 22P02 from
   Postgres, which the admin route reports as a 503 rather than "no such
   review". Same guard as src/lib/orders.ts getOrder(). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setReviewStatus(
  id: string,
  status: ReviewStatus,
  actor = "admin",
): Promise<Review | null> {
  if (!UUID_RE.test(String(id ?? ""))) return null;
  const rows = await query<ReviewRow>(
    `update reviews
        set status = $2, reviewed_at = now(), reviewed_by = $3
      where id = $1
      returning id, product_id, name, rating, text, lang, status, created_at`,
    [id, status, actor],
  );
  return rows.length ? toReview(rows[0]) : null;
}

/** Average + count per product, for the rating line above the reviews. */
export async function ratingFor(productId: string): Promise<{ avg: number; n: number }> {
  const rows = await query<{ avg: string | null; n: string | number }>(
    `select avg(rating)::numeric(3,2) as avg, count(*) as n
       from reviews where product_id = $1 and status = 'approved'`,
    [productId],
  );
  const r = rows[0];
  return { avg: r?.avg ? Number(r.avg) : 0, n: Number(r?.n || 0) };
}
