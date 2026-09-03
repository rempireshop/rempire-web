import { query, withTx } from "@/lib/db";

/**
 * Promo codes — quote, consume, and the admin's CRUD.
 *
 * Storage: db/migrations/060_promo_codes.sql (promo_codes + promo_code_uses).
 *
 * Who calls what
 *   · quotePromo(code, subtotal, shipping) — from createOrder and from the
 *     public POST /api/promos/check. Read-only: it says what the code WOULD
 *     take off this basket. Nothing is spent, so a checkout that is abandoned
 *     on the bank's page costs the shop no usage.
 *   · consumePromo(code, orderId)          — from src/lib/payments/apply.ts on
 *     the single transition into `paid`, next to the gift-card redeem. One
 *     conditional UPDATE plus a unique (code, order_id) row, so a webhook
 *     retry cannot count the same order twice.
 *   · listPromos / upsertPromo / setPromoActive — the admin panel and the
 *     assistant's create_promo / toggle_promo actions.
 *
 * A code and a gift card share one input box in the checkout. They are told
 * apart by shape (RMP-XXXX-XXXX is a card, see src/lib/giftcards.ts); this
 * module never sees a card.
 */

export type PromoKind = "percent" | "fixed" | "free_shipping";

export const PROMO_KINDS: readonly PromoKind[] = ["percent", "fixed", "free_shipping"];

/** Ceilings the admin and the assistant are both held to. */
export const PROMO_MAX_CODE = 24;
export const PROMO_MAX_PERCENT = 90;
export const PROMO_MIN_PERCENT = 1;
export const PROMO_MAX_FIXED = 200;

export interface Promo {
  code: string;
  kind: PromoKind;
  value: number;
  minSubtotal: number;
  startsAt: string | null;
  endsAt: string | null;
  maxUses: number | null;
  used: number;
  active: boolean;
  note: string | null;
  createdAt: string;
}

interface PromoRow {
  code: string;
  kind: PromoKind;
  value: string | number;
  min_subtotal: string | number;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
  max_uses: number | string | null;
  used: number | string;
  active: boolean;
  note: string | null;
  created_at: Date | string;
}

const cents = (n: number) => Math.round(n * 100) / 100;
const num = (v: string | number) => (typeof v === "number" ? v : parseFloat(v));
const iso = (v: Date | string | null) =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

function toPromo(r: PromoRow): Promo {
  return {
    code: r.code,
    kind: r.kind,
    value: cents(num(r.value)),
    minSubtotal: cents(num(r.min_subtotal)),
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    maxUses: r.max_uses == null ? null : Math.trunc(num(r.max_uses)),
    used: Math.trunc(num(r.used)),
    active: r.active !== false,
    note: r.note ?? null,
    createdAt: iso(r.created_at) as string,
  };
}

const COLS = `code, kind, value, min_subtotal, starts_at, ends_at, max_uses, used, active, note, created_at`;

/* ---------- codes ------------------------------------------------------- */

/**
 * What the customer typed → what the database stores: upper case, and only
 * A–Z, 0–9 and «-». Spaces are dropped (people type «SUVI 10»); anything else
 * makes the code invalid rather than being silently rewritten into a different
 * one that might exist.
 */
export function normalisePromoCode(raw: unknown): string {
  const s = String(raw ?? "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .trim();
  if (!s || s.length > PROMO_MAX_CODE) return "";
  if (!/^[A-Z0-9-]+$/.test(s)) return "";
  if (!/[A-Z0-9]/.test(s)) return "";
  return s;
}

/** A gift card, not a promo — the checkout box takes both. */
export function looksLikeGiftCode(raw: unknown): boolean {
  const s = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.startsWith("RMP") && s.length === 11;
}

/* ---------- quote ------------------------------------------------------- */

export type PromoError =
  | "bad_code"
  | "not_found"
  | "inactive"
  | "not_started"
  | "expired"
  | "used_up"
  | "min_subtotal";

export interface PromoQuote {
  ok: boolean;
  error?: PromoError;
  code?: string;
  kind?: PromoKind;
  /** Euro off the order (goods for percent/fixed, the delivery for free_shipping). */
  discount: number;
  /** True when the code pays for delivery rather than for goods. */
  freeShipping: boolean;
  /** What the basket has to reach — surfaced so the shop can say «ещё 12 €». */
  minSubtotal?: number;
  value?: number;
}

const NO: (e: PromoError, extra?: Partial<PromoQuote>) => PromoQuote = (e, extra) => ({
  ok: false,
  error: e,
  discount: 0,
  freeShipping: false,
  ...extra,
});

/** The pure half: a row plus a basket in, a discount out. No I/O. */
export function quoteFromPromo(
  promo: Promo,
  subtotal: number,
  shipping: number,
  now: Date = new Date(),
): PromoQuote {
  if (!promo.active) return NO("inactive", { code: promo.code });
  if (promo.startsAt && new Date(promo.startsAt).getTime() > now.getTime()) {
    return NO("not_started", { code: promo.code });
  }
  if (promo.endsAt && new Date(promo.endsAt).getTime() <= now.getTime()) {
    return NO("expired", { code: promo.code });
  }
  if (promo.maxUses != null && promo.used >= promo.maxUses) {
    return NO("used_up", { code: promo.code });
  }

  const goods = Math.max(0, cents(Number(subtotal) || 0));
  const ship = Math.max(0, cents(Number(shipping) || 0));
  if (promo.minSubtotal > 0 && goods < promo.minSubtotal) {
    return NO("min_subtotal", { code: promo.code, minSubtotal: promo.minSubtotal });
  }

  if (promo.kind === "free_shipping") {
    return {
      ok: true,
      code: promo.code,
      kind: promo.kind,
      discount: ship,
      freeShipping: true,
      minSubtotal: promo.minSubtotal,
      value: promo.value,
    };
  }

  const raw =
    promo.kind === "percent" ? (goods * promo.value) / 100 : Math.min(promo.value, goods);
  const discount = cents(Math.max(0, Math.min(goods, raw)));
  return {
    ok: true,
    code: promo.code,
    kind: promo.kind,
    discount,
    freeShipping: false,
    minSubtotal: promo.minSubtotal,
    value: promo.value,
  };
}

/** Look one code up. Returns null for a code that is not in the table. */
export async function getPromo(code: unknown): Promise<Promo | null> {
  const norm = normalisePromoCode(code);
  if (!norm) return null;
  const rows = await query<PromoRow>(`select ${COLS} from promo_codes where code = $1`, [norm]);
  return rows.length ? toPromo(rows[0]) : null;
}

/**
 * What this code takes off a basket of `subtotal` goods and `shipping`
 * delivery. Read-only — call consumePromo once the payment is confirmed.
 */
export async function quotePromo(
  code: unknown,
  subtotal: number,
  shipping = 0,
): Promise<PromoQuote> {
  const norm = normalisePromoCode(code);
  if (!norm) return NO("bad_code");
  const promo = await getPromo(norm);
  if (!promo) return NO("not_found");
  return quoteFromPromo(promo, subtotal, shipping);
}

/* ---------- consume ----------------------------------------------------- */

export interface PromoConsume {
  ok: boolean;
  error?: "bad_code" | "not_found" | "used_up";
  code?: string;
  /** True when this order had already been counted — a webhook retry. */
  already?: boolean;
  used?: number;
}

/**
 * Count one use, for `orderId`. Atomic, like the gift-card redeem:
 *
 *   · the (code, order_id) unique index makes a second call for the same order
 *     a no-op rather than a second use;
 *   · the conditional UPDATE means two orders racing the last use of a
 *     limited code cannot both win.
 *
 * The time window is deliberately NOT re-checked here. The customer was
 * quoted this discount while the code was live and has now paid; expiring the
 * code between the bank and the webhook must not turn a paid order into a
 * mispriced one. `active` is not re-checked for the same reason.
 */
export async function consumePromo(code: unknown, orderId?: string | null, amount = 0): Promise<PromoConsume> {
  const norm = normalisePromoCode(code);
  if (!norm) return { ok: false, error: "bad_code" };

  return withTx(async (q) => {
    const exists = await q<{ code: string }>("select code from promo_codes where code = $1", [norm]);
    if (!exists.length) return { ok: false, error: "not_found" as const };

    if (orderId) {
      const seen = await q<{ id: string }>(
        "select id from promo_code_uses where code = $1 and order_id = $2",
        [norm, orderId],
      );
      if (seen.length) return { ok: true, code: norm, already: true };
    }

    const bumped = await q<{ used: number | string }>(
      `update promo_codes
          set used = used + 1
        where code = $1 and (max_uses is null or used < max_uses)
        returning used`,
      [norm],
    );
    if (!bumped.length) return { ok: false, error: "used_up" as const, code: norm };

    await q(
      "insert into promo_code_uses (code, order_id, amount) values ($1, $2, $3)",
      [norm, orderId ?? null, cents(Math.max(0, Number(amount) || 0))],
    );
    return { ok: true, code: norm, used: Math.trunc(num(bumped[0].used)) };
  });
}

/* ---------- admin ------------------------------------------------------- */

export interface PromoInput {
  code: string;
  kind: PromoKind;
  value: number;
  minSubtotal: number;
  startsAt: string | null;
  endsAt: string | null;
  maxUses: number | null;
  active: boolean;
  note: string | null;
}

export type PromoValidation =
  | { ok: true; value: PromoInput }
  | { ok: false; error: string };

function optionalDate(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v == null || v === "") return { ok: true, value: null };
  if (typeof v !== "string" && typeof v !== "number") return { ok: false };
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return { ok: false };
  return { ok: true, value: d.toISOString() };
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Everything a code can be, checked once. Both the admin route and the
 * assistant action go through here, so a model-proposed code is held to the
 * same bounds as a hand-typed one: 90 % is the most anything can take off,
 * 200 € the most a fixed code can, and a date that does not parse is refused
 * rather than stored as «now».
 */
export function validatePromo(raw: unknown): PromoValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "bad_body" };
  const x = raw as Record<string, unknown>;

  const code = normalisePromoCode(x.code);
  if (!code) return { ok: false, error: "bad_code" };

  const kind = PROMO_KINDS.includes(x.kind as PromoKind) ? (x.kind as PromoKind) : "percent";

  let value = toNum(x.value) ?? 0;
  if (kind === "percent") {
    value = Math.round(value);
    if (value < PROMO_MIN_PERCENT || value > PROMO_MAX_PERCENT) return { ok: false, error: "bad_value" };
  } else if (kind === "fixed") {
    value = cents(value);
    if (!(value > 0) || value > PROMO_MAX_FIXED) return { ok: false, error: "bad_value" };
  } else {
    value = 0;
  }

  const minRaw = toNum(x.minSubtotal ?? x.min_subtotal) ?? 0;
  if (minRaw < 0 || minRaw > 10_000) return { ok: false, error: "bad_min" };
  const minSubtotal = cents(minRaw);

  const starts = optionalDate(x.startsAt ?? x.starts_at);
  if (!starts.ok) return { ok: false, error: "bad_date" };
  const ends = optionalDate(x.endsAt ?? x.ends_at);
  if (!ends.ok) return { ok: false, error: "bad_date" };
  if (starts.value && ends.value && new Date(ends.value) <= new Date(starts.value)) {
    return { ok: false, error: "bad_date" };
  }

  const rawUses = x.maxUses ?? x.max_uses;
  let maxUses: number | null = null;
  if (rawUses != null && rawUses !== "") {
    const n = toNum(rawUses);
    if (n === null || !Number.isFinite(n)) return { ok: false, error: "bad_uses" };
    maxUses = Math.trunc(n);
    if (maxUses < 1 || maxUses > 1_000_000) return { ok: false, error: "bad_uses" };
  }

  const note = typeof x.note === "string" ? x.note.replace(/\s+/g, " ").trim().slice(0, 200) || null : null;

  return {
    ok: true,
    value: {
      code,
      kind,
      value,
      minSubtotal,
      startsAt: starts.value,
      endsAt: ends.value,
      maxUses,
      active: x.active === undefined ? true : x.active !== false,
      note,
    },
  };
}

/** Newest first. The admin lists everything, live and expired alike. */
export async function listPromos(limit = 200): Promise<Promo[]> {
  const n = Math.min(500, Math.max(1, Math.trunc(limit) || 200));
  const rows = await query<PromoRow>(
    `select ${COLS} from promo_codes order by created_at desc limit ${n}`,
  );
  return rows.map(toPromo);
}

/**
 * Create or edit one code. `used` is never touched here — editing a code must
 * not hand back the uses it has already spent.
 */
export async function upsertPromo(input: PromoInput): Promise<Promo> {
  const rows = await query<PromoRow>(
    `insert into promo_codes (code, kind, value, min_subtotal, starts_at, ends_at, max_uses, active, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (code) do update set
       kind = excluded.kind,
       value = excluded.value,
       min_subtotal = excluded.min_subtotal,
       starts_at = excluded.starts_at,
       ends_at = excluded.ends_at,
       max_uses = excluded.max_uses,
       active = excluded.active,
       note = excluded.note
     returning ${COLS}`,
    [
      input.code,
      input.kind,
      input.value,
      input.minSubtotal,
      input.startsAt,
      input.endsAt,
      input.maxUses,
      input.active,
      input.note,
    ],
  );
  return toPromo(rows[0]);
}

/** Switch one code on or off. Returns null when there is no such code. */
export async function setPromoActive(code: unknown, active: boolean): Promise<Promo | null> {
  const norm = normalisePromoCode(code);
  if (!norm) return null;
  const rows = await query<PromoRow>(
    `update promo_codes set active = $2 where code = $1 returning ${COLS}`,
    [norm, !!active],
  );
  return rows.length ? toPromo(rows[0]) : null;
}
