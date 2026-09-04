/**
 * Наборы («sets») — the curated bundles, now owned by the database.
 *
 * Storage: db/migrations/120_bundles.sql (`bundles`), seeded with exactly the
 * sets tools/bundles.config.mjs used to generate, ids and prices included, so
 * every bookmark, cart line and paid order keeps pointing at the same thing.
 *
 * Who calls what
 *   · listBundles({activeOnly})        — GET /api/bundles/ (public, active
 *     only) and GET /api/admin/bundles/ (everything, for the panel).
 *   · getBundle(id)                    — one set, active or not.
 *   · validateBundle(raw)              — the one door every write goes
 *     through: the admin route and, later, anything else that writes a set.
 *   · upsertBundle / deleteBundle / setBundleActive / reorderBundles
 *   · bundleDefsForOrders()            — src/lib/orders.ts prices «bundle:<id>»
 *     lines from THIS, never from the browser's number.
 *
 * A set is not a catalogue product: it has its own id space, one fixed price
 * and it carries the real products it is made of. Everything derived — what
 * one part costs, what the parts cost together, whether the set can be sold
 * at all — is computed here from the catalogue plus the owner's overrides, so
 * a price change on a shampoo moves the «было» price of every set holding it
 * without anybody re-saving the set.
 *
 * The static twins (public/shop/bundles.js, src/data/bundles.json) are not
 * deleted: they are the offline fallback for a shop running with no database
 * at all, and what tools/prerender-shop2.mjs still builds the /sets/ pages
 * from at build time.
 */
import catalogueMin from "@/data/catalogue.min.json";
import variantData from "@/data/catalogue.variants.json";
import { query } from "@/lib/db";
import { getOverrides, type Override, type StockState } from "@/lib/orders";

/* ---------- shapes ------------------------------------------------------- */

/** What the owner stores: a product, which of its volumes, how many. */
export type BundleItemIn = {
  productId: string;
  /** Index of the volume in that product's own size list. 0 = the first one. */
  variant: number;
  qty: number;
};

/** What a reader gets: the stored item plus everything computed from the catalogue. */
export type BundleItemOut = BundleItemIn & {
  /** `id`/`size` mirror the field names public/shop/bundles.js has always
      used, so app.js renders a set from the API and from the static file with
      the same code. */
  id: string;
  size: number;
  brand: string;
  name: string;
  sizeLabel: string;
  price: number;
  stock: StockState;
};

export type BundleInput = {
  id: string;
  cat: string;
  title: { RU: string; ET: string; EN: string };
  desc: { RU: string; ET: string; EN: string };
  items: BundleItemIn[];
  /** The set price. null = compute it from `discountPct`. */
  price: number | null;
  discountPct: number | null;
  /** A product id or a URL; null = the shop stacks the first three item photos. */
  image: string | null;
  active: boolean;
  sort: number;
};

export type Bundle = BundleInput & {
  items: BundleItemOut[];
  /** What the parts cost bought separately. */
  sum: number;
  /** What the set costs — always a number, even when the row stores a percent. */
  price: number;
  save: number;
  pct: number;
  stock: StockState;
  createdAt: string;
  updatedAt: string;
};

export type BundleError =
  | "bad_id"
  | "bad_cat"
  | "bad_name"
  | "bad_desc"
  | "few_items"
  | "too_many_items"
  | "unknown_product"
  | "dup_item"
  | "bad_variant"
  | "bad_qty"
  | "bad_price"
  | "price_too_high"
  | "bad_discount"
  | "bad_image"
  | "bad_sort";

/** At least two products, or it is not a set — it is a product with extra steps. */
export const BUNDLE_MIN_ITEMS = 2;
export const BUNDLE_MAX_ITEMS = 8;
export const BUNDLE_MAX_QTY = 20;
export const BUNDLE_CATS = ["hair", "styling", "beard", "face", "body", "perfume", "merch"] as const;

/* ---------- the catalogue, server side ----------------------------------- */

type MinProduct = { id: string; b: string; n: string; c: string; p: number; s?: string };
type Variant = { sizes: string[]; prices: number[] };

const CATALOGUE = catalogueMin as unknown as MinProduct[];
const BY_ID = new Map<string, MinProduct>(CATALOGUE.map((p) => [p.id, p]));
const VARIANTS = variantData as unknown as Record<string, Variant>;

const money = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v: unknown, fallback = 0) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
};

/** The price and the label of one product at one size index. */
function variantOf(productId: string, index: number): { label: string; price: number | null } {
  const v = VARIANTS[productId];
  if (!v || !v.sizes?.length) return { label: "", price: null };
  const i = index >= 0 && index < v.sizes.length ? index : 0;
  const price = num(v.prices?.[i], NaN);
  return { label: v.sizes[i], price: Number.isFinite(price) ? price : null };
}

/** in < low < out — the worst part decides what the whole set can promise. */
function worstStock(list: StockState[]): StockState {
  if (list.includes("out")) return "out";
  if (list.includes("low")) return "low";
  return "in";
}

/* ---------- rows --------------------------------------------------------- */

type BundleRow = {
  id: string;
  cat: string;
  name_ru: string;
  name_et: string | null;
  name_en: string | null;
  desc_ru: string | null;
  desc_et: string | null;
  desc_en: string | null;
  items: unknown;
  price: string | number | null;
  discount_pct: string | number | null;
  image: string | null;
  active: boolean;
  sort: number | string;
  created_at: Date | string;
  updated_at: Date | string;
};

const COLS =
  "id, cat, name_ru, name_et, name_en, desc_ru, desc_et, desc_en, items, price, discount_pct, image, active, sort, created_at, updated_at";

const iso = (v: Date | string | null) => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));

/** jsonb comes back parsed on `pg` and on PGlite; a text column would not. */
function parseItems(raw: unknown): BundleItemIn[] {
  const list = typeof raw === "string" ? safeJson(raw) : raw;
  if (!Array.isArray(list)) return [];
  const out: BundleItemIn[] = [];
  for (const it of list) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const productId = String(o.productId ?? o.id ?? "").trim();
    if (!productId) continue;
    out.push({
      productId,
      variant: Math.max(0, Math.trunc(num(o.variant ?? o.size, 0))),
      qty: Math.max(1, Math.trunc(num(o.qty, 1))),
    });
  }
  return out;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * A stored row + the live catalogue → what a reader sees.
 *
 * `overrides` is the owner's per-product edits (price, stock). Passing them in
 * rather than fetching per set keeps listBundles() to one extra query for the
 * whole page.
 */
function expand(row: BundleRow, overrides: Record<string, Override>): Bundle {
  const stored = parseItems(row.items);
  const items: BundleItemOut[] = [];
  for (const it of stored) {
    const p = BY_ID.get(it.productId);
    const v = variantOf(it.productId, it.variant);
    const base = v.price != null ? v.price : p ? num(p.p) : 0;
    const o = overrides[it.productId];
    /* A per-product price override is set on the base volume, so it moves the
       other volumes by the same premium — exactly what the storefront's own
       proPrice()/sizePrice() pair does, and what the goods editor promises. */
    const premium = v.price != null && p ? v.price - num(p.p) : 0;
    const unit = o?.price != null ? money(num(o.price) + premium) : money(base);
    items.push({
      productId: it.productId,
      id: it.productId,
      variant: it.variant,
      size: it.variant,
      qty: it.qty,
      brand: p?.b ?? "",
      name: p?.n ?? it.productId,
      sizeLabel: v.label,
      price: unit,
      stock: (o?.stock ?? (p?.s as StockState | undefined) ?? "in") as StockState,
    });
  }

  const sum = money(items.reduce((a, it) => a + it.price * it.qty, 0));
  const discountPct = row.discount_pct == null ? null : money(num(row.discount_pct));
  const stored_price = row.price == null ? null : money(num(row.price));
  const price =
    stored_price != null ? stored_price : discountPct != null ? money(sum * (1 - discountPct / 100)) : sum;
  const save = money(Math.max(0, sum - price));

  return {
    id: row.id,
    cat: row.cat || "body",
    title: { RU: row.name_ru || row.id, ET: row.name_et || "", EN: row.name_en || "" },
    desc: { RU: row.desc_ru || "", ET: row.desc_et || "", EN: row.desc_en || "" },
    items,
    price,
    discountPct,
    sum,
    save,
    pct: sum > 0 ? Math.round((save / sum) * 100) : 0,
    stock: items.length ? worstStock(items.map((it) => it.stock)) : "out",
    image: row.image || null,
    active: row.active !== false,
    sort: Math.trunc(num(row.sort)),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/* ---------- read --------------------------------------------------------- */

export async function listBundles(opts: { activeOnly?: boolean } = {}): Promise<Bundle[]> {
  const rows = await query<BundleRow>(
    `select ${COLS} from bundles ${opts.activeOnly ? "where active" : ""} order by sort, id`,
  );
  if (!rows.length) return [];
  const overrides = await getOverrides(productIdsOf(rows));
  return rows.map((r) => expand(r, overrides));
}

export async function getBundle(id: string): Promise<Bundle | null> {
  const rows = await query<BundleRow>(`select ${COLS} from bundles where id = $1`, [String(id ?? "")]);
  if (!rows.length) return null;
  const overrides = await getOverrides(productIdsOf(rows));
  return expand(rows[0], overrides);
}

function productIdsOf(rows: BundleRow[]): string[] {
  const ids = new Set<string>();
  for (const r of rows) for (const it of parseItems(r.items)) ids.add(it.productId);
  return [...ids];
}

/**
 * What src/lib/orders.ts prices a «bundle:<id>» line from.
 *
 * Deliberately NOT active-only: a set the owner switched off (or hid with the
 * «Наборы на сайте» switch) is gone from the shop, but a customer who already
 * has it in the cart must still be able to pay for the order in front of
 * them. Only a *deleted* set stops being sellable — `bundle_unknown`.
 */
export async function bundleDefsForOrders(): Promise<
  Record<string, { id: string; title: Record<string, string>; price: number; items: BundleItemIn[]; stock: StockState }>
> {
  const list = await listBundles();
  const out: Record<
    string,
    { id: string; title: Record<string, string>; price: number; items: BundleItemIn[]; stock: StockState }
  > = {};
  for (const b of list) {
    out[b.id] = {
      id: b.id,
      title: { RU: b.title.RU, ET: b.title.ET || b.title.RU, EN: b.title.EN || b.title.RU },
      price: b.price,
      items: b.items.map((it) => ({ productId: it.productId, variant: it.variant, qty: it.qty })),
      stock: b.stock,
    };
  }
  return out;
}

/* ---------- validate ----------------------------------------------------- */

const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;
const MAX_NAME = 120;
const MAX_DESC = 1000;

/** Control characters out (a pasted description carries them), then capped. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/g;
function text(v: unknown, max: number): string {
  return String(v ?? "").replace(CONTROL, " ").trim().slice(0, max);
}

/**
 * The only door a write goes through. Returns a clear code rather than a
 * sentence: the admin panel and the tests both map it to their own words.
 *
 * `sum` — what the parts cost separately — is computed here so the caller can
 * tell the owner «дешевле по отдельности» before anything is stored.
 */
export function validateBundle(
  raw: unknown,
  overrides: Record<string, Override> = {},
): { ok: true; value: BundleInput; sum: number; price: number } | { ok: false; error: BundleError } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "bad_id" };
  const b = raw as Record<string, unknown>;

  const id = String(b.id ?? "").trim().toLowerCase();
  if (!SLUG.test(id)) return { ok: false, error: "bad_id" };

  const cat = String(b.cat ?? "body").trim().toLowerCase();
  if (!(BUNDLE_CATS as readonly string[]).includes(cat)) return { ok: false, error: "bad_cat" };

  const titleRaw = (b.title ?? b.name ?? {}) as Record<string, unknown>;
  const descRaw = (b.desc ?? b.description ?? {}) as Record<string, unknown>;
  const title = {
    RU: text(titleRaw.RU, MAX_NAME),
    ET: text(titleRaw.ET, MAX_NAME),
    EN: text(titleRaw.EN, MAX_NAME),
  };
  if (!title.RU) return { ok: false, error: "bad_name" };
  const desc = {
    RU: text(descRaw.RU, MAX_DESC),
    ET: text(descRaw.ET, MAX_DESC),
    EN: text(descRaw.EN, MAX_DESC),
  };
  if (descRaw && (descRaw.ET || descRaw.EN) && !desc.RU) return { ok: false, error: "bad_desc" };

  const itemsRaw = Array.isArray(b.items) ? b.items : null;
  if (!itemsRaw) return { ok: false, error: "few_items" };
  if (itemsRaw.length < BUNDLE_MIN_ITEMS) return { ok: false, error: "few_items" };
  if (itemsRaw.length > BUNDLE_MAX_ITEMS) return { ok: false, error: "too_many_items" };

  const items: BundleItemIn[] = [];
  const seen = new Set<string>();
  let sum = 0;
  for (const rawItem of itemsRaw) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return { ok: false, error: "unknown_product" };
    const it = rawItem as Record<string, unknown>;
    const productId = String(it.productId ?? it.id ?? "").trim();
    const p = BY_ID.get(productId);
    if (!p) return { ok: false, error: "unknown_product" };

    /* Absent means «the first volume, one of it». Present but unreadable is a
       mistake, not a default: silently storing qty 1 for a field that said
       "abc" is how a set ends up selling something nobody meant to sell. */
    const rawVariant = it.variant ?? it.size;
    const variant = Math.trunc(rawVariant == null || rawVariant === "" ? 0 : num(rawVariant, NaN));
    const sizes = VARIANTS[productId]?.sizes ?? [];
    if (!Number.isFinite(variant) || variant < 0 || (variant > 0 && variant >= sizes.length)) {
      return { ok: false, error: "bad_variant" };
    }

    const qty = Math.trunc(it.qty == null || it.qty === "" ? 1 : num(it.qty, NaN));
    if (!Number.isFinite(qty) || qty < 1 || qty > BUNDLE_MAX_QTY) return { ok: false, error: "bad_qty" };

    const key = productId + ":" + variant;
    if (seen.has(key)) return { ok: false, error: "dup_item" };
    seen.add(key);

    const v = variantOf(productId, variant);
    const base = v.price != null ? v.price : num(p.p);
    const premium = v.price != null ? v.price - num(p.p) : 0;
    const o = overrides[productId];
    sum += (o?.price != null ? money(num(o.price) + premium) : money(base)) * qty;
    items.push({ productId, variant, qty });
  }
  sum = money(sum);

  /* Price or percent, never both halves of a contradiction: a number in the
     price box wins and the percent is dropped, which is also how the admin's
     own form behaves. */
  let price: number | null = null;
  let discountPct: number | null = null;
  if (b.price != null && String(b.price).trim() !== "") {
    const n = num(b.price, NaN);
    if (!Number.isFinite(n) || n < 0 || n > 100000) return { ok: false, error: "bad_price" };
    price = money(n);
  } else if (b.discountPct != null && String(b.discountPct).trim() !== "") {
    const n = num(b.discountPct, NaN);
    if (!Number.isFinite(n) || n < 0 || n > 90) return { ok: false, error: "bad_discount" };
    discountPct = money(n);
  }
  const effective = price != null ? price : discountPct != null ? money(sum * (1 - discountPct / 100)) : sum;
  /* A set that costs the same as (or more than) its parts is not a set. This
     is the one rule the owner is most likely to trip over, so it has its own
     code and its own sentence in the panel. */
  if (effective >= sum) return { ok: false, error: "price_too_high" };

  const imageRaw = text(b.image, 400);
  if (imageRaw && !BY_ID.has(imageRaw) && !/^(https?:)?\/\/|^\//.test(imageRaw)) {
    return { ok: false, error: "bad_image" };
  }

  const sort = Math.trunc(num(b.sort, 0));
  if (!Number.isFinite(sort) || sort < 0 || sort > 100000) return { ok: false, error: "bad_sort" };

  return {
    ok: true,
    sum,
    price: effective,
    value: {
      id,
      cat,
      title,
      desc,
      items,
      price,
      discountPct,
      image: imageRaw || null,
      active: b.active !== false,
      sort,
    },
  };
}

/* ---------- write -------------------------------------------------------- */

export async function upsertBundle(v: BundleInput): Promise<Bundle> {
  await query(
    `insert into bundles
       (id, cat, name_ru, name_et, name_en, desc_ru, desc_et, desc_en, items, price, discount_pct, image, active, sort, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14, now())
     on conflict (id) do update set
       cat = excluded.cat,
       name_ru = excluded.name_ru, name_et = excluded.name_et, name_en = excluded.name_en,
       desc_ru = excluded.desc_ru, desc_et = excluded.desc_et, desc_en = excluded.desc_en,
       items = excluded.items, price = excluded.price, discount_pct = excluded.discount_pct,
       image = excluded.image, active = excluded.active, sort = excluded.sort,
       updated_at = now()`,
    [
      v.id,
      v.cat,
      v.title.RU,
      v.title.ET || null,
      v.title.EN || null,
      v.desc.RU || null,
      v.desc.ET || null,
      v.desc.EN || null,
      JSON.stringify(v.items),
      v.price,
      v.discountPct,
      v.image,
      v.active,
      v.sort,
    ],
  );
  return (await getBundle(v.id)) as Bundle;
}

/** Returns the set that was removed, or null when there was nothing to remove. */
export async function deleteBundle(id: string): Promise<Bundle | null> {
  const before = await getBundle(id);
  if (!before) return null;
  await query("delete from bundles where id = $1", [before.id]);
  return before;
}

export async function setBundleActive(id: string, active: boolean): Promise<Bundle | null> {
  const rows = await query<{ id: string }>(
    "update bundles set active = $2, updated_at = now() where id = $1 returning id",
    [String(id ?? ""), !!active],
  );
  if (!rows.length) return null;
  return getBundle(rows[0].id);
}

/**
 * `ids` in the order the owner wants them. Anything not named keeps its place
 * behind them, so a stale list from a panel that has not reloaded cannot
 * shuffle sets it does not know about.
 */
export async function reorderBundles(ids: string[]): Promise<Bundle[]> {
  const clean = [...new Set(ids.map((s) => String(s ?? "").trim()).filter(Boolean))].slice(0, 200);
  for (let i = 0; i < clean.length; i++) {
    await query("update bundles set sort = $2, updated_at = now() where id = $1", [clean[i], (i + 1) * 10]);
  }
  return listBundles();
}
