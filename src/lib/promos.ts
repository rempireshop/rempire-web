import { query, withTx } from "@/lib/db";

/**
 * Promo codes — quote, consume, and the admin's CRUD.
 *
 * Storage: db/migrations/060_promo_codes.sql (promo_codes + promo_code_uses),
 * db/migrations/170_promo_scope.sql (scope + scope_value — a code that
 * applies to one brand or one product rather than to the whole basket) and
 * db/migrations/197_abandoned_cart_discount.sql (scope 'cart' + scope_lines —
 * a code that applies to the lines ONE abandoned basket held).
 *
 * Who calls what
 *   · quotePromo(code, subtotal, shipping, lines) — from createOrder and from
 *     the public POST /api/promos/check. Read-only: it says what the code
 *     WOULD take off this basket. Nothing is spent, so a checkout that is
 *     abandoned on the bank's page costs the shop no usage. `lines` is the
 *     basket line by line; a brand/product code is priced on the matching
 *     lines ONLY and cannot be priced without them.
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

/**
 * What a code is allowed to touch — db/migrations/170_promo_scope.sql, and
 * 197_abandoned_cart_discount.sql for the fourth.
 *
 *   order    the whole basket, which is every code that existed before 170
 *   brand    only the lines of one brand, as the catalogue spells it
 *   product  only the lines of one product id
 *   cart     only the lines ONE abandoned basket held — `scopeLines`
 *
 * A scoped code discounts the MATCHING LINES ONLY. Renat chose that over the
 * whole-basket readings himself: ten per cent off a 200 € order for adding one
 * 9 € bottle is not a promotion, it is a hole.
 *
 * 'cart' is the same rule applied to the second abandoned-cart letter (Renat,
 * 20.09.2026: «the discount … preferably ONLY for the cart»). It is the one
 * scope nobody types: the letter mints it per basket, single-use, and nothing
 * in the panel can invent one — see validatePromo, which needs the id list
 * before it will accept the word.
 */
export type PromoScope = "order" | "brand" | "product" | "cart";

export const PROMO_SCOPES: readonly PromoScope[] = ["order", "brand", "product", "cart"];

/** Ceilings the admin and the assistant are both held to. */
export const PROMO_MAX_CODE = 24;
export const PROMO_MAX_PERCENT = 90;
export const PROMO_MIN_PERCENT = 1;
export const PROMO_MAX_FIXED = 200;
/** A brand name, a product id or a cart id — all comfortably shorter than this. */
export const PROMO_MAX_SCOPE_VALUE = 80;
/** The most lines a 'cart' code carries — the cap the resume link already has. */
export const PROMO_MAX_CART_LINES = 50;

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
  /**
   * 'order' unless the owner narrowed the code — see PromoScope. Optional in
   * the type, and absent means 'order': every code written before migration
   * 170, in the database or in a literal, is a whole-basket code, and reading
   * a missing value as anything narrower would silently stop one working.
   */
  scope?: PromoScope;
  /** The brand name, the product id or the cart id; null for a whole-basket code. */
  scopeValue?: string | null;
  /**
   * The product ids a 'cart' code may touch, and nothing else's business:
   * a brand and a product code each name ONE thing in `scopeValue`, while a
   * basket is a set (db/migrations/197_abandoned_cart_discount.sql). Null for
   * every other scope and for every code written before 197.
   */
  scopeLines?: string[] | null;
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
  scope?: string | null;
  scope_value?: string | null;
  scope_lines?: unknown;
}

const cents = (n: number) => Math.round(n * 100) / 100;
const num = (v: string | number) => (typeof v === "number" ? v : parseFloat(v));
const iso = (v: Date | string | null) =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

/**
 * `promo_codes.scope_lines` → the ids a 'cart' code may touch.
 *
 * Null means «this row carries no list», which for a cart code is a row
 * somebody edited by hand: it is answered with no_match, never with the whole
 * basket. jsonb comes back parsed, but a row written by an older driver can
 * be the JSON string — the same defensiveness getFlows() has.
 */
function cartLines(raw: unknown): string[] | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    const id = typeof x === "string" ? x.trim() : "";
    if (id && out.indexOf(id) < 0) out.push(id);
    if (out.length >= PROMO_MAX_CART_LINES) break;
  }
  return out;
}

function toPromo(r: PromoRow): Promo {
  /* A row read back from a database that has not run migration 170 yet (or a
     literal written in a test before this existed) has no scope at all; that
     reads as the old meaning, «весь заказ», never as a narrower code nobody
     asked for. */
  const scope = PROMO_SCOPES.includes(r.scope as PromoScope) ? (r.scope as PromoScope) : "order";
  const scopeValue = scope === "order" ? null : (r.scope_value ?? null) || null;
  const scopeLines = scope === "cart" ? cartLines(r.scope_lines) : null;
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
    /* …and a scope that lost its value is not a code that discounts nothing,
       it is a whole-basket code — the constraint in 170 makes the pair
       impossible, so this only ever fires for a hand-edited row.
       'cart' is the other way round on purpose: it keeps its scope and loses
       its arithmetic, so a row somebody emptied by hand discounts NOTHING
       rather than everything. A code minted for one basket must never be able
       to widen into a code for the shop. */
    scope: scope === "cart" || scopeValue ? scope : "order",
    scopeValue,
    scopeLines,
  };
}

const COLS = `code, kind, value, min_subtotal, starts_at, ends_at, max_uses, used, active, note, created_at, scope, scope_value, scope_lines`;

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
  | "min_subtotal"
  /** A brand/product code and a basket with none of it in — see promoBaseFor(). */
  | "no_match";

/**
 * One basket line as the promo rules see it. Deliberately loose: the order's
 * own OrderItem satisfies it (src/lib/orders.ts), and so does the much smaller
 * shape the checkout's preview endpoint builds out of the cart.
 */
export interface PromoBasketLine {
  id?: string | null;
  /** "product" | "bundle" | "gift" — a gift card never matches anything. */
  kind?: string | null;
  brand?: string | null;
  sum?: number | string | null;
}

/** What a scoped code actually found in this basket. */
export interface PromoMatch {
  /** Euro of matching goods — the base a percent is taken on, and a fixed code's ceiling. */
  base: number;
  /** The product ids it matched, for the record kept on the order. */
  lines: string[];
}

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
  /** 'order' | 'brand' | 'product' | 'cart' — what the code is allowed to touch. */
  scope?: PromoScope;
  /** The brand name, product id or cart id behind a narrowed code, null otherwise. */
  scopeValue?: string | null;
  /** What the discount was computed on — the whole goods for 'order', the matching lines otherwise. */
  base?: number;
  /** The matching product ids, so the order can record what it discounted. */
  lines?: string[];
}

const NO: (e: PromoError, extra?: Partial<PromoQuote>) => PromoQuote = (e, extra) => ({
  ok: false,
  error: e,
  discount: 0,
  freeShipping: false,
  ...extra,
});

/** «Kevin.Murphy» and «kevin.murphy  » are the same brand; nothing else folds. */
function brandKey(v: unknown): string {
  return String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Does this line fall inside the code's scope?
 *
 * A GIFT-CARD line never does — not for a brand code, not for a product code,
 * not even for a whole-basket one. Its face value is money the shop will owe
 * back in full when the card is spent, so a percent off it is a straight cash
 * loss the promo repeats for as long as it lives (audit 14.09.2026). The
 * whole-basket path already gets this right one level up, because createOrder
 * hands quotePromo a gift-free subtotal; saying it again here is what keeps a
 * SCOPED code from being the way back in — a product code whose scope_value is
 * a «gift:100» line would otherwise match it exactly.
 *
 * A SET («bundle:…») never matches a brand either: it carries no brand of its
 * own, it is sold at one price the owner typed for the set as a whole, and
 * «−10 % на Davines» off a set that happens to contain one Davines bottle is
 * arithmetic neither the shopper nor the owner could check. It matches a
 * product code only if the code names the set itself — and a CART code if the
 * basket that earned the code held it, which is the same statement about ids.
 *
 * `scopeLines` is read only by scope 'cart', and a cart code without one
 * matches nothing at all: the list IS the offer the letter made, and a
 * missing list is a code that has lost it, never one that covers the shop.
 */
export function promoLineMatches(
  scope: PromoScope,
  scopeValue: string | null | undefined,
  line: PromoBasketLine | null | undefined,
  scopeLines: readonly string[] | null | undefined = null,
): boolean {
  if (!line) return false;
  if (line.kind === "gift") return false;
  if (scope === "order") return true;
  if (scope === "cart") {
    const id = String(line.id ?? "");
    return !!id && !!scopeLines && scopeLines.indexOf(id) >= 0;
  }
  const want = String(scopeValue ?? "").trim();
  if (!want) return false;
  if (scope === "brand") return !!line.brand && brandKey(line.brand) === brandKey(want);
  return String(line.id ?? "") === want;
}

/** The matching lines' total, and which they were. Pure; no I/O. */
export function promoBaseFor(
  promo: Pick<Promo, "scope" | "scopeValue" | "scopeLines">,
  lines: readonly PromoBasketLine[],
): PromoMatch {
  let base = 0;
  const ids: string[] = [];
  const scope = promo.scope ?? "order";
  for (const line of lines) {
    if (!promoLineMatches(scope, promo.scopeValue, line, promo.scopeLines)) continue;
    const sum = typeof line.sum === "number" ? line.sum : parseFloat(String(line.sum ?? ""));
    if (Number.isFinite(sum) && sum > 0) base += sum;
    const id = String(line.id ?? "");
    if (id && ids.indexOf(id) < 0) ids.push(id);
  }
  return { base: Math.max(0, cents(base)), lines: ids };
}

/**
 * The pure half: a row plus a basket in, a discount out. No I/O.
 *
 * `subtotal` is the goods the code may see — everything except the gift cards,
 * which the caller has already taken out. `lines` is that same basket, line by
 * line, and it is what a BRAND or PRODUCT code is priced on: without it such a
 * code cannot be priced at all and comes back `no_match` rather than falling
 * back to the whole basket. That direction is deliberate. Pricing a Davines
 * code against the whole basket because the lines happened to be missing is
 * exactly the hole the scope was invented to close, and it would open silently.
 */
export function quoteFromPromo(
  promo: Promo,
  subtotal: number,
  shipping: number,
  now: Date = new Date(),
  lines: readonly PromoBasketLine[] | null = null,
): PromoQuote {
  const scope = promo.scope ?? "order";
  const scopeValue = scope === "order" ? null : (promo.scopeValue ?? null);
  const where = { scope, scopeValue };
  const scopeLines = scope === "cart" ? (promo.scopeLines ?? null) : null;
  if (!promo.active) return NO("inactive", { code: promo.code, ...where });
  if (promo.startsAt && new Date(promo.startsAt).getTime() > now.getTime()) {
    return NO("not_started", { code: promo.code, ...where });
  }
  if (promo.endsAt && new Date(promo.endsAt).getTime() <= now.getTime()) {
    return NO("expired", { code: promo.code, ...where });
  }
  if (promo.maxUses != null && promo.used >= promo.maxUses) {
    return NO("used_up", { code: promo.code, ...where });
  }

  const goods = Math.max(0, cents(Number(subtotal) || 0));
  const ship = Math.max(0, cents(Number(shipping) || 0));

  /* A free-delivery code is never scoped (db/migrations/170_promo_scope.sql
     refuses the row, validatePromo refuses the body) — there is no matching
     line to find, because the parcel is one line for the whole basket. Its
     floor is therefore the whole goods subtotal, exactly as it always was. */
  if (promo.kind === "free_shipping") {
    if (promo.minSubtotal > 0 && goods < promo.minSubtotal) {
      return NO("min_subtotal", { code: promo.code, minSubtotal: promo.minSubtotal, ...where });
    }
    return {
      ok: true,
      code: promo.code,
      kind: promo.kind,
      discount: ship,
      freeShipping: true,
      minSubtotal: promo.minSubtotal,
      value: promo.value,
      scope: "order",
      scopeValue: null,
      base: goods,
      lines: [],
    };
  }

  /* What the discount is computed on. For a whole-basket code that is the
     goods subtotal the caller passed, unchanged since the codes existed; for a
     narrowed one it is the matching lines and nothing else. */
  let base = goods;
  let matched: string[] = [];
  if (scope !== "order") {
    if (!lines) return NO("no_match", { code: promo.code, ...where, base: 0 });
    const found = promoBaseFor({ ...where, scopeLines }, lines);
    base = Math.min(goods, found.base);
    matched = found.lines;
    if (!(base > 0)) return NO("no_match", { code: promo.code, ...where, base: 0 });
  }

  /* «Минимальный заказ» on a narrowed code is a floor on the PART it applies
     to, not on the basket around it: «Davines от 40 €» has to mean forty euro
     of Davines. Reading it as the whole basket would sell the very thing the
     scope refuses — spend 200 € on anything at all and the one Davines bottle
     goes cheap. For scope 'order' the two readings are the same number, so no
     code that exists today changes meaning. */
  if (promo.minSubtotal > 0 && base < promo.minSubtotal) {
    return NO("min_subtotal", { code: promo.code, minSubtotal: promo.minSubtotal, ...where, base });
  }

  /* percent — arithmetic on the subset.
     fixed   — **capped at the matching lines' total**: «−20 € на Davines» on
               12 € of Davines is 12 €, never 20. A fixed code that could spill
               past its own subset would be a whole-basket code wearing a
               brand's name. */
  const raw = promo.kind === "percent" ? (base * promo.value) / 100 : Math.min(promo.value, base);
  const discount = cents(Math.max(0, Math.min(base, raw)));
  return {
    ok: true,
    code: promo.code,
    kind: promo.kind,
    discount,
    freeShipping: false,
    minSubtotal: promo.minSubtotal,
    value: promo.value,
    scope,
    scopeValue,
    base,
    lines: matched,
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
 *
 * `lines` is the same basket line by line, and a brand/product code needs it
 * (see quoteFromPromo). A caller that has no lines to give gets `no_match` for
 * such a code, never a whole-basket discount by accident.
 */
export async function quotePromo(
  code: unknown,
  subtotal: number,
  shipping = 0,
  lines: readonly PromoBasketLine[] | null = null,
): Promise<PromoQuote> {
  const norm = normalisePromoCode(code);
  if (!norm) return NO("bad_code");
  const promo = await getPromo(norm);
  if (!promo) return NO("not_found");
  return quoteFromPromo(promo, subtotal, shipping, new Date(), lines);
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
  /** Absent = 'order', the whole basket — see Promo.scope. */
  scope?: PromoScope;
  scopeValue?: string | null;
  /** The product ids a 'cart' code may touch; null for every other scope. */
  scopeLines?: string[] | null;
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

/** An empty box: «not answered», as opposed to «answered with something unreadable». */
function blank(v: unknown): boolean {
  return v == null || (typeof v === "string" && !v.trim());
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
  /* …and not a code shaped like a gift card. One box at the checkout takes
     both, and it routes by shape before anything is looked up — in the browser
     (public/shop2/app.js) and again on the way in here — so «RMP» plus eight
     more characters would be sent to the card lookup whatever the promo table
     says. The owner would have a code the panel lists as live, that no shopper
     can ever use and that answers «Карта не найдена». Refused at the one door
     both the panel and the assistant go through, so it cannot be made. */
  if (looksLikeGiftCode(code)) return { ok: false, error: "gift_shape" };

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

  /* «Минимальный заказ» is a free-text box on a phone, so «сто» and a stray
     letter both reach here. Until 14.09.2026 anything that did not parse fell
     through `?? 0` to «no floor at all» and the code was saved wide open —
     the one answer the owner certainly did not type. Empty still means «no
     floor»; unreadable is refused. */
  const minRaw = blank(x.minSubtotal ?? x.min_subtotal) ? 0 : toNum(x.minSubtotal ?? x.min_subtotal);
  if (minRaw === null || minRaw < 0 || minRaw > 10_000) return { ok: false, error: "bad_min" };
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
  if (!blank(rawUses)) {
    const n = toNum(rawUses);
    if (n === null || !Number.isFinite(n)) return { ok: false, error: "bad_uses" };
    maxUses = Math.trunc(n);
    if (maxUses < 1 || maxUses > 1_000_000) return { ok: false, error: "bad_uses" };
  }

  const note = typeof x.note === "string" ? x.note.replace(/\s+/g, " ").trim().slice(0, 200) || null : null;

  /* «На что действует» — db/migrations/170_promo_scope.sql.
   *
   * Three answers, not two. A body that NAMES a scope gets that one; a body
   * that says nothing leaves both fields `undefined`, which upsertPromo reads
   * as «не трогать» rather than as «весь заказ». The difference is money: the
   * assistant's create_promo (src/app/api/assistant/actions.ts) builds its
   * body from a whitelist that has no scope in it, so editing «−10 % на
   * Davines» through it would otherwise quietly widen the code to the whole
   * shop — with nothing on the confirm card to say so.
   */
  const rawScope = x.scope ?? x.scope_kind;
  const said = !blank(rawScope);
  if (said && !PROMO_SCOPES.includes(rawScope as PromoScope)) return { ok: false, error: "bad_scope" };
  let scope: PromoScope | undefined = said ? (rawScope as PromoScope) : undefined;
  let scopeValue: string | null | undefined = said ? null : undefined;
  let scopeLines: string[] | null | undefined = said ? null : undefined;

  /* …with one answer that is never «не трогать»: a free-delivery code has no
     line to apply to, because the parcel is one line for the whole basket. A
     stated scope on one is refused outright rather than stored and ignored —
     an owner who picked «Davines» and got a code that ships everything free
     would have been told nothing — and an unstated one is written as 'order',
     because a code that has just BECOME free delivery cannot keep a brand it
     no longer has any arithmetic for (the table's constraint would refuse the
     row, and a 500 is not an answer to a save). */
  if (kind === "free_shipping") {
    if (said && scope !== "order") return { ok: false, error: "scope_free_shipping" };
    scope = "order";
    scopeValue = null;
    scopeLines = null;
  } else if (scope && scope !== "order") {
    const raw = x.scopeValue ?? x.scope_value;
    const v = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
    if (!v || v.length > PROMO_MAX_SCOPE_VALUE) return { ok: false, error: "bad_scope_value" };
    scopeValue = v;
    /* …and a 'cart' code must also say WHICH lines. The word alone is not a
       code: without the list it matches nothing (promoLineMatches), so a body
       that names the scope and forgets the ids would be saved as a live code
       that silently discounts zero. Refused here instead, at the one door the
       panel and the assistant both go through — and it is also what keeps
       'cart' from being typed into the panel's scope box by accident, since
       nothing there can produce the list. */
    if (scope === "cart") {
      const rawLines = x.scopeLines ?? x.scope_lines;
      if (!Array.isArray(rawLines)) return { ok: false, error: "bad_scope_lines" };
      const ids: string[] = [];
      for (const item of rawLines) {
        const id = typeof item === "string" ? item.trim() : "";
        if (!id || id.length > 120) return { ok: false, error: "bad_scope_lines" };
        if (ids.indexOf(id) < 0) ids.push(id);
      }
      if (!ids.length || ids.length > PROMO_MAX_CART_LINES) return { ok: false, error: "bad_scope_lines" };
      scopeLines = ids;
    }
  }

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
      scope,
      scopeValue,
      scopeLines,
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
 *
 * …and neither does an edit that never mentioned the scope touch THAT. A null
 * `$10` is «не сказано»: a new row takes 'order' (what every code was before
 * migration 170), and an existing one keeps the brand or the product it was
 * made for. Only a caller that names a scope can change one — see
 * validatePromo, and the assistant's create_promo, which cannot name one.
 */
export async function upsertPromo(input: PromoInput): Promise<Promo> {
  const scope = input.scope ?? null;
  const lines = scope === "cart" ? (input.scopeLines ?? []).slice(0, PROMO_MAX_CART_LINES) : null;
  const rows = await query<PromoRow>(
    `insert into promo_codes (code, kind, value, min_subtotal, starts_at, ends_at, max_uses, active, note, scope, scope_value, scope_lines)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::text, 'order'), $11::text, $12::jsonb)
     on conflict (code) do update set
       kind = excluded.kind,
       value = excluded.value,
       min_subtotal = excluded.min_subtotal,
       starts_at = excluded.starts_at,
       ends_at = excluded.ends_at,
       max_uses = excluded.max_uses,
       active = excluded.active,
       note = excluded.note,
       scope = coalesce($10::text, promo_codes.scope),
       scope_value = case when $10::text is null then promo_codes.scope_value else $11::text end,
       scope_lines = case when $10::text is null then promo_codes.scope_lines else $12::jsonb end
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
      scope,
      scope && scope !== "order" ? input.scopeValue ?? null : null,
      lines && lines.length ? JSON.stringify(lines) : null,
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

export type PromoDelete =
  | { ok: true; code: string }
  | { ok: false; error: "bad_code" | "not_found" | "in_use" | "on_order" };

/**
 * Delete one code — and refuse the moment it is part of somebody's order.
 *
 * Renat, 12.09.2026: a code typed wrong, or made for a weekend that never
 * came, had no way off the screen but the switch. A code nobody has used is
 * exactly that — a row nothing points at — and it goes. A code that HAS been
 * used is a line on an order: `promo_code_uses` would cascade away with it
 * (migration 060) and `orders.discount_code` would name a code that no longer
 * exists, so for those the panel keeps the switch and says why.
 *
 * Three questions, all inside one transaction and with the row locked, so a
 * payment landing between the check and the delete cannot slip a use past it:
 *   · the counter itself, which the paid transition bumps (consumePromo);
 *   · a redemption row, in case that counter was ever put back by hand;
 *   · an order carrying the code, which is what the order card reads.
 *
 * The third has its own answer, `on_order`, because it is not the same fact.
 * `discount_code` is written at checkout and the counter only on payment, so
 * a shopper who applied the code and then walked away from the bank's page
 * leaves a code whose counter reads 0 and which this still refuses — and the
 * panel, told only `in_use`, said «Код уже использован» about a code nobody
 * had used, one row under its own «использован 0».
 */
export async function deletePromo(code: unknown): Promise<PromoDelete> {
  const norm = normalisePromoCode(code);
  if (!norm) return { ok: false, error: "bad_code" };

  return withTx(async (q) => {
    const rows = await q<{ used: number | string }>(
      "select used from promo_codes where code = $1 for update",
      [norm],
    );
    if (!rows.length) return { ok: false, error: "not_found" as const };
    if (Math.trunc(num(rows[0].used)) > 0) return { ok: false, error: "in_use" as const };

    const redeemed = await q<{ id: string }>(
      "select id from promo_code_uses where code = $1 limit 1",
      [norm],
    );
    if (redeemed.length) return { ok: false, error: "in_use" as const };

    /* `orders.discount_code` keeps the string the customer TYPED — «suvi 10»
       for the code SUVI10 (createOrder stores it raw, so the order card and
       the receipt show what was entered) — so the comparison folds the same
       way normalisePromoCode does rather than matching the stored case. */
    const onOrder = await q<{ id: string }>(
      "select id from orders where upper(replace(discount_code, ' ', '')) = $1 limit 1",
      [norm],
    );
    if (onOrder.length) return { ok: false, error: "on_order" as const };

    await q("delete from promo_codes where code = $1", [norm]);
    return { ok: true as const, code: norm };
  });
}
