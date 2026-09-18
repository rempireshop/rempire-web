/**
 * Numeric stock — on top of, not instead of, the manual in/low/out override
 * backend-core already has (product_overrides.stock, db/migrations/001_core.sql).
 *
 * A product nobody has scanned or counted yet has NO stock_levels row for any
 * of its variants and stays in "don't track" mode: its public in/low/out badge
 * keeps coming from the manual override, exactly as before this file existed.
 * The moment a variant gets its FIRST counting move — a приход scan, an admin
 * qty edit, a return (TRACKING_REASONS below) — that variant switches to
 * numeric tracking and its qty decides the badge from then on. A sale is NOT
 * such a move: move() skips a sale_web/sale_pos on a variant nobody has
 * counted yet (MoveResult.skipped) instead of creating a qty-0 row for it —
 * otherwise the first paid web order would flip an uncounted product to
 * «нет в наличии», which is exactly what it did to the e2e suite's fixed test
 * product before that guard existed (e2e/fixtures.ts PRODUCT).
 *
 * That "first counting move" test is deliberate and load-bearing: tools/seed-stock.mjs
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

/**
 * 'edit' is a ledger reason nobody may ask for — setLevel() writes it itself
 * when the CARD changed rather than the count (a barcode bound, the «мало»
 * threshold moved), so the sentence the owner typed under «Причина (видна в
 * истории)» ends up where the label promises it will. Always delta 0, and
 * never one of TRACKING_REASONS: see db/migrations/092_stock_move_edit.sql.
 * Kept out of MOVE_REASONS on purpose — that list is what the admin route
 * and the assistant validate against, and neither may write a card change
 * as if it were a movement of goods.
 */
export const EDIT_REASON = "edit" as const;
export const LEDGER_REASONS = [...MOVE_REASONS, EDIT_REASON] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];

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
  /**
   * Has this size ever actually been counted (see the module doc)? A barcode
   * bound by the scanner or by tools/seed-stock.mjs makes a row at qty 0 and
   * no ledger line at all, so «qty» alone cannot tell «шкаф пустой» from
   * «ещё ни разу не считали» — and the scanner card, which had to guess,
   * guessed «на складе 0» and showed an empty shelf for a full one.
   */
  tracked: boolean;
};

/** The level a code is bound to, with no catalogue lookup — what setLevel()'s
    «is this code taken?» question needs, and half of byEan() below. */
async function levelByEan(code: string): Promise<StockLevel | null> {
  const ean = normEan(code);
  if (!ean) return null;
  const rows = await query<StockLevelRow>("select * from stock_levels where ean = $1", [ean]);
  return rows.length ? mapLevel(rows[0]) : null;
}

/**
 * The product behind an id — the catalogue file first, then the owner's own
 * products (custom_products, db/migrations/131_custom_products.sql).
 *
 * That second half is the whole point: BY_ID is built from
 * src/data/catalogue.min.json, which by construction cannot contain a row the
 * owner created in the panel. So a barcode bound to one of HIS products came
 * back from byEan() with `product: null`, and the scanner read that as «Код
 * не привязан» — on «Склад» AND on «Салон», where «Добавить в продажу» does
 * nothing at all without a product (scanToCart in public/shop2/app.js). His
 * own bottle scanned as an unknown code no matter how carefully he had bound
 * it. Best effort, like customUniverse() below: a missing table leaves the
 * catalogue answer exactly as it was.
 */
async function productRef(productId: string): Promise<EanHit["product"]> {
  const p = BY_ID.get(productId);
  if (p) return { id: p.id, brand: p.b, name: p.n, category: p.c, price: p.p };
  try {
    const { customMinByIds, isCustomId } = await import("@/lib/custom-products");
    if (!isCustomId(productId)) return null;
    const own = (await customMinByIds([productId])).get(productId);
    if (!own) return null;
    const m = own.min;
    return { id: m.id, brand: m.b, name: m.n, category: m.c, price: m.p };
  } catch (err) {
    console.error("[inventory] custom product lookup failed:", err);
    return null;
  }
}

export async function byEan(code: string): Promise<EanHit | null> {
  const level = await levelByEan(code);
  if (!level) return null;
  const [product, tracked] = await Promise.all([
    productRef(level.productId),
    isTracked(level.productId, level.variant),
  ]);
  return { ...level, product, tracked };
}

/**
 * Partial upsert of the STATIC fields — EAN and the low-stock threshold.
 * Never touches qty: every quantity change goes through move()/setQty() so
 * stock_levels.qty stays the sum of every delta in the ledger. Creates the
 * row (qty 0) if it does not exist yet, which is exactly what
 * tools/seed-stock.mjs relies on.
 *
 * `opts.note` is the sentence the owner typed under «Причина (видна в
 * истории)» on «Склад» → «Править». Given one, a change to the card leaves
 * its own 'edit' line in the ledger — delta 0, because nothing left or
 * reached the shelf — so the reason beside a corrected threshold is kept
 * exactly like the reason beside a corrected count already was. Without a
 * note nothing is written: seed-stock.mjs and the scanner's bind fill in
 * hundreds of barcodes and none of them is a correction anybody has to
 * explain. See db/migrations/092_stock_move_edit.sql.
 */
export async function setLevel(
  productId: string,
  variant: string | null | undefined,
  patch: { ean?: string | null; lowThreshold?: number },
  opts: { note?: string | null; actor?: string | null } = {},
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
      const existing = await levelByEan(e);
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

  const note = cleanRef(opts.note);
  if (note && keys.length) {
    /* Best effort and after the write: the card change is saved either way,
       and a shop whose 092 migration has not run yet refuses the reason
       rather than the barcode. */
    try {
      await query(
        `insert into stock_moves (product_id, variant, delta, reason, ref, actor)
         values ($1, $2, 0, $3, $4, $5)`,
        [pid, v, EDIT_REASON, note, cleanActor(opts.actor)],
      );
    } catch (err) {
      console.error("[inventory] the reason for a card change was not recorded:", err);
    }
  }
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

/** One shelf row and how much of it an order line moves. */
export type StockUnit = { productId: string; variant: string; qty: number };

/**
 * Which shelf row an order line's size names — the line's own label, or, when
 * it carries none, the single rung of a product that has exactly one.
 *
 * variantOf() in src/lib/orders.ts applies the same rule when the line is
 * WRITTEN, so everything ordered from 18.09.2026 already arrives here named.
 * This is for the lines written before it did: twenty-nine products are sold
 * in one named volume and the storefront sends no size for them
 * (public/shop/catalogue2.js gives them `sizes` and no `prices`, and
 * lineVariant() speaks only in price-ladder indexes), so their stored lines
 * say ''. Nothing will ever go back and edit those, and an order placed
 * before the fix but PAID after it would go to '' , find no tracking rows —
 * db/migrations/194_one_size_stock_rows.sql moved them all onto the label —
 * and be skipped in silence, on an order the shop had already been paid for.
 * The key is read off the line at the moment the goods move, so reading it
 * through the ladder closes that for the decrement, the refund and the till
 * at once.
 *
 * Only ever the FILE's ladder, because this function is pure and the owner's
 * saved ladders live in a table. That is not a gap: migration 194 deliberately
 * left owner-laddered products alone, because knownLadder() has always read
 * his rung first, so their counts were never under '' to begin with.
 *
 * Both of the things that must not move: a product with no volumes at all IS
 * the '' row — most of the catalogue — and a ladder of two rungs still holds a
 * choice nothing here is entitled to make. Same predicate as variantOf(): one
 * rung, and that rung has a name.
 */
function shelfVariant(productId: string, variant: unknown): string {
  const named = normVariant(variant);
  if (named) return named;
  const ladder = VARIANTS[productId];
  return ladder && ladder.sizes.length === 1 && ladder.sizes[0] ? ladder.sizes[0] : "";
}

/**
 * The shelf rows ONE order line moves — what the paid transition decrements
 * (src/lib/payments/apply.ts, the POS route) and what a refund puts back
 * (src/lib/orders.ts setOrderStatus).
 *
 * A product line is one row, at its own size label. A set line («bundle:<id>»)
 * is not a catalogue product and never was: it carries the parts it was sold
 * as, and each of those is a row of its own, multiplied by how many sets were
 * bought — before this, a paid set took nothing off the shelf at all and the
 * shop went on offering bottles that had left the room. A gift card, and a set
 * line from before the parts were recorded, move nothing.
 */
export function stockUnitsOf(line: {
  id?: string;
  kind?: string;
  variant?: string | null;
  qty?: number | string | null;
  parts?: Array<{ id?: string; variant?: string | null; qty?: number | string | null }> | null;
}): StockUnit[] {
  const qty = Math.abs(Math.trunc(Number(line?.qty) || 0));
  if (!qty) return [];
  if (line?.kind === "product") {
    const productId = String(line.id ?? "").trim();
    return productId ? [{ productId, variant: shelfVariant(productId, line.variant), qty }] : [];
  }
  if (line?.kind === "bundle" && Array.isArray(line.parts)) {
    const out: StockUnit[] = [];
    for (const part of line.parts) {
      const productId = String(part?.id ?? "").trim();
      const each = Math.abs(Math.trunc(Number(part?.qty) || 0));
      if (!productId || !each) continue;
      out.push({ productId, variant: shelfVariant(productId, part?.variant), qty: qty * each });
    }
    return out;
  }
  return [];
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

/* ---------- a size renamed or removed in the editor -----------------------

   The rows here are keyed by the size LABEL, so an owner who fixes «100 мл»
   to «100 ml» on his own product (PUT /api/admin/products/[id]) would
   otherwise leave the counted stock, the barcode and the ledger stranded
   under a label nothing lists any more, and the shop would read the renamed
   size as «never counted». updateCustomProduct() (src/lib/custom-products.ts)
   calls syncVariantRows() inside the same transaction as the row update. */

/**
 * What the size list's change means for the stock rows — pure, so it can be
 * pinned: a label that changed at the same position, where neither the old
 * label survives elsewhere nor the new one existed before, is a rename (the
 * rows move); an old label absent from the new list is a deletion. A swap or
 * a reorder (both labels still present) touches nothing. A single-price
 * product is the '' variant, so going from one price to sizes moves its
 * count to the first size, and back again.
 */
export function variantTransitions(
  oldSizes: string[],
  newSizes: string[],
): { renames: Array<[from: string, to: string]>; deletes: string[] } {
  const before = oldSizes.length ? oldSizes : [""];
  const after = newSizes.length ? newSizes : [""];
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const renames: Array<[string, string]> = [];
  const moved = new Set<string>();
  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    const a = before[i];
    const b = after[i];
    if (a === b || afterSet.has(a) || beforeSet.has(b)) continue;
    renames.push([a, b]);
    moved.add(a);
  }
  const deletes = before.filter((a) => !afterSet.has(a) && !moved.has(a));
  return { renames, deletes };
}

/**
 * Applies variantTransitions() to stock_levels AND stock_moves — the ledger
 * moves with the level, or `tracked` (which is read off the ledger) would
 * flip to false for a size that was merely respelled. A deleted size loses
 * its level and its ledger lines: the size is gone, and a row left behind
 * would make the label read «tracked, 0 — нет в наличии» the day it is
 * added again. Runs inside the caller's transaction.
 */
export async function syncVariantRows(
  q: Querier,
  productId: string,
  oldSizes: string[],
  newSizes: string[],
): Promise<{ renames: Array<[string, string]>; deletes: string[] }> {
  const t = variantTransitions(oldSizes, newSizes);
  for (const [from, to] of t.renames) {
    // a stale row under the new label (a size deleted and re-added) is an
    // orphan by construction — it would collide with the primary key
    await q("delete from stock_levels where product_id = $1 and variant = $2", [productId, to]);
    await q("delete from stock_moves where product_id = $1 and variant = $2", [productId, to]);
    await q("update stock_levels set variant = $3, updated_at = now() where product_id = $1 and variant = $2", [productId, from, to]);
    await q("update stock_moves set variant = $3 where product_id = $1 and variant = $2", [productId, from, to]);
  }
  for (const v of t.deletes) {
    await q("delete from stock_levels where product_id = $1 and variant = $2", [productId, v]);
    await q("delete from stock_moves where product_id = $1 and variant = $2", [productId, v]);
  }
  return t;
}

/* ---------- derived state: per product for the feed, per size for the till ---- */

/** Every stock_levels row of a TRACKED product×variant (see the module doc),
    for the two readers below — the per-product aggregate the badge uses and
    the per-size map the checkout does. */
async function trackedLevelRows(ids?: string[]): Promise<StockLevelRow[]> {
  const trackedClause =
    `exists (select 1 from stock_moves m where m.product_id = sl.product_id and m.variant = sl.variant and m.reason in ${TRACKING_SQL})`;
  if (ids && ids.length) {
    const holes = ids.map((_, i) => `$${i + 1}`).join(",");
    return query<StockLevelRow>(
      `select sl.* from stock_levels sl where sl.product_id in (${holes}) and ${trackedClause}`,
      ids,
    );
  }
  return query<StockLevelRow>(`select sl.* from stock_levels sl where ${trackedClause}`);
}

/**
 * Those rows, NOT aggregated: productId → variant label → state, tracked
 * variants only.
 *
 * The aggregate below is the right answer for a BADGE — a product with one
 * size left is still worth a page. It is the wrong answer for a TILL: the
 * checkout gated on it, so a size counted down to zero went on being sold
 * and paid for as long as any other size of the same product was in stock,
 * and the sale move was then clamped to 0 with nothing but a console line to
 * say so. src/lib/orders.ts priceItems() asks this one about the size that
 * was actually ordered.
 */
export async function variantStockStates(ids?: string[]): Promise<Record<string, Record<string, StockState>>> {
  return (await stockStates(ids)).byVariant;
}

/**
 * One state per product id, aggregated across whatever variants of it are
 * actually tracked (see the module doc for what "tracked" means). A product
 * missing from the returned map has no word of its own, and the caller
 * (src/lib/orders.ts getOverrides()) falls back to the manual override —
 * either because nothing about it is tracked, or because the count is not
 * complete enough to say «нет в наличии», which is the rule below.
 *
 * Aggregation: low if any tracked variant is low (and not all are out); in
 * otherwise — the same "still sellable while one size remains" rule a shopper
 * would expect. Out only if every tracked variant is out AND those variants
 * cover the product's whole size ladder: see stockStates().
 */
export async function productStockStates(ids?: string[]): Promise<Record<string, StockState>> {
  return (await stockStates(ids)).byProduct;
}

/**
 * Both readings of the same tracked levels, from one query.
 *
 * `byProduct` is the word above — what a product card shows. `byVariant` is
 * the state of each size on its own, keyed by the size LABEL exactly as an
 * order line carries it (module doc; '' for a product with no sizes).
 *
 * The two are not interchangeable, and treating them as one was a real hole:
 * the product word says "in" while any single size is left, so a sold-out
 * 500 ml on a product whose 75 ml is on the shelf was shown in stock, put in
 * a basket and paid for. createOrder() checks `byVariant` for the size the
 * order actually names (audit 14.09.2026, found from both ends — «товары» and
 * «витрина»).
 *
 * One query for both: the aggregate is folded from the very rows the per-size
 * map is made of, so a caller that wants both (getOverrides) pays one round
 * trip, and the two can never disagree about the same shelf.
 */
export async function stockStates(
  ids?: string[],
  ladders?: Map<string, string[]>,
): Promise<{ byProduct: Record<string, StockState>; byVariant: Record<string, Record<string, StockState>> }> {
  const rows = await trackedLevelRows(ids);

  const byProduct: Record<string, StockState> = {};
  const byVariant: Record<string, Record<string, StockState>> = {};
  const counted = new Map<string, Map<string, StockState>>();
  for (const r of rows) {
    const state = deriveState(Number(r.qty), Number(r.low_threshold));
    (byVariant[r.product_id] ??= {})[r.variant] = state;
    let sizes = counted.get(r.product_id);
    if (!sizes) counted.set(r.product_id, (sizes = new Map<string, StockState>()));
    sizes.set(r.variant, state);
  }

  /* «мало» and «в наличии» are decided by the counted sizes alone, as before:
     news that a shelf is running low costs no sale, and holding it back until
     every other size has been counted would leave the badge frozen in a shop
     that counts one shelf at a time. */
  const allOut: string[] = [];
  for (const [productId, sizes] of counted) {
    const states = [...sizes.values()];
    if (states.every((s) => s === "out")) allOut.push(productId);
    else byProduct[productId] = states.some((s) => s === "low") ? "low" : "in";
  }

  /* «Нет в наличии» is the one word that costs a sale, so it needs the whole
     LADDER counted behind it, not just the sizes somebody happened to reach.
     A product whose 75 мл was counted to zero while nobody ever counted the
     250 мл and the 500 мл read «out» for every size at once: the storefront
     said «нет в наличии» and priceItems() refused the order on the sizes that
     were full on the shelf, with nothing on any screen to explain it (audit
     14.09.2026). Short of full coverage the product simply has no word of its
     own here — it drops out of the map and getOverrides() leaves the manual
     product_overrides.stock in charge, which is what a product nobody has
     counted at all already does (see the module doc).

     The ladder is read once, and only when something actually reads out — a
     feed with nothing empty on it pays for no ladder query at all, and
     getOverrides() hands over ladders it has already fetched. */
  if (allOut.length) {
    const owned = ladders ?? (await ownerLadders());
    for (const productId of allOut) {
      const ladder = knownLadder(productId, owned);
      const sizes = counted.get(productId)!;
      /* No ladder we can vouch for (an owner's own product, whose rungs live
         in a table this path does not read) leaves the old rule standing:
         this may only ever withhold «out», never invent one. */
      if (!ladder || ladder.every((rung) => sizes.has(rung))) byProduct[productId] = "out";
    }
  }
  return { byProduct, byVariant };
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
  /**
   * «Показывать в магазине» is off for this product — whichever of the two
   * switches it is: product_overrides.hidden for a catalogue product,
   * custom_products.active for one of the owner's own. The row is still on
   * «Склад», badged «Скрыт», and still countable and correctable; what it
   * never does is ask to be restocked. See getLevels() below.
   */
  offSale: boolean;
  updatedAt: string | null;
};

/**
 * The volumes a catalogue product actually has — the ladder the owner saved in
 * the editor where there is one (product_overrides.sizes, migration 147), the
 * generated file's otherwise.
 *
 * This is the difference between a shelf that exists and one that does not. A
 * size «+ Размер» added, or one renamed, was unknown to the table below, so it
 * had no «Склад» row at all: nobody could count it in, which left it untracked,
 * which made every sale of it a sale on an uncounted variant — skipped in
 * silence by move() while the receipt said «остатки списаны». The row a RENAMED
 * size leaves behind is the other half of the same hole: off this screen, so
 * unfindable and uncorrectable, yet still counted by productStockStates(), so
 * one orphan at 5 could hold a product at «в наличии» while every size it
 * really has stood at zero.
 *
 * The editor, the cart and the till all read this ladder first
 * (overrideLadder() in src/lib/orders.ts); the shelf has to read the same one.
 */
function ladderOf(productId: string, owned: Map<string, string[]>): string[] {
  return knownLadder(productId, owned) ?? [""];
}

/**
 * The same ladder, but honest about not knowing one.
 *
 * `[""]` is the right answer for a CATALOGUE product with no volumes: one
 * unlabelled rung, which is the shape stock_levels stores it in. For an id the
 * generated file has never heard of it is only a guess — that is one of the
 * owner's own products (src/lib/custom-products.ts), whose ladder lives in a
 * table this path deliberately does not read. stockStates() has to tell the
 * two apart: counting a guess as a ladder would let a custom product's «S» at
 * zero speak for a product whose rungs are «S» and «M», which is exactly the
 * hole it is there to close.
 */
function knownLadder(productId: string, owned: Map<string, string[]>): string[] | null {
  const own = owned.get(productId);
  if (own) return own;
  const v = VARIANTS[productId];
  if (v && v.sizes && v.sizes.length) return v.sizes;
  return BY_ID.has(productId) ? [""] : null;
}

/**
 * One saved ladder as the shelf needs it — the raw product_overrides.sizes
 * value in, size LABELS out — or null where there is no usable ladder.
 *
 * Exported because src/lib/orders.ts getOverrides() has these very rows in
 * hand already and passes the ladders it builds with this into stockStates(),
 * which saves the feed's hottest path a second read of the same table. One
 * function so the two can never disagree about what a saved ladder means.
 */
export function ladderLabels(sizes: unknown): string[] | null {
  let list: unknown = sizes;
  if (typeof list === "string") {
    /* Per row, not per table: one unparsable ladder must not cost every
       other product the one it saved. */
    try {
      list = JSON.parse(list);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(list) || !list.length) return null;
  const labels = list.map((x) => normVariant((x as { size?: unknown })?.size));
  /* One rung with no label is «один объём» — the product has no volumes at
     all and its shelf row is the unlabelled one, exactly as the storefront
     paints it (applyDemoOverrides in public/shop2/app.js) and exactly the
     rule overrideLadder() applies in src/lib/orders.ts. Any other ladder is
     taken rung for rung, unfiltered, so that the shelf's universe is the
     same list the cart and the till price against. */
  return labels.length === 1 && !labels[0] ? [""] : labels;
}

/** The owner's saved ladders, as the shelf needs them: id → size LABELS.
    Read here rather than through src/lib/orders.ts, which imports this file.
    Best effort: no table, no column, no change from before. */
async function ownerLadders(): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  try {
    const rows = await query<{ product_id: string; sizes: unknown }>(
      "select product_id, sizes from product_overrides where sizes is not null",
    );
    for (const r of rows) {
      const labels = ladderLabels(r.sizes);
      if (labels) out.set(r.product_id, labels);
    }
  } catch (err) {
    console.error("[inventory] saved size ladders unavailable, using the catalogue file:", err);
  }
  return out;
}

function catalogueUniverse(owned: Map<string, string[]>): Array<{ productId: string; variant: string }> {
  const out: Array<{ productId: string; variant: string }> = [];
  for (const p of CATALOGUE) {
    for (const size of ladderOf(p.id, owned)) out.push({ productId: p.id, variant: size });
  }
  return out;
}

/* product creation: the owner's own rows (src/lib/custom-products.ts) join
   the universe, so «Склад» and the editor's Остаток column can count them
   like any catalogue product. The ones switched OFF join it too, marked —
   getLevels() below says why a product taken out of the shop keeps its shelf
   row. Best effort — a missing table leaves the catalogue exactly as it was. */
type Universe = {
  rows: Array<{ productId: string; variant: string }>;
  byId: Map<string, MinProduct>;
  /** ids whose custom_products.active is false */
  offSale: Set<string>;
};
async function customUniverse(): Promise<Universe> {
  const out: Universe = { rows: [], byId: new Map(), offSale: new Set() };
  try {
    const { listCustomShelf } = await import("@/lib/custom-products");
    for (const { min, variants, active } of await listCustomShelf()) {
      out.byId.set(min.id, min);
      if (!active) out.offSale.add(min.id);
      if (variants && variants.sizes.length) {
        for (const size of variants.sizes) out.rows.push({ productId: min.id, variant: size });
      } else {
        out.rows.push({ productId: min.id, variant: "" });
      }
    }
  } catch (err) {
    console.error("[inventory] custom products not loaded:", err);
  }
  return out;
}

/** The catalogue ids the owner has switched off in the product editor
    (product_overrides.hidden, db/migrations/147_override_sizes_hidden.sql) —
    the other half of «не в продаже». A query of its own rather than a column
    on ownerLadders(): that one reads the rows that saved a size ladder, which
    a hidden product usually has not. Index-backed (147) and best effort, like
    every other read on this path — no answer means nothing is off sale, which
    is how the shelf behaved before the flag existed. */
async function hiddenIds(): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const rows = await query<{ product_id: string }>("select product_id from product_overrides where hidden");
    for (const r of rows) out.add(r.product_id);
  } catch (err) {
    console.error("[inventory] hidden switches unavailable, nothing counts as off sale:", err);
  }
  return out;
}

/**
 * Whether ONE product×variant is tracked — the same ledger test trackedKeys()
 * below makes for the whole table, for a caller about to write a counting
 * move on behalf of a sale that never touched the shelf (the return of a
 * cancelled or refunded order, src/lib/orders.ts setOrderStatus). A sale on
 * an uncounted variant is skipped by move(); its return has to be skipped
 * the same way, or the shelf gains a bottle nobody took, the variant turns
 * tracked at 1 and the shop starts saying «мало».
 */
export async function isTracked(productId: string, variant?: string | null): Promise<boolean> {
  const pid = String(productId ?? "").trim();
  if (!pid) return false;
  const rows = await query<{ n: string }>(
    `select count(*)::text as n from stock_moves where product_id = $1 and variant = $2 and reason in ${TRACKING_SQL}`,
    [pid, normVariant(variant)],
  );
  return rows.length > 0 && Number(rows[0].n) > 0;
}

/**
 * What one order still holds off the shelf on one line — the net of every move
 * ever written against its number, plus how many of them were returns.
 *
 * The question src/lib/orders.ts asks before it re-takes the stock of an order
 * whose cancellation was undone: `net < 0` means the goods are already off the
 * shelf (the sale stands), `net >= 0` with at least one 'return' move means
 * this order gave them back and they are there to take again, and no return at
 * all means the order never took anything — an unpaid invoice, or an untracked
 * variant whose sale move() skipped.
 *
 * That last case is the one that bites: an order cancelled before it was ever
 * paid returned nothing, and it is exactly the order that can still be paid
 * from a stale tab. applyPaymentResult() moves it to paid and decrements it
 * itself (src/lib/payments/apply.ts), so a decrement on the re-open as well
 * would take the quantity off the shelf twice. Per line and per variant rather
 * than per order: an order can have given back one of its lines and not the
 * other.
 */
export async function refLedger(
  ref: string,
  productId: string,
  variant?: string | null,
): Promise<{ net: number; returns: number }> {
  const r = cleanRef(ref);
  const pid = String(productId ?? "").trim();
  if (!r || !pid) return { net: 0, returns: 0 };
  const rows = await query<{ net: string | number; returns: string | number }>(
    `select coalesce(sum(delta), 0)::text as net,
            coalesce(sum(case when reason = 'return' then 1 else 0 end), 0)::text as returns
       from stock_moves where ref = $1 and product_id = $2 and variant = $3`,
    [r, pid, normVariant(variant)],
  );
  if (!rows.length) return { net: 0, returns: 0 };
  return { net: Number(rows[0].net) || 0, returns: Number(rows[0].returns) || 0 };
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
 *
 * …and, since it is the only screen that can correct one, every stock_levels
 * row that falls OUTSIDE that universe as well: the leftover of a volume
 * renamed or removed in the product editor. Such a row is still counted by
 * productStockStates(), so an orphan at 5 kept a product reading «в наличии»
 * while every volume it really has sat at zero — and there was no screen on
 * which it could be found, let alone written off.
 *
 * …and the products that are OFF SALE, both kinds of them. A catalogue
 * product hidden in the editor (product_overrides.hidden) always kept its row
 * here; one of the owner's OWN products switched off (custom_products.active)
 * used to drop out of the universe altogether, and the rescue loop below could
 * not save it either — that loop only reaches a variant of a product some
 * OTHER variant of which is listed, and a switched-off product has none. So
 * its count, its «мало» threshold and its barcode disappeared from the one
 * screen that can correct them, and from the register's barcode index, while
 * byEan() went on finding the very same code. Two switches that both mean
 * «не в продаже» behaved differently for no reason anyone had written down.
 * Both kinds stay now, flagged `offSale`, so «Склад» badges them «Скрыт»
 * exactly as «Каталог» already does.
 *
 * What off sale DOES mean here is that the row stops asking to be restocked:
 * it is out of the «Мало» and «Нет» filters, out of lowStockSummary() — the
 * assistant's low-stock context and the «Склад» tab's own badge — and last in
 * the sort. Reordering a product the owner has taken out of the shop is not
 * work he has to do, and before the flag there was no way for him to say so
 * short of putting the product back on sale.
 */
export async function getLevels(opts: { q?: string; filter?: LevelFilter; limit?: number } = {}): Promise<CatalogueLevelRow[]> {
  const [dbRows, tracked, custom, owned, hidden] = await Promise.all([
    query<StockLevelRow>("select * from stock_levels"),
    trackedKeys(),
    customUniverse(),
    ownerLadders(),
    hiddenIds(),
  ]);
  const universe = catalogueUniverse(owned).concat(custom.rows);

  /* A volume the owner RENAMED leaves its old row behind with a real count on
     it. That row is not in the universe above any more, and dropping it here
     would hide goods that are on the shelf — and leave it counted by
     productStockStates(), holding a sold-out product at «в наличии» from a
     screen on which it could not be found, let alone written off. So a level
     the database already holds for a product the shop still has gets a row of
     its own too, for Renat to move across and zero. A row whose product has
     left the catalogue altogether stays out: there is no name, no price and no
     shelf to put it on. */
  const listed = new Map<string, Set<string>>();
  for (const u of universe) {
    const seen = listed.get(u.productId);
    if (seen) seen.add(u.variant);
    else listed.set(u.productId, new Set([u.variant]));
  }
  for (const r of dbRows) {
    const seen = listed.get(r.product_id);
    if (!seen || seen.has(r.variant)) continue;
    seen.add(r.variant);
    universe.push({ productId: r.product_id, variant: r.variant });
  }
  const byKey = new Map(dbRows.map((r) => [r.product_id + "\u0000" + r.variant, r]));

  let rows: CatalogueLevelRow[] = universe.map(({ productId, variant }) => {
    const key = productId + "\u0000" + variant;
    const row = byKey.get(key);
    const p = BY_ID.get(productId) ?? custom.byId.get(productId);
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
      offSale: hidden.has(productId) || custom.offSale.has(productId),
      updatedAt: row?.updated_at ? new Date(row.updated_at as string).toISOString() : null,
    };
  });

  const q = (opts.q ?? "").trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) => (r.brand + " " + r.name + " " + r.productId + " " + (r.ean || "")).toLowerCase().includes(q));
  }
  /* «Мало» and «Нет» are the list of what has to be reordered, so a product
     that is not for sale is not on it — see the off-sale paragraph above.
     «Не учтено» is a different question («which shelves has nobody counted»),
     and one asked about a hidden product just as much as about a live one. */
  if (opts.filter === "low") rows = rows.filter((r) => r.tracked && !r.offSale && r.state === "low");
  else if (opts.filter === "out") rows = rows.filter((r) => r.tracked && !r.offSale && r.state === "out");
  else if (opts.filter === "untracked") rows = rows.filter((r) => !r.tracked);

  const rank = (r: CatalogueLevelRow) =>
    r.offSale ? 3 : !r.tracked ? 1 : r.state === "out" ? 0 : r.state === "low" ? 0.5 : 2;
  rows.sort((a, b) => rank(a) - rank(b) || (a.brand + a.name).localeCompare(b.brand + b.name, "ru"));

  const limit = Math.min(Math.max(Number(opts.limit) || 500, 1), 1000);
  return rows.slice(0, limit);
}

/** Tracked, on sale and not «в наличии» — the assistant's low-stock context
    and the admin's own summary. `offSale` is the whole point of the filter:
    this is the «what do I have to reorder» list, and a product the owner has
    switched off in the shop is not on it (see getLevels above). */
export async function lowStockSummary(limit = 15): Promise<CatalogueLevelRow[]> {
  const rows = await getLevels({ filter: "all" });
  return rows.filter((r) => r.tracked && !r.offSale && r.state !== "in").slice(0, limit);
}

/* ---------- the ledger ----------------------------------------------------- */

export type MoveRow = {
  id: number;
  at: string;
  productId: string;
  variant: string;
  delta: number;
  reason: LedgerReason;
  ref: string | null;
  actor: string | null;
  brand: string;
  name: string;
};

export async function listMoves(
  opts: { productId?: string; reason?: LedgerReason; since?: string; limit?: number } = {},
): Promise<MoveRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.productId) {
    params.push(opts.productId);
    where.push(`product_id = $${params.length}`);
  }
  if (opts.reason && (LEDGER_REASONS as readonly string[]).includes(opts.reason)) {
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
    reason: LedgerReason;
    ref: string | null;
    actor: string | null;
  }>(
    `select id, at, product_id, variant, delta, reason, ref, actor from stock_moves
     ${where.length ? "where " + where.join(" and ") : ""}
     order by at desc, id desc limit $${params.length}`,
    params,
  );
  /* The owner's own products are rows in a table, not entries in the
     catalogue file, so BY_ID alone printed «c-kevin-murphy-beard-balm» where
     the history is supposed to say what was received or sold. One lookup for
     the whole page, best effort. */
  const own = await customNames(rows.map((r) => r.product_id));
  return rows.map((r) => {
    const p = BY_ID.get(r.product_id);
    const mine = own.get(r.product_id);
    return {
      id: Number(r.id),
      at: new Date(r.at as string).toISOString(),
      productId: r.product_id,
      variant: r.variant,
      delta: r.delta,
      reason: r.reason,
      ref: r.ref,
      actor: r.actor,
      brand: p?.b ?? mine?.b ?? "",
      name: p?.n ?? mine?.n ?? r.product_id,
    };
  });
}

/** brand/name for whichever of these ids are the owner's own products. */
async function customNames(ids: string[]): Promise<Map<string, MinProduct>> {
  const out = new Map<string, MinProduct>();
  const want = [...new Set(ids.filter((id) => !BY_ID.has(id)))];
  if (!want.length) return out;
  try {
    const { customMinByIds } = await import("@/lib/custom-products");
    for (const [id, m] of await customMinByIds(want)) out.set(id, m.min);
  } catch (err) {
    console.error("[inventory] custom product names not loaded:", err);
  }
  return out;
}

/* `todaysMoves(limit)` — listMoves() with `since` set to UTC midnight — had no
   caller: the panel's «Движения» list asks for the last N moves, not today's.
   Removed 07.09.2026 (docs/audit/2026-09-07-cleanup.md); it was one call to
   listMoves() and is in git at 448cbd7. */
