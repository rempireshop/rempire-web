/**
 * Numeric stock — on top of, not instead of, the manual in/low/out override
 * backend-core already has (product_overrides.stock, db/migrations/001_core.sql).
 *
 * A product nobody has scanned or counted yet has NO stock_levels row for any
 * of its variants and stays in "don't track" mode: its public in/low/out badge
 * keeps coming from the manual override, exactly as before this file existed.
 * The moment a variant gets its FIRST real stock_moves row — a приход scan, an
 * admin qty edit, a sale — that variant switches to numeric tracking and its
 * qty decides the badge from then on.
 *
 * That "first real move" test is deliberate and load-bearing: tools/seed-stock.mjs
 * creates a stock_levels row for every catalogue variant to hold its EAN, with
 * qty left at 0 (see setLevel() — it never touches qty and never writes a
 * ledger row). If a bare seeded row counted as "tracked", running the seed
 * script would flip the ENTIRE catalogue to "нет в наличии" the moment it ran.
 * Requiring an actual stock_moves row before a level counts publicly is what
 * makes seeding safe: the badge only starts trusting a variant once someone
 * has actually moved stock for it.
 *
 * `variant` is '' for a product with no sizes, else the size LABEL exactly as
 * src/lib/orders.ts puts on an order line (e.g. "75 мл", from
 * src/data/catalogue.variants.json) — never an index, so a stock row and an
 * order line always compare as plain text.
 */
import catalogueMin from "@/data/catalogue.min.json";
import variantData from "@/data/catalogue.variants.json";
import { query, withTx } from "@/lib/db";
import type { Querier } from "@/lib/db";

export type StockState = "in" | "low" | "out";

export const MOVE_REASONS = ["sale_web", "sale_pos", "goods_in", "adjust", "return"] as const;
export type MoveReason = (typeof MOVE_REASONS)[number];

export class InventoryError extends Error {
  code: string;
  detail?: string;
  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
  }
}

/* ---------- catalogue (read-only reference, same shape as orders.ts) ----- */

type MinProduct = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as MinProduct[];
const VARIANTS = variantData as Record<string, { sizes: string[]; prices: number[] }>;
const BY_ID = new Map<string, MinProduct>(CATALOGUE.map((p) => [p.id, p]));

function normVariant(v: unknown): string {
  if (v == null) return "";
  return String(v).trim().slice(0, 120);
}

/** A barcode is either a retail code — digits only, EAN-8/UPC-A/EAN-13/GTIN-14
    (8–14 digits, what the phone scanner reads) — or an internal code the shop
    prints itself: letters, digits and dashes, 4–32 characters. Anything else
    ("abc", a lone digit, punctuation) is not a barcode and binds to nothing. */
function normEan(v: unknown): string {
  const s = String(v ?? "").replace(/\s+/g, "").trim().toUpperCase();
  if (/^[0-9]+$/.test(s)) return s.length >= 8 && s.length <= 14 ? s : "";
  return /^[A-Z0-9-]{4,32}$/.test(s) ? s : "";
}

function cleanRef(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().slice(0, 200);
  return s || null;
}
function cleanActor(v: unknown): string {
  const s = v == null ? "" : String(v).trim().slice(0, 80);
  return s || "system";
}

/* ---------- deriveState ---------------------------------------------------
   0 is always "out" — a fresh seeded row (qty 0, no moves yet) never reaches
   here because callers only trust a row once it has moved (see module doc).
   At or under the threshold (and above 0) is "low"; above it is "in". */
export function deriveState(qty: number, lowThreshold: number): StockState {
  const q = Number.isFinite(Number(qty)) ? Number(qty) : 0;
  const t = Number.isFinite(Number(lowThreshold)) && Number(lowThreshold) >= 0 ? Number(lowThreshold) : 2;
  if (q <= 0) return "out";
  if (q <= t) return "low";
  return "in";
}

/* ---------- rows ----------------------------------------------------------- */

type StockLevelRow = {
  product_id: string;
  variant: string;
  qty: number | string;
  low_threshold: number | string;
  ean: string | null;
  updated_at: string | Date;
};

export type StockLevel = {
  productId: string;
  variant: string;
  qty: number;
  lowThreshold: number;
  ean: string | null;
  state: StockState;
  updatedAt: string;
};

function mapLevel(r: StockLevelRow): StockLevel {
  const qty = Number(r.qty) || 0;
  const lowThreshold = Number(r.low_threshold) || 0;
  return {
    productId: r.product_id,
    variant: r.variant,
    qty,
    lowThreshold,
    ean: r.ean,
    state: deriveState(qty, lowThreshold),
    updatedAt: new Date(r.updated_at as string).toISOString(),
  };
}

/** One (product, variant) row, or null when nothing has ever been recorded for it. */
export async function getLevel(productId: string, variant?: string | null): Promise<StockLevel | null> {
  const pid = String(productId ?? "").trim();
  if (!pid) return null;
  const v = normVariant(variant);
  const rows = await query<StockLevelRow>("select * from stock_levels where product_id = $1 and variant = $2", [pid, v]);
  return rows.length ? mapLevel(rows[0]) : null;
}

/**
 * Barcode → level, joined with the catalogue for the scanner card. Null when
 * the code matches nothing — the caller (the admin route) is what offers
 * «assign this code to a product» in that case; this function only looks up.
 */
export type EanHit = StockLevel & {
  product: { id: string; brand: string; name: string; category: string; price: number } | null;
};

export async function byEan(code: string): Promise<EanHit | null> {
  const ean = normEan(code);
  if (!ean) return null;
  const rows = await query<StockLevelRow>("select * from stock_levels where ean = $1", [ean]);
  if (!rows.length) return null;
  const level = mapLevel(rows[0]);
  const p = BY_ID.get(level.productId) ?? null;
  return { ...level, product: p ? { id: p.id, brand: p.b, name: p.n, category: p.c, price: p.p } : null };
}

/**
 * Partial upsert of the STATIC fields — EAN and the low-stock threshold.
 * Never touches qty and never writes a stock_moves row: every quantity change
 * goes through move()/setQty() so the ledger stays the single source of truth
 * for "why is qty what it is". Creates the row (qty 0) if it does not exist
 * yet, which is exactly what tools/seed-stock.mjs relies on.
 */
export async function setLevel(
  productId: string,
  variant: string | null | undefined,
  patch: { ean?: string | null; lowThreshold?: number },
): Promise<StockLevel> {
  const pid = String(productId ?? "").trim();
  if (!pid) throw new InventoryError("bad_product");
  const v = normVariant(variant);

  const cols: Record<string, unknown> = {};
  if ("ean" in patch) {
    if (patch.ean == null || patch.ean === "") {
      cols.ean = null;
    } else {
      const e = normEan(patch.ean);
      if (!e) throw new InventoryError("bad_ean", String(patch.ean));
      const existing = await byEan(e);
      if (existing && (existing.productId !== pid || existing.variant !== v)) {
        throw new InventoryError("ean_taken", existing.productId);
      }
      cols.ean = e;
    }
  }
  if ("lowThreshold" in patch) {
    const n = Math.trunc(Number(patch.lowThreshold));
    if (!Number.isFinite(n) || n < 0 || n > 100000) throw new InventoryError("bad_threshold");
    cols.low_threshold = n;
  }

  const keys = Object.keys(cols);
  const params: unknown[] = [pid, v, ...keys.map((k) => cols[k])];
  const holes = keys.map((_, i) => `$${i + 3}`);
  const sql = keys.length
    ? `insert into stock_levels (product_id, variant, ${keys.join(", ")}, updated_at)
       values ($1, $2, ${holes.join(", ")}, now())
       on conflict (product_id, variant) do update set
         ${keys.map((k, i) => `${k} = ${holes[i]}`).join(", ")}, updated_at = now()
       returning *`
    : `insert into stock_levels (product_id, variant) values ($1, $2)
       on conflict (product_id, variant) do update set updated_at = now()
       returning *`;
  const rows = await query<StockLevelRow>(sql, params);
  return mapLevel(rows[0]);
}

/* ---------- move() — the one door quantities change through -------------- */

/** Ceiling for a quantity or a move, well inside the `integer` column's range. */
export const MAX_QTY = 1_000_000;

export type MoveInput = {
  productId: string;
  variant?: string | null;
  delta: number;
  reason: MoveReason;
  ref?: string | null;
  actor?: string | null;
};

export type MoveResult = {
  productId: string;
  variant: string;
  qtyBefore: number;
  qtyAfter: number;
  /** May be smaller in magnitude than the requested delta — see clampedNegative. */
  appliedDelta: number;
  /** True when the requested delta would have taken qty below 0 and was clamped at 0. */
  clampedNegative: boolean;
  moveId: number;
  /** True when a sale was NOT applied because the product×variant is not tracked yet
      (no goods-in / adjustment ever recorded) — selling must never flip an
      untracked product to «нет в наличии». */
  skipped?: boolean;
};

/** Reasons that make a product×variant "tracked" — a sale alone never does. */
export const TRACKING_REASONS = ["goods_in", "adjust", "return"] as const;
const TRACKING_SQL = "('goods_in','adjust','return')";
export function isSaleReason(reason: MoveReason): boolean {
  return reason === "sale_web" || reason === "sale_pos";
}

/** Runs inside an existing transaction — shared by move() and setQty(). */
async function applyMove(
  q: Querier,
  productId: string,
  variant: string,
  wantDelta: number | null,
  wantTarget: number | null,
  reason: MoveReason,
  ref: string | null,
  actor: string,
): Promise<MoveResult> {
  // Row-if-missing first, so a product nobody has touched can still receive
  // its first move without a separate "create the level" step.
  await q(
    `insert into stock_levels (product_id, variant, qty, low_threshold, updated_at)
     values ($1, $2, 0, 2, now())
     on conflict (product_id, variant) do nothing`,
    [productId, variant],
  );
  // Locked read: setQty()'s delta is computed from THIS value, inside the same
  // transaction, so a concurrent move cannot make the "set to N" stale between
  // the read and the write.
  const before = await q<{ qty: number | string }>(
    "select qty from stock_levels where product_id = $1 and variant = $2 for update",
    [productId, variant],
  );
  const qtyBefore = Number(before[0]?.qty ?? 0);

  let delta = wantTarget != null ? wantTarget - qtyBefore : Number(wantDelta);
  let clampedNegative = false;
  if (qtyBefore + delta < 0) {
    delta = -qtyBefore;
    clampedNegative = true;
  }

  const updated = await q<{ qty: number | string }>(
    "update stock_levels set qty = qty + $3, updated_at = now() where product_id = $1 and variant = $2 returning qty",
    [productId, variant, delta],
  );
  const qtyAfter = Number(updated[0].qty);

  const moveRows = await q<{ id: number | string }>(
    `insert into stock_moves (product_id, variant, delta, reason, ref, actor)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [productId, variant, delta, reason, ref, actor],
  );

  return {
    productId,
    variant,
    qtyBefore,
    qtyAfter,
    appliedDelta: delta,
    clampedNegative,
    moveId: Number(moveRows[0].id),
  };
}

/** Best-effort — a mail hiccup must never undo a stock move that already committed. */
async function fireBackInStock(productId: string): Promise<void> {
  try {
    const { runBackInStock } = await import("@/lib/flows");
    await runBackInStock(productId);
  } catch (err) {
    console.error("[inventory] back-in-stock flow failed:", err);
  }
}

/**
 * Atomic `qty = qty + delta` plus its ledger row, never below 0. A delta that
 * would cross 0 is clamped there and reported back via `clampedNegative`
 * rather than thrown — the caller (a paid order, a scan) decides how loudly
 * to log it; this function's job is to never leave the row negative.
 */
export async function move(input: MoveInput): Promise<MoveResult> {
  const productId = String(input.productId ?? "").trim();
  if (!productId) throw new InventoryError("bad_product");
  const variant = normVariant(input.variant);
  const delta = Math.trunc(Number(input.delta));
  // stock_levels.qty is an integer column: 1e308 is "finite" to JS and 22003
  // ("value out of range") to Postgres. A shelf holds fewer than MAX_QTY.
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > MAX_QTY) {
    throw new InventoryError("bad_delta");
  }
  if (!MOVE_REASONS.includes(input.reason)) throw new InventoryError("bad_reason", String(input.reason));
  const ref = cleanRef(input.ref);
  const actor = cleanActor(input.actor);

  const r = await withTx(async (q) => {
    if (isSaleReason(input.reason)) {
      const t = await q<{ ok: number }>(
        `select 1 as ok from stock_moves where product_id = $1 and variant = $2 and reason in ${TRACKING_SQL} limit 1`,
        [productId, variant],
      );
      if (!t.length) {
        console.warn(`[inventory] sale on untracked ${productId}${variant ? ":" + variant : ""} skipped (${input.reason}${ref ? " " + ref : ""})`);
        return { productId, variant, qtyBefore: 0, qtyAfter: 0, appliedDelta: 0, clampedNegative: false, moveId: 0, skipped: true } as MoveResult;
      }
    }
    return applyMove(q, productId, variant, delta, null, input.reason, ref, actor);
  });
  if (r.skipped) return r;
  if (r.clampedNegative) {
    console.error(
      `[inventory] blocked at 0: ${productId}${variant ? ":" + variant : ""} wanted ${delta}, applied ${r.appliedDelta} (${input.reason}${ref ? " " + ref : ""})`,
    );
  }
  if (r.qtyBefore === 0 && r.qtyAfter > 0) await fireBackInStock(productId);
  return r;
}

/**
 * Sets the ABSOLUTE quantity — «останется 10 штук» rather than «плюс 3». Still
 * one ledger row (reason defaults to 'adjust'): the difference between the old
 * and new qty is what gets written as the move's delta, computed inside the
 * same locked transaction as the write so a concurrent sale cannot make the
 * target stale.
 */
export async function setQty(
  productId: string,
  variant: string | null | undefined,
  qty: number,
  opts: { reason?: MoveReason; ref?: string | null; actor?: string | null } = {},
): Promise<MoveResult> {
  const pid = String(productId ?? "").trim();
  if (!pid) throw new InventoryError("bad_product");
  const v = normVariant(variant);
  const target = Math.trunc(Number(qty));
  if (!Number.isFinite(target) || target < 0 || target > MAX_QTY) throw new InventoryError("bad_qty");
  const reason = opts.reason && MOVE_REASONS.includes(opts.reason) ? opts.reason : "adjust";
  const ref = cleanRef(opts.ref);
  const actor = cleanActor(opts.actor);

  const r = await withTx((q) => applyMove(q, pid, v, null, target, reason, ref, actor));
  if (r.qtyBefore === 0 && r.qtyAfter > 0) await fireBackInStock(pid);
  return r;
}

/* ---------- product-level state for the public overrides feed ------------ */

/**
 * One state per product id, aggregated across whatever variants of it are
 * actually tracked (see the module doc for what "tracked" means). A product
 * missing from the returned map has no tracked variant at all — the caller
 * (src/lib/orders.ts getOverrides()) falls back to the manual override.
 *
 * Aggregation: out only if EVERY tracked variant is out; low if any tracked
 * variant is low (and not all are out); in otherwise — the same "still
 * sellable while one size remains" rule a shopper would expect.
 */
export async function productStockStates(ids?: string[]): Promise<Record<string, StockState>> {
  const trackedClause =
    `exists (select 1 from stock_moves m where m.product_id = sl.product_id and m.variant = sl.variant and m.reason in ${TRACKING_SQL})`;
  let rows: StockLevelRow[];
  if (ids && ids.length) {
    const holes = ids.map((_, i) => `$${i + 1}`).join(",");
    rows = await query<StockLevelRow>(
      `select sl.* from stock_levels sl where sl.product_id in (${holes}) and ${trackedClause}`,
      ids,
    );
  } else {
    rows = await query<StockLevelRow>(`select sl.* from stock_levels sl where ${trackedClause}`);
  }

  const byProduct = new Map<string, StockLevelRow[]>();
  for (const r of rows) {
    const list = byProduct.get(r.product_id) ?? [];
    list.push(r);
    byProduct.set(r.product_id, list);
  }
  const out: Record<string, StockState> = {};
  for (const [productId, list] of byProduct) {
    const states = list.map((r) => deriveState(Number(r.qty), Number(r.low_threshold)));
    out[productId] = states.every((s) => s === "out") ? "out" : states.some((s) => s === "low") ? "low" : "in";
  }
  return out;
}

/* ---------- the admin table: every catalogue variant, tracked or not ----- */

export type LevelFilter = "all" | "low" | "out" | "untracked";

export type CatalogueLevelRow = {
  productId: string;
  variant: string;
  brand: string;
  name: string;
  category: string;
  price: number;
  qty: number;
  lowThreshold: number;
  ean: string | null;
  state: StockState;
  /** Has at least one stock_moves row — see the module doc. */
  tracked: boolean;
  updatedAt: string | null;
};

function catalogueUniverse(): Array<{ productId: string; variant: string }> {
  const out: Array<{ productId: string; variant: string }> = [];
  for (const p of CATALOGUE) {
    const v = VARIANTS[p.id];
    if (v && v.sizes && v.sizes.length) {
      for (const size of v.sizes) out.push({ productId: p.id, variant: size });
    } else {
      out.push({ productId: p.id, variant: "" });
    }
  }
  return out;
}

async function trackedKeys(): Promise<Set<string>> {
  const rows = await query<{ product_id: string; variant: string }>(
    `select distinct product_id, variant from stock_moves where reason in ${TRACKING_SQL}`,
  );
  return new Set(rows.map((r) => r.product_id + "\u0000" + r.variant));
}

/**
 * Every product×variant the catalogue has, left-joined onto whatever
 * stock_levels rows exist (in JS — the catalogue is a few hundred rows, not
 * worth a database round trip of its own). This is what the admin «Склад»
 * table shows: a size nobody has scanned in yet still gets a row, at qty 0,
 * not tracked — so Renat can see it is missing, not just not query for it.
 */
export async function getLevels(opts: { q?: string; filter?: LevelFilter; limit?: number } = {}): Promise<CatalogueLevelRow[]> {
  const universe = catalogueUniverse();
  const [dbRows, tracked] = await Promise.all([query<StockLevelRow>("select * from stock_levels"), trackedKeys()]);
  const byKey = new Map(dbRows.map((r) => [r.product_id + "\u0000" + r.variant, r]));

  let rows: CatalogueLevelRow[] = universe.map(({ productId, variant }) => {
    const key = productId + "\u0000" + variant;
    const row = byKey.get(key);
    const p = BY_ID.get(productId);
    const qty = row ? Number(row.qty) || 0 : 0;
    const lowThreshold = row ? Number(row.low_threshold) || 0 : 2;
    return {
      productId,
      variant,
      brand: p?.b ?? "",
      name: p?.n ?? productId,
      category: p?.c ?? "",
      price: p?.p ?? 0,
      qty,
      lowThreshold,
      ean: row?.ean ?? null,
      state: deriveState(qty, lowThreshold),
      tracked: tracked.has(key),
      updatedAt: row?.updated_at ? new Date(row.updated_at as string).toISOString() : null,
    };
  });

  const q = (opts.q ?? "").trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) => (r.brand + " " + r.name + " " + r.productId + " " + (r.ean || "")).toLowerCase().includes(q));
  }
  if (opts.filter === "low") rows = rows.filter((r) => r.tracked && r.state === "low");
  else if (opts.filter === "out") rows = rows.filter((r) => r.tracked && r.state === "out");
  else if (opts.filter === "untracked") rows = rows.filter((r) => !r.tracked);

  const rank = (r: CatalogueLevelRow) => (!r.tracked ? 1 : r.state === "out" ? 0 : r.state === "low" ? 0.5 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || (a.brand + a.name).localeCompare(b.brand + b.name, "ru"));

  const limit = Math.min(Math.max(Number(opts.limit) || 500, 1), 1000);
  return rows.slice(0, limit);
}

/** Tracked and not «в наличии» — the assistant's low-stock context and the admin's own summary. */
export async function lowStockSummary(limit = 15): Promise<CatalogueLevelRow[]> {
  const rows = await getLevels({ filter: "all" });
  return rows.filter((r) => r.tracked && r.state !== "in").slice(0, limit);
}

/* ---------- the ledger ----------------------------------------------------- */

export type MoveRow = {
  id: number;
  at: string;
  productId: string;
  variant: string;
  delta: number;
  reason: MoveReason;
  ref: string | null;
  actor: string | null;
  brand: string;
  name: string;
};

export async function listMoves(
  opts: { productId?: string; reason?: MoveReason; since?: string; limit?: number } = {},
): Promise<MoveRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.productId) {
    params.push(opts.productId);
    where.push(`product_id = $${params.length}`);
  }
  if (opts.reason && MOVE_REASONS.includes(opts.reason)) {
    params.push(opts.reason);
    where.push(`reason = $${params.length}`);
  }
  /* `at >= $n` casts the parameter to timestamptz: "?since=yesterday" is
     22007 from Postgres and reads as a 503 to the admin. An unparseable
     date is no filter at all, which is what the ledger shows anyway. */
  const since = opts.since ? new Date(opts.since) : null;
  if (since && !Number.isNaN(since.getTime())) {
    params.push(since.toISOString());
    where.push(`at >= $${params.length}`);
  }
  params.push(Math.min(Math.max(Number(opts.limit) || 100, 1), 500));

  const rows = await query<{
    id: number | string;
    at: string | Date;
    product_id: string;
    variant: string;
    delta: number;
    reason: MoveReason;
    ref: string | null;
    actor: string | null;
  }>(
    `select id, at, product_id, variant, delta, reason, ref, actor from stock_moves
     ${where.length ? "where " + where.join(" and ") : ""}
     order by at desc, id desc limit $${params.length}`,
    params,
  );
  return rows.map((r) => {
    const p = BY_ID.get(r.product_id);
    return {
      id: Number(r.id),
      at: new Date(r.at as string).toISOString(),
      productId: r.product_id,
      variant: r.variant,
      delta: r.delta,
      reason: r.reason,
      ref: r.ref,
      actor: r.actor,
      brand: p?.b ?? "",
      name: p?.n ?? r.product_id,
    };
  });
}

/** UTC-midnight "today" — good enough for a running list, see docs/inventory.md. */
export async function todaysMoves(limit = 50): Promise<MoveRow[]> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return listMoves({ since: start.toISOString(), limit });
}
