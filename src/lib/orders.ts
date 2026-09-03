/**
 * Orders — and the money maths behind them.
 *
 * The rule the whole file exists for: **prices come from the server, never
 * from the browser.** The client sends product ids, a variant and a quantity;
 * every euro is recomputed here from src/data/catalogue.min.json (base price),
 * src/data/catalogue.variants.json (per-size price) and the product_overrides
 * table (what the owner changed in the admin). A tampered cart cannot make an
 * order cheaper — it can only fail.
 *
 * Optional neighbours, each owned by another agent and each loaded only if the
 * file exists (the import is resolved at run time and a miss is swallowed):
 *   src/lib/shipping.ts   computeShipping({country, method, subtotal})
 *   src/lib/giftcards.ts  applyGiftCard(code, total)
 *   src/lib/mail-hooks.ts onOrderCreated(order)
 *   src/data/bundles.json bundle definitions for items with id "bundle:<id>"
 * Without them the order still goes through: a flat shipping table, no
 * discount, no mail, and bundle lines are rejected with `bundle_unknown`.
 */
import catalogueMin from "@/data/catalogue.min.json";
import variantData from "@/data/catalogue.variants.json";
import { query } from "@/lib/db";

/* ---------- types -------------------------------------------------------- */

export const ORDER_STATUSES = ["new", "paid", "failed", "shipped", "cancelled", "refunded"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type StockState = "in" | "low" | "out";

export type OrderItem = {
  id: string;
  kind: "product" | "bundle" | "gift";
  title: string;
  /** Gift-card lines: recipient {name, email, message, from} typed at checkout. */
  meta?: Record<string, unknown> | null;
  brand?: string;
  variant?: string | null;
  qty: number;
  price: number; // per unit, as charged
  sum: number; // price × qty
};

/**
 * Every field here is rendered in the admin panel, so every field here is
 * whitelisted and capped by cleanShipping() before it is stored — see the
 * comment there. `method` is one of three words, never the shopper's text.
 */
export type OrderShipping = {
  method: string;
  country: string;
  /** Parcel-machine operator: omniva | smartpost | dpd | venipak. */
  carrier?: string | null;
  pointId?: string | null;
  pointName?: string | null;
  address?: Record<string, unknown> | null;
  price: number;
};

export type Order = {
  id: string;
  number: string;
  status: OrderStatus;
  lang: string;
  currency: string;
  email: string;
  phone: string;
  name: string;
  shipping: OrderShipping;
  items: OrderItem[];
  subtotal: number;
  shippingPrice: number;
  discount: number;
  discountCode: string | null;
  total: number;
  payment: Record<string, unknown> | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateOrderInput = {
  lang?: string;
  items: Array<{ id: string; variant?: string | number | null; qty: number; meta?: Record<string, unknown> | null }>;
  customer: { name?: string; email?: string; phone?: string };
  shipping: {
    method?: string;
    country?: string;
    carrier?: string | null;
    pointId?: string | null;
    pointName?: string | null;
    address?: Record<string, unknown> | null;
  };
  discountCode?: string | null;
  notes?: string | null;
};

/** Every failure the caller can report to the shopper by code. */
export class OrderError extends Error {
  code: string;
  detail?: string;
  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
  }
}

export type OverrideRow = {
  product_id: string;
  price: string | number | null;
  stock: StockState | null;
  seo_title: string | null;
  seo_desc: string | null;
  subcat: string | null;
  var_img: unknown;
  video_url: string | null;
  gallery: unknown;
  updated_at: string | Date;
};

/** One photo the owner uploaded — see db/migrations/003_product_gallery.sql. */
export type GalleryPhoto = { url: string; thumb: string; alt: string };

export type Override = {
  price: number | null;
  stock: StockState | null;
  seoTitle: string | null;
  seoDesc: string | null;
  subcat: string | null;
  varImg: number[] | null;
  videoUrl: string | null;
  /** null = the catalogue's own photos; an array replaces them, first = main. */
  gallery: GalleryPhoto[] | null;
  updatedAt: string | null;
};

/** Up to a dozen photos per product; more is a mistake, not a gallery. */
export const MAX_GALLERY = 12;

/**
 * The only door into `gallery`. Anything that is not a {url, thumb, alt} with
 * an http(s) or /-rooted url is dropped, because this list is rendered as an
 * image source on every product card in the shop.
 */
export function cleanGallery(value: unknown): GalleryPhoto[] | null {
  if (value == null) return null;
  const raw = typeof value === "string" ? safeParse(value) : value;
  if (!Array.isArray(raw)) return null;
  const out: GalleryPhoto[] = [];
  for (const item of raw) {
    const o = (item && typeof item === "object" ? item : { url: item }) as Record<string, unknown>;
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (!url || url.length > 500 || !/^(https:\/\/|http:\/\/|\/)[^\s"'<>]+$/.test(url)) continue;
    const thumb = typeof o.thumb === "string" && /^(https?:\/\/|\/)[^\s"'<>]+$/.test(o.thumb.trim())
      ? o.thumb.trim().slice(0, 500)
      : url;
    out.push({ url, thumb, alt: typeof o.alt === "string" ? o.alt.slice(0, 120) : "" });
    if (out.length >= MAX_GALLERY) break;
  }
  return out.length ? out : null;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* ---------- catalogue ---------------------------------------------------- */

type MinProduct = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as MinProduct[];
const VARIANTS = variantData as Record<string, { sizes: string[]; prices: number[] }>;

const BY_ID = new Map<string, MinProduct>(CATALOGUE.map((p) => [p.id, p]));

/** Money is kept honest in cents; floats only ever leave, never accumulate. */
function money(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

/* ---------- optional neighbours ------------------------------------------ */

/*
 * Loaded at call time, not at import time, and always through a try/catch: a
 * neighbour that is missing, half-written or throwing must not be able to stop
 * an order. The exports are read loosely (fn() below) so a signature change on
 * the other side degrades to the fallback instead of a crash.
 */
type AnyModule = Record<string, unknown>;

async function optionalLib(name: "shipping" | "giftcards" | "mail-hooks"): Promise<AnyModule | null> {
  try {
    if (name === "shipping") return (await import("@/lib/shipping")) as unknown as AnyModule;
    if (name === "giftcards") return (await import("@/lib/giftcards")) as unknown as AnyModule;
    return (await import("@/lib/mail-hooks")) as unknown as AnyModule;
  } catch (err) {
    console.error(`[orders] optional module ${name} not loaded:`, err);
    return null;
  }
}

async function optionalData(name: "bundles.json"): Promise<AnyModule | null> {
  try {
    if (name === "bundles.json") return (await import("@/data/bundles.json")) as unknown as AnyModule;
    return null;
  } catch {
    return null;
  }
}

function fn(mod: AnyModule | null, key: string): ((...args: unknown[]) => unknown) | null {
  if (!mod) return null;
  const direct = mod[key];
  if (typeof direct === "function") return direct as (...args: unknown[]) => unknown;
  const def = mod.default as AnyModule | undefined;
  if (def && typeof def[key] === "function") return def[key] as (...args: unknown[]) => unknown;
  return null;
}

/* ---------- shipping ----------------------------------------------------- */

/** Fallback tariffs, live only until src/lib/shipping.ts exists. */
export const FALLBACK_SHIPPING = { parcelEE: 3.49, courierEE: 5.99, eu: 9.9, freeFrom: 59 };

export function fallbackShipping(country: string, method: string, subtotal: number): number {
  const m = String(method || "").toLowerCase();
  const c = String(country || "EE").toUpperCase();
  if (/pickup|самовывоз|ise|tule|store/.test(m)) return 0;
  if (subtotal >= FALLBACK_SHIPPING.freeFrom) return 0;
  if (c === "EE") return /courier|kuller|курьер|door/.test(m) ? FALLBACK_SHIPPING.courierEE : FALLBACK_SHIPPING.parcelEE;
  return FALLBACK_SHIPPING.eu;
}

async function shippingPrice(
  country: string,
  method: string,
  subtotal: number,
  carrier?: string | null,
): Promise<number> {
  const compute = fn(await optionalLib("shipping"), "computeShipping");
  if (compute) {
    try {
      // carrier lets settings.shipping_rules.carriers override the method price
      const out = await compute({ country, method, subtotal, carrier: carrier ?? undefined });
      const price = typeof out === "number" ? out : num((out as { price?: unknown } | null)?.price, NaN);
      if (Number.isFinite(price) && price >= 0) return money(price);
    } catch (err) {
      console.error("[orders] computeShipping failed, using the fallback table:", err);
    }
  }
  return money(fallbackShipping(country, method, subtotal));
}

/* ---------- discount ----------------------------------------------------- */

/**
 * Gift cards are the features agent's. Whatever shape applyGiftCard returns —
 * a number, {discount}, {amount} or the new {total} — it comes out of here as
 * a discount in euro, clamped to the order.
 */
async function discountFor(code: string | null | undefined, total: number): Promise<number> {
  if (!code) return 0;
  const apply = fn(await optionalLib("giftcards"), "applyGiftCard");
  if (!apply) return 0;
  try {
    const out = await apply(code, total);
    let discount = 0;
    if (typeof out === "number") discount = out;
    else if (out && typeof out === "object") {
      const o = out as Record<string, unknown>;
      if (o.ok === false) return 0;
      if (o.discount != null) discount = num(o.discount);
      else if (o.amount != null) discount = num(o.amount);
      else if (o.value != null) discount = num(o.value);
      else if (o.total != null) discount = total - num(o.total);
    }
    if (!Number.isFinite(discount) || discount <= 0) return 0;
    return money(Math.min(discount, total));
  } catch (err) {
    console.error("[orders] applyGiftCard failed, order priced without a discount:", err);
    return 0;
  }
}

/* ---------- overrides & settings ----------------------------------------- */

function mapOverride(r: OverrideRow): Override {
  return {
    price: r.price == null ? null : money(num(r.price)),
    stock: r.stock ?? null,
    seoTitle: r.seo_title ?? null,
    seoDesc: r.seo_desc ?? null,
    subcat: r.subcat ?? null,
    varImg: Array.isArray(r.var_img) ? (r.var_img as number[]) : null,
    videoUrl: r.video_url ?? null,
    gallery: cleanGallery(r.gallery),
    updatedAt: r.updated_at ? new Date(r.updated_at as string).toISOString() : null,
  };
}

/** Every override, or just the ones for the given product ids. */
export async function getOverrides(ids?: string[]): Promise<Record<string, Override>> {
  let rows: OverrideRow[];
  if (ids && ids.length) {
    const holes = ids.map((_, i) => `$${i + 1}`).join(",");
    rows = await query<OverrideRow>(`select * from product_overrides where product_id in (${holes})`, ids);
  } else {
    rows = await query<OverrideRow>("select * from product_overrides");
  }
  const out: Record<string, Override> = {};
  for (const r of rows) out[r.product_id] = mapOverride(r);
  return out;
}

/** Partial upsert: only the keys present are touched, null clears one. */
export async function upsertOverride(productId: string, patch: Partial<Override>): Promise<Override> {
  const cols: Record<string, unknown> = {};
  if ("price" in patch) cols.price = patch.price == null ? null : money(num(patch.price));
  if ("stock" in patch) cols.stock = patch.stock ?? null;
  if ("seoTitle" in patch) cols.seo_title = patch.seoTitle ?? null;
  if ("seoDesc" in patch) cols.seo_desc = patch.seoDesc ?? null;
  if ("subcat" in patch) cols.subcat = patch.subcat ?? null;
  if ("varImg" in patch) cols.var_img = patch.varImg == null ? null : JSON.stringify(patch.varImg);
  if ("videoUrl" in patch) cols.video_url = patch.videoUrl ?? null;
  if ("gallery" in patch) {
    const list = cleanGallery(patch.gallery);
    cols.gallery = list == null ? null : JSON.stringify(list);
  }

  if (cols.stock != null && !["in", "low", "out"].includes(String(cols.stock))) {
    throw new OrderError("bad_stock", String(cols.stock));
  }

  const keys = Object.keys(cols);
  const params: unknown[] = [productId, ...keys.map((k) => cols[k])];
  const JSONB = new Set(["var_img", "gallery"]);
  const holes = keys.map((k, i) => (JSONB.has(k) ? `$${i + 2}::jsonb` : `$${i + 2}`));
  const sql = keys.length
    ? `insert into product_overrides (product_id, ${keys.join(", ")}, updated_at)
       values ($1, ${holes.join(", ")}, now())
       on conflict (product_id) do update set
         ${keys.map((k, i) => `${k} = ${holes[i]}`).join(", ")}, updated_at = now()
       returning *`
    : `insert into product_overrides (product_id) values ($1)
       on conflict (product_id) do update set updated_at = now()
       returning *`;
  const rows = await query<OverrideRow>(sql, params);
  return mapOverride(rows[0]);
}

export async function getSettings(): Promise<Record<string, unknown>> {
  const rows = await query<{ key: string; value: unknown }>("select key, value from settings");
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await query(
    `insert into settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [key, JSON.stringify(value ?? null)],
  );
}

/* ---------- audit -------------------------------------------------------- */

export async function writeAudit(actor: string, action: string, payload?: unknown): Promise<void> {
  await query("insert into admin_audit (actor, action, payload) values ($1, $2, $3::jsonb)", [
    actor,
    action,
    JSON.stringify(payload ?? null),
  ]);
}

/** Same, for places where a missing database must not break the request. */
export async function writeAuditSafe(actor: string, action: string, payload?: unknown): Promise<void> {
  try {
    await writeAudit(actor, action, payload);
  } catch (err) {
    console.error(`[orders] audit "${action}" not written:`, err);
  }
}

export type AuditRow = { id: number; at: string; actor: string | null; action: string; payload: unknown };

export async function listAudit(limit = 100): Promise<AuditRow[]> {
  const rows = await query<{ id: string | number; at: string | Date; actor: string | null; action: string; payload: unknown }>(
    "select id, at, actor, action, payload from admin_audit order by at desc, id desc limit $1",
    [Math.min(Math.max(Number(limit) || 100, 1), 500)],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    at: new Date(r.at as string).toISOString(),
    actor: r.actor,
    action: r.action,
    payload: r.payload,
  }));
}

/* ---------- pricing ------------------------------------------------------ */

type PricedLine = OrderItem;

function variantOf(productId: string, variant: unknown): { label: string | null; price: number | null } {
  const v = VARIANTS[productId];
  if (variant == null || variant === "") return { label: null, price: null };
  if (!v) return { label: String(variant), price: null };

  // an index ("0", 2) or the label itself ("500 мл")
  const asIndex = typeof variant === "number" ? variant : /^\d+$/.test(String(variant)) ? Number(variant) : -1;
  const idx = asIndex >= 0 && asIndex < v.sizes.length ? asIndex : v.sizes.indexOf(String(variant));
  if (idx < 0) return { label: String(variant), price: null };
  return { label: v.sizes[idx], price: num(v.prices[idx], NaN) };
}

type BundleDef = {
  id?: string;
  /** src/data/bundles.json carries {RU, ET, EN}; a plain string also works. */
  title?: string | Record<string, string>;
  name?: string;
  price?: number;
  stock?: StockState;
  items?: Array<{ id: string; variant?: string | number | null; size?: number | string | null; qty?: number }>;
  products?: string[];
  discount?: number;
};

async function bundleDefs(): Promise<Record<string, BundleDef>> {
  const mod = await optionalData("bundles.json");
  if (!mod) return {};
  const raw = (mod.default ?? mod) as unknown;
  if (Array.isArray(raw)) {
    const out: Record<string, BundleDef> = {};
    for (const b of raw as BundleDef[]) if (b && b.id) out[b.id] = b;
    return out;
  }
  return (raw as Record<string, BundleDef>) ?? {};
}

type BundlePart = { id: string; variant?: string | number | null; size?: number | string | null; qty?: number };

function bundleParts(def: BundleDef): BundlePart[] {
  return def.items ?? (def.products ?? []).map((id) => ({ id, qty: 1 }));
}

/** bundles.json titles are trilingual objects; RU is the source of truth. */
function bundleTitle(def: BundleDef, lang: string, fallback: string): string {
  const t = def.title ?? def.name;
  if (typeof t === "string") return t;
  if (t && typeof t === "object") return t[lang] || t.RU || Object.values(t)[0] || fallback;
  return fallback;
}

/** Price of one bundle: its own price when set, else the sum of its parts. */
function bundlePrice(def: BundleDef, overrides: Record<string, Override>): number {
  if (def.price != null && Number.isFinite(num(def.price, NaN))) return money(num(def.price));
  const parts = bundleParts(def);
  let sum = 0;
  for (const part of parts) {
    const p = BY_ID.get(part.id);
    if (!p) continue;
    const v = variantOf(part.id, part.variant ?? part.size);
    const base = v.price != null && Number.isFinite(v.price) ? v.price : p.p;
    const o = overrides[part.id];
    const unit = o?.price != null ? o.price : base;
    sum += unit * Math.max(1, Number(part.qty) || 1);
  }
  if (def.discount) sum -= def.discount > 1 ? def.discount : sum * def.discount;
  return money(Math.max(0, sum));
}

/**
 * Turns the browser's `{id, variant, qty}` list into priced lines. Throws
 * OrderError on anything it cannot price honestly.
 */
export async function priceItems(
  items: CreateOrderInput["items"],
  lang = "RU",
): Promise<{ lines: PricedLine[]; subtotal: number }> {
  if (!Array.isArray(items) || !items.length) throw new OrderError("empty_order");
  if (items.length > 50) throw new OrderError("too_many_items");

  const overrides = await getOverrides();
  const bundles = items.some((it) => typeof it?.id === "string" && it.id.startsWith("bundle:"))
    ? await bundleDefs()
    : {};

  const lines: PricedLine[] = [];
  for (const raw of items) {
    if (!raw || typeof raw.id !== "string") throw new OrderError("bad_item");
    const qty = Math.trunc(Number(raw.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 99) throw new OrderError("bad_qty", raw.id);

    if (raw.id.startsWith("bundle:")) {
      const bid = raw.id.slice("bundle:".length);
      const def = bundles[bid];
      if (!def) throw new OrderError("bundle_unknown", bid);
      if (def.stock === "out") throw new OrderError("out_of_stock", raw.id);
      // a bundle is out of stock as soon as one of its parts is
      for (const part of bundleParts(def)) {
        const state = overrides[part.id]?.stock ?? (BY_ID.get(part.id)?.s as StockState | undefined);
        if (state === "out") throw new OrderError("out_of_stock", part.id);
      }
      const price = bundlePrice(def, overrides);
      lines.push({
        id: raw.id,
        kind: "bundle",
        title: bundleTitle(def, lang, bid),
        variant: null,
        qty,
        price,
        sum: money(price * qty),
      });
      continue;
    }

    if (raw.id.startsWith("gift:")) {
      // Virtual product: a gift card for a fixed amount. The features agent's
      // module decides which amounts exist; without it no card can be sold.
      const parse = fn(await optionalLib("giftcards"), "parseGiftItemId");
      const amount = parse ? num(await parse(raw.id), NaN) : NaN;
      if (!Number.isFinite(amount) || amount <= 0) throw new OrderError("gift_unknown", raw.id);
      const meta = raw.meta && typeof raw.meta === "object" ? giftMeta(raw.meta) : null;
      lines.push({
        id: raw.id,
        kind: "gift",
        title: giftTitle(amount, lang),
        variant: null,
        qty,
        price: money(amount),
        sum: money(amount * qty),
        meta,
      });
      continue;
    }

    const p = BY_ID.get(raw.id);
    if (!p) throw new OrderError("unknown_item", raw.id);

    const o = overrides[raw.id];
    const stock: StockState = (o?.stock ?? (p.s as StockState)) || "in";
    if (stock === "out") throw new OrderError("out_of_stock", raw.id);

    const v = variantOf(raw.id, raw.variant);
    /* An override price replaces the base price; a size that costs more keeps
       its premium over the base, so «−1 € on the 75 ml» does not silently
       hand away 16 € on the 500 ml. */
    let unit: number;
    if (o?.price != null) {
      unit = v.price != null && Number.isFinite(v.price) ? money(o.price + (v.price - p.p)) : o.price;
    } else {
      unit = v.price != null && Number.isFinite(v.price) ? v.price : p.p;
    }
    if (!Number.isFinite(unit) || unit < 0) throw new OrderError("bad_price", raw.id);

    lines.push({
      id: p.id,
      kind: "product",
      title: p.n,
      brand: p.b,
      variant: v.label,
      qty,
      price: money(unit),
      sum: money(unit * qty),
    });
  }

  const subtotal = money(lines.reduce((s, l) => s + l.sum, 0));
  return { lines, subtotal };
}

function giftTitle(amount: number, lang: string): string {
  const a = money(amount);
  const shown = Number.isInteger(a) ? String(a) : a.toFixed(2);
  if (lang === "ET") return `Kinkekaart ${shown} €`;
  if (lang === "EN") return `Gift card €${shown}`;
  return `Подарочная карта ${shown} €`;
}

/** Only the four recipient fields, each trimmed and capped — never raw client JSON. */
function giftMeta(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ["name", "email", "message", "from"]) {
    const v = raw[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 300);
  }
  return out;
}

/* ---------- rows --------------------------------------------------------- */

type OrderRow = {
  id: string;
  number: string;
  status: OrderStatus;
  lang: string;
  currency: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  shipping: unknown;
  items: unknown;
  subtotal: string | number;
  shipping_price: string | number;
  discount: string | number;
  discount_code: string | null;
  total: string | number;
  payment: unknown;
  notes: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function jsonOf<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

export function mapOrder(r: OrderRow): Order {
  return {
    id: String(r.id),
    number: r.number,
    status: r.status,
    lang: r.lang,
    currency: r.currency,
    email: r.email ?? "",
    phone: r.phone ?? "",
    name: r.name ?? "",
    shipping: jsonOf<OrderShipping>(r.shipping, { method: "", country: "EE", price: 0 }),
    items: jsonOf<OrderItem[]>(r.items, []),
    subtotal: money(num(r.subtotal)),
    shippingPrice: money(num(r.shipping_price)),
    discount: money(num(r.discount)),
    discountCode: r.discount_code ?? null,
    total: money(num(r.total)),
    payment: jsonOf<Record<string, unknown> | null>(r.payment, null),
    notes: r.notes ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
    updatedAt: new Date(r.updated_at as string).toISOString(),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---------- the five contract functions ---------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/* ---------- shipping, whitelisted --------------------------------------- */

/**
 * The shipping blob is the one part of an order the shopper writes freely, and
 * every field of it is drawn in the admin panel. It used to be stored as sent —
 * unchecked type, no length, no character rules — which made an anonymous order
 * a script injection into the owner's own screen (audit C2/M2).
 *
 * Nothing here is "sanitised": each field is rebuilt from scratch out of a
 * known set. Anything that does not fit becomes null, never an error — a
 * shopper must not be able to lose an order to a stray character in a parcel
 * machine's name.
 */
const SHIP_METHODS = ["parcel", "courier", "pickup"] as const;
const SHIP_CARRIERS = ["omniva", "smartpost", "dpd", "venipak"] as const;
/** Address fields the checkout actually sends. Anything else is dropped. */
const SHIP_ADDRESS_KEYS = ["addr", "street", "zip", "city", "house", "flat"] as const;

/** Printable, single-line, trimmed, capped. Control characters never survive. */
function shipText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return s || null;
}

/**
 * "parcel" | "courier" | "pickup". Older clients (and the Estonian/Russian
 * labels the first checkout sent) are mapped rather than refused, so the stored
 * value is always one of three words — which is what the admin renders.
 */
export function shipMethodOf(v: unknown): (typeof SHIP_METHODS)[number] {
  const s = String(v ?? "").toLowerCase().trim();
  if ((SHIP_METHODS as readonly string[]).includes(s)) {
    return s as (typeof SHIP_METHODS)[number];
  }
  if (/pickup|самовыв|заберу|ise|tule|kohapeal|store|shop/.test(s)) return "pickup";
  if (/courier|kuller|курьер|door|uks|дверь/.test(s)) return "courier";
  return "parcel";
}

export function shipCarrierOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.toLowerCase().trim().slice(0, 20);
  return (SHIP_CARRIERS as readonly string[]).includes(s) ? s : null;
}

function shipAddress(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const raw = v as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of SHIP_ADDRESS_KEYS) {
    const s = shipText(raw[k], 160);
    if (s) out[k] = s;
  }
  return Object.keys(out).length ? out : null;
}

function cleanShipping(ship: CreateOrderInput["shipping"], price: number): OrderShipping {
  return {
    method: shipMethodOf(ship?.method),
    country: /^[A-Za-z]{2}$/.test(String(ship?.country ?? ""))
      ? String(ship.country).toUpperCase()
      : "EE",
    carrier: shipCarrierOf(ship?.carrier),
    pointId: shipText(ship?.pointId, 80),
    pointName: shipText(ship?.pointName, 160),
    address: shipAddress(ship?.address),
    price,
  };
}

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const customer = input?.customer ?? {};
  const name = String(customer.name ?? "").trim().slice(0, 120);
  const email = String(customer.email ?? "").trim().toLowerCase().slice(0, 160);
  const phone = String(customer.phone ?? "").trim().slice(0, 40);
  if (!name) throw new OrderError("bad_name");
  if (!EMAIL_RE.test(email)) throw new OrderError("bad_email");

  const lang = String(input.lang ?? "RU").toUpperCase().slice(0, 5);
  const { lines, subtotal } = await priceItems(input.items, lang);

  // Rebuilt from a whitelist before anything is priced or stored (audit C2/M2).
  const shippingJson = cleanShipping(input?.shipping ?? {}, 0);
  const { method, country, carrier } = shippingJson;
  // Nothing physical ships when the whole order is gift cards.
  const giftOnly = lines.every((l) => l.kind === "gift");
  const shipPrice = giftOnly ? 0 : await shippingPrice(country, method, subtotal, carrier);
  shippingJson.price = shipPrice;

  const discount = await discountFor(input.discountCode, money(subtotal + shipPrice));
  const total = money(Math.max(0, subtotal + shipPrice - discount));

  const rows = await query<OrderRow>(
    `insert into orders (lang, email, phone, name, shipping, items, subtotal, shipping_price, discount, discount_code, total, notes)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12)
     returning *`,
    [
      lang,
      email,
      phone,
      name,
      JSON.stringify(shippingJson),
      JSON.stringify(lines),
      subtotal,
      shipPrice,
      discount,
      input.discountCode ? String(input.discountCode).trim().slice(0, 60) : null,
      total,
      typeof input.notes === "string" ? input.notes.replace(/\s+$/, "").slice(0, 2000) || null : null,
    ],
  );
  const order = mapOrder(rows[0]);

  /* The gift card is NOT spent here (audit H3). The discount and the code are
     quoted onto the order; the balance is taken in src/lib/payments/apply.ts
     the moment the payment is confirmed. A checkout that is abandoned on the
     bank's page, or that fails, costs the customer nothing — which is what
     applyGiftCard()'s own docstring has always promised. */

  // The mail agent's hook must never be able to lose an order that is already
  // in the database.
  try {
    const hook = fn(await optionalLib("mail-hooks"), "onOrderCreated");
    if (hook) await hook(order);
  } catch (err) {
    console.error("[orders] onOrderCreated failed:", err);
  }

  return order;
}

export async function getOrder(id: string): Promise<Order | null> {
  if (!id || !UUID_RE.test(id)) return null;
  const rows = await query<OrderRow>("select * from orders where id = $1", [id]);
  return rows.length ? mapOrder(rows[0]) : null;
}

export async function getOrderByNumber(number: string): Promise<Order | null> {
  const n = String(number ?? "").trim().toUpperCase();
  if (!n) return null;
  const full = /^R-/.test(n) ? n : `R-${n}`;
  const rows = await query<OrderRow>("select * from orders where number = $1", [full]);
  return rows.length ? mapOrder(rows[0]) : null;
}

/** Merges into the existing payment payload rather than replacing it. */
export async function setOrderPayment(id: string, payment: Record<string, unknown>): Promise<Order | null> {
  if (!id || !UUID_RE.test(id)) return null;
  const rows = await query<OrderRow>(
    `update orders set payment = coalesce(payment, '{}'::jsonb) || $2::jsonb, updated_at = now()
     where id = $1 returning *`,
    [id, JSON.stringify(payment ?? {})],
  );
  return rows.length ? mapOrder(rows[0]) : null;
}

export async function setOrderStatus(id: string, status: OrderStatus, actor = "system"): Promise<Order | null> {
  if (!id || !UUID_RE.test(id)) return null;
  if (!ORDER_STATUSES.includes(status)) throw new OrderError("bad_status", String(status));
  const before = await getOrder(id);
  if (!before) return null;
  const rows = await query<OrderRow>("update orders set status = $2, updated_at = now() where id = $1 returning *", [
    id,
    status,
  ]);
  const after = mapOrder(rows[0]);
  await writeAudit(actor, "order.status", { id, number: after.number, from: before.status, to: status });
  return after;
}

export async function setOrderNote(id: string, note: string, actor = "admin"): Promise<Order | null> {
  if (!id || !UUID_RE.test(id)) return null;
  const rows = await query<OrderRow>("update orders set notes = $2, updated_at = now() where id = $1 returning *", [
    id,
    String(note ?? "").slice(0, 2000),
  ]);
  if (!rows.length) return null;
  const order = mapOrder(rows[0]);
  await writeAudit(actor, "order.note", { id, number: order.number });
  return order;
}

export async function listOrders(opts: { status?: string; q?: string; limit?: number } = {}): Promise<Order[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status && ORDER_STATUSES.includes(opts.status as OrderStatus)) {
    params.push(opts.status);
    where.push(`status = $${params.length}`);
  }
  // capped: a 4 MB search term is four `like '%…%'` scans, not a search (L8)
  const q = String(opts.q ?? "").trim().slice(0, 100);
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    const i = params.length;
    where.push(`(lower(number) like $${i} or lower(email) like $${i} or lower(name) like $${i} or lower(coalesce(phone,'')) like $${i})`);
  }
  params.push(Math.min(Math.max(Number(opts.limit) || 50, 1), 200));
  const rows = await query<OrderRow>(
    `select * from orders ${where.length ? `where ${where.join(" and ")}` : ""}
     order by created_at desc limit $${params.length}`,
    params,
  );
  return rows.map(mapOrder);
}
