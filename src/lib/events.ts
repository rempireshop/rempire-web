/**
 * First-party product analytics — the write side. db/migrations/080_events.sql
 * has the full shape and the reasoning; this is the one door into the table,
 * used by POST /api/track (the storefront's beacon) and by the paid
 * transition in src/lib/payments/apply.ts (the authoritative purchase row).
 *
 * Nothing here trusts its caller: every field is re-clamped on the way in,
 * because /api/track hands this whatever a browser sent. Bad input is
 * dropped quietly (a bad `value` becomes null, not a thrown error) — a
 * tracking beacon must never be the reason a request fails.
 */
import { query } from "@/lib/db";

export const EVENT_TYPES = ["view", "product", "search", "add_to_cart", "checkout", "purchase", "chat"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** The server-authoritative purchase row uses this in place of a real sid. */
export const SERVER_SID = "server";

export type TrackInput = {
  sid?: unknown;
  type: unknown;
  path?: unknown;
  productId?: unknown;
  value?: unknown;
  lang?: unknown;
  ref?: unknown;
  uaClass?: unknown;
  country?: unknown;
  /** Overrides `at` (default now()) — only the server-side purchase writer uses this. */
  at?: Date | string;
};

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
  return s || null;
}

/** type='search' stores the query text here, lower-cased so «Шампунь» and
 *  «шампунь» roll up into one row of "top search terms". */
function searchTerm(v: unknown): string | null {
  const s = str(v, 200);
  return s ? s.toLowerCase() : null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100_000) return null;
  return Math.round(n * 100) / 100;
}

/** A bare host ("google.com"), never a scheme, path, query or port. */
function hostOnly(v: unknown): string | null {
  const s = str(v, 200);
  if (!s) return null;
  const bare = s.replace(/^https?:\/\//i, "").split(/[/?#]/)[0].split(":")[0].toLowerCase();
  return /^[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i.test(bare) ? bare : null;
}

function uaClassOf(v: unknown): "mobile" | "desktop" | null {
  return v === "mobile" || v === "desktop" ? v : null;
}

/** Simple, deliberately generous UA sniffing — good enough to keep the
 *  dashboard from being dominated by uptime pingers and search crawlers, not
 *  a security boundary. */
const MOBILE_UA_RE = /Mobi|Android|iPhone|iPod|IEMobile|Opera Mini|BlackBerry|Windows Phone/i;
const BOT_UA_RE =
  /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegrambot|discordbot|applebot|pingdom|uptimerobot|headlesschrome|phantomjs|lighthouse|ahrefsbot|semrushbot|mj12bot|dotbot|petalbot|bytespider|feedfetcher|adsbot|google-inspectiontool/i;

export function isBotUA(ua: string | null | undefined): boolean {
  return !ua || BOT_UA_RE.test(ua);
}

export function classifyUA(ua: string | null | undefined): "mobile" | "desktop" {
  return ua && MOBILE_UA_RE.test(ua) ? "mobile" : "desktop";
}

/**
 * Insert one event. Never throws on bad *content* (fields are dropped, not
 * rejected) — it throws only if the database itself is unavailable, which
 * the caller (POST /api/track) turns into a quiet 204.
 */
export async function recordEvent(input: TrackInput): Promise<void> {
  const type = typeof input.type === "string" && (EVENT_TYPES as readonly string[]).includes(input.type)
    ? (input.type as EventType)
    : null;
  if (!type) return; // not a database problem — just nothing to record

  const sid = str(input.sid, 64);
  const path = type === "search" ? searchTerm(input.path) : str(input.path, 300);
  const productId = str(input.productId, 100);
  const value = num(input.value);
  const lang = str(input.lang, 5)?.toUpperCase() ?? null;
  const ref = hostOnly(input.ref);
  const uaClass = uaClassOf(input.uaClass);
  const country = str(input.country, 8)?.toUpperCase() ?? null;

  await query(
    `insert into events (at, sid, type, path, product_id, value, lang, ref, ua_class, country)
     values (coalesce($1, now()), $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [input.at ?? null, sid, type, path, productId, value, lang, ref, uaClass, country],
  );
}

/**
 * The one call src/lib/payments/apply.ts makes on the paid transition.
 * Authoritative revenue: never blocked by an ad blocker, written exactly
 * once per order (the transition itself only runs once — see apply.ts).
 * Swallows its own errors — a tracking row must never be the reason a
 * confirmed payment fails to save.
 */
export async function recordPurchaseEvent(order: { id: string; total?: number | string | null }): Promise<void> {
  try {
    const total = typeof order.total === "number" ? order.total : Number(order.total);
    await recordEvent({
      sid: SERVER_SID,
      type: "purchase",
      productId: order.id, // the order's own id — nothing product-shaped to attach here
      value: Number.isFinite(total) ? total : null,
    });
  } catch (err) {
    console.error("[events] recordPurchaseEvent failed:", err);
  }
}

/** Rows older than `days` are deleted outright — see docs/analytics.md. */
export async function deleteOldEvents(days = 90): Promise<number> {
  const rows = await query<{ id: number }>(
    "delete from events where at < now() - make_interval(days => $1) returning id",
    [Math.max(1, Math.trunc(days) || 90)],
  );
  return rows.length;
}

/**
 * Belt-and-suspenders retention: called from POST /api/track itself with
 * roughly 1-in-2000 odds, so the table ages out even on a host where the
 * /api/cron/events-retention schedule was never wired up. Errors are
 * swallowed — a maintenance sweep must never fail a visitor's beacon.
 */
export async function maybeSweepOldEvents(days = 90, odds = 1 / 2000): Promise<void> {
  if (Math.random() >= odds) return;
  try {
    await deleteOldEvents(days);
  } catch (err) {
    console.error("[events] retention sweep failed:", err);
  }
}
