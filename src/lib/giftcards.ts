import { randomBytes } from "node:crypto";
import { query } from "@/lib/db";

/**
 * Gift cards — issue, check, apply, redeem.
 *
 * Storage: db/migrations/020_gift_cards.sql (gift_cards + gift_card_uses).
 *
 * Who calls what
 *   · issueGiftCards(order)          — from the onOrderPaid hook (mail agent /
 *     backend). Idempotent: called twice for the same order it returns the
 *     cards it already made instead of making more.
 *   · applyGiftCard(code, total)     — from createOrder, by dynamic import.
 *     Read-only: it says what the card WOULD take off this total. It does not
 *     spend anything, so a checkout that then fails costs the customer nothing.
 *   · redeemGiftCard(code, amount, orderId) — spends it, once the order exists.
 *   · checkGiftCard(code)            — behind POST /api/giftcards/check.
 *
 * Money never becomes a float here beyond two decimals: every value that goes
 * to the database is rounded to cents first.
 */

/** The three amounts the shop sells. Anything else is refused. */
export const GIFT_AMOUNTS = [25, 50, 100] as const;
export type GiftAmount = (typeof GIFT_AMOUNTS)[number];

/**
 * Unambiguous alphabet: no O/0, I/1/L, S/5, B/8, Z/2. Codes get read off a
 * phone screen and typed into a form — the pairs people confuse are gone.
 */
const ALPHABET = "ACDEFGHJKMNPQRTUVWXY34679";

export interface GiftCard {
  code: string;
  amount: number;
  balance: number;
  orderId: string | null;
  recipient: GiftRecipient;
  lang: string;
  createdAt: string;
  redeemedAt: string | null;
}

export interface GiftRecipient {
  name?: string;
  email?: string;
  message?: string;
  from?: string;
}

/** Minimal shape of an order — structural, so backend-core's Order fits. */
export interface OrderLike {
  id: string;
  lang?: string | null;
  email?: string | null;
  name?: string | null;
  items?: unknown;
}

interface GiftRow {
  code: string;
  amount: string | number;
  balance: string | number;
  order_id: string | null;
  recipient: GiftRecipient | null;
  lang: string;
  created_at: Date | string;
  redeemed_at: Date | string | null;
}

const cents = (n: number) => Math.round(n * 100) / 100;
const num = (v: string | number) => (typeof v === "number" ? v : parseFloat(v));
const iso = (v: Date | string | null) =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

function toCard(r: GiftRow): GiftCard {
  return {
    code: r.code,
    amount: cents(num(r.amount)),
    balance: cents(num(r.balance)),
    orderId: r.order_id,
    recipient: r.recipient || {},
    lang: r.lang,
    createdAt: iso(r.created_at) as string,
    redeemedAt: iso(r.redeemed_at),
  };
}

/* ---------- codes ---------------------------------------------------- */

/** RMP-XXXX-XXXX from a uniform draw over the unambiguous alphabet. */
export function generateCode(): string {
  const need = 8;
  const out: string[] = [];
  // rejection sampling: a plain byte % 25 would make the first six letters
  // ~4 % more likely than the rest, and a gift-card code is money
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < need) {
    for (const b of randomBytes(need * 2)) {
      if (b >= limit) continue;
      out.push(ALPHABET[b % ALPHABET.length]);
      if (out.length === need) break;
    }
  }
  return "RMP-" + out.slice(0, 4).join("") + "-" + out.slice(4, 8).join("");
}

/**
 * What the customer typed → what the database stores. Spaces, dashes, lower
 * case and a missing "RMP-" prefix are all accepted.
 *
 * Deliberately NOT forgiving about letters: a character outside the alphabet
 * makes the code invalid rather than being "corrected" into a neighbour. The
 * alphabet already has no confusable pairs in it, and silently rewriting a
 * typo could land on somebody else's real card.
 */
export function normaliseCode(raw: string): string {
  let s = String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (s.startsWith("RMP")) s = s.slice(3);
  if (s.length !== 8) return "";
  for (const ch of s) if (ALPHABET.indexOf(ch) < 0) return "";
  return "RMP-" + s.slice(0, 4) + "-" + s.slice(4, 8);
}

export function isGiftAmount(n: unknown): n is GiftAmount {
  return typeof n === "number" && (GIFT_AMOUNTS as readonly number[]).includes(n);
}

/** "gift:50" → 50. Anything else → null. */
export function parseGiftItemId(id: string): GiftAmount | null {
  const m = /^gift:(\d+)$/.exec(String(id || ""));
  if (!m) return null;
  const n = Number(m[1]);
  return isGiftAmount(n) ? n : null;
}

/* ---------- issue ----------------------------------------------------- */

interface CartItemLike {
  id?: unknown;
  qty?: unknown;
  meta?: unknown;
  recipient?: unknown;
}

function recipientOf(item: CartItemLike, order: OrderLike): GiftRecipient {
  const raw = (item.meta ?? item.recipient) as Record<string, unknown> | undefined;
  const pick = (k: string) => {
    const v = raw && typeof raw === "object" ? raw[k] : undefined;
    return typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : undefined;
  };
  return {
    name: pick("name"),
    email: pick("email"),
    message: pick("message"),
    from: pick("from") || order.name || undefined,
  };
}

/**
 * Create one card per gift line (qty copies of it), once the order is paid.
 * Safe to call more than once: cards already attached to this order win.
 */
export async function issueGiftCards(order: OrderLike): Promise<GiftCard[]> {
  if (!order?.id) return [];

  const existing = await query<GiftRow>(
    `select code, amount, balance, order_id, recipient, lang, created_at, redeemed_at
       from gift_cards where order_id = $1 order by created_at`,
    [order.id],
  );
  if (existing.length) return existing.map(toCard);

  const items: CartItemLike[] = Array.isArray(order.items) ? (order.items as CartItemLike[]) : [];
  const made: GiftCard[] = [];

  for (const item of items) {
    const amount = parseGiftItemId(String(item?.id ?? ""));
    if (amount == null) continue;
    const qty = Math.min(20, Math.max(1, Math.floor(Number(item?.qty) || 1)));
    const recipient = recipientOf(item, order);
    for (let i = 0; i < qty; i++) {
      // a collision is astronomically unlikely (25^8 ≈ 1.5·10¹¹), but a
      // primary-key clash would lose a paid card — so retry rather than throw
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateCode();
        const rows = await query<GiftRow>(
          `insert into gift_cards (code, amount, balance, order_id, recipient, lang)
             values ($1, $2, $2, $3, $4::jsonb, $5)
           on conflict (code) do nothing
           returning code, amount, balance, order_id, recipient, lang, created_at, redeemed_at`,
          [code, amount, order.id, JSON.stringify(recipient), order.lang || "RU"],
        );
        if (rows.length) {
          made.push(toCard(rows[0]));
          break;
        }
      }
    }
  }
  return made;
}

/* ---------- check / apply / redeem ------------------------------------ */

export async function getGiftCard(code: string): Promise<GiftCard | null> {
  const norm = normaliseCode(code);
  if (!norm) return null;
  const rows = await query<GiftRow>(
    `select code, amount, balance, order_id, recipient, lang, created_at, redeemed_at
       from gift_cards where code = $1`,
    [norm],
  );
  return rows.length ? toCard(rows[0]) : null;
}

export interface GiftCheck {
  ok: boolean;
  /** "not_found" | "empty" | "bad_code" */
  error?: string;
  code?: string;
  balance?: number;
  amount?: number;
}

/** Public lookup: says whether the code is real and what is left on it. */
export async function checkGiftCard(code: string): Promise<GiftCheck> {
  const norm = normaliseCode(code);
  if (!norm) return { ok: false, error: "bad_code" };
  const card = await getGiftCard(norm);
  if (!card) return { ok: false, error: "not_found" };
  if (card.balance <= 0) return { ok: false, error: "empty", code: card.code, balance: 0, amount: card.amount };
  return { ok: true, code: card.code, balance: card.balance, amount: card.amount };
}

export interface GiftApply {
  ok: boolean;
  error?: string;
  code?: string;
  /** how much this card takes off the given total */
  discount: number;
  /** what would be left on the card afterwards */
  remaining: number;
}

/**
 * What this card would take off `total`. Read-only — call redeemGiftCard once
 * the order actually exists. A card never pays more than the order costs, and
 * never pays more than it holds.
 */
export async function applyGiftCard(code: string, total: number): Promise<GiftApply> {
  const norm = normaliseCode(code);
  if (!norm) return { ok: false, error: "bad_code", discount: 0, remaining: 0 };
  const card = await getGiftCard(norm);
  if (!card) return { ok: false, error: "not_found", discount: 0, remaining: 0 };
  if (card.balance <= 0) return { ok: false, error: "empty", code: card.code, discount: 0, remaining: 0 };

  const want = Math.max(0, cents(Number(total) || 0));
  const discount = cents(Math.min(card.balance, want));
  return { ok: true, code: card.code, discount, remaining: cents(card.balance - discount) };
}

export interface GiftRedeem {
  ok: boolean;
  error?: string;
  code?: string;
  /** how much was actually taken */
  taken: number;
  remaining: number;
}

/**
 * Spend `amount` off the card, for `orderId`. One conditional UPDATE does the
 * whole thing, so two orders redeeming the same card at the same moment cannot
 * both succeed on the same money.
 */
export async function redeemGiftCard(
  code: string,
  amount: number,
  orderId?: string | null,
): Promise<GiftRedeem> {
  const norm = normaliseCode(code);
  if (!norm) return { ok: false, error: "bad_code", taken: 0, remaining: 0 };
  const want = cents(Number(amount) || 0);
  if (!(want > 0)) return { ok: false, error: "bad_amount", taken: 0, remaining: 0 };

  const rows = await query<GiftRow>(
    `update gift_cards
        set balance = balance - $2,
            redeemed_at = case when balance - $2 <= 0 then now() else redeemed_at end
      where code = $1 and balance >= $2
      returning code, amount, balance, order_id, recipient, lang, created_at, redeemed_at`,
    [norm, want],
  );
  if (!rows.length) {
    const card = await getGiftCard(norm);
    if (!card) return { ok: false, error: "not_found", taken: 0, remaining: 0 };
    return { ok: false, error: "insufficient", code: card.code, taken: 0, remaining: card.balance };
  }

  const card = toCard(rows[0]);
  // audit only — the balance above is already correct if this insert fails
  try {
    await query(
      `insert into gift_card_uses (code, order_id, amount) values ($1, $2, $3)`,
      [card.code, orderId ?? null, want],
    );
  } catch (err) {
    console.error("gift_card_uses insert failed", err);
  }
  return { ok: true, code: card.code, taken: want, remaining: card.balance };
}
