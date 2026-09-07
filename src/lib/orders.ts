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
 *   src/lib/promos.ts     quotePromo(code, subtotal, shipping)
 *   src/lib/mail-hooks.ts onOrderCreated(order)
 *   src/data/bundles.json bundle definitions for items with id "bundle:<id>"
 * Without them the order still goes through: a flat shipping table, no
 * discount, no mail, and bundle lines are rejected with `bundle_unknown`.
 */
import catalogueMin from "@/data/catalogue.min.json";
import variantData from "@/data/catalogue.variants.json";
import { jsonbParam, query } from "@/lib/db";
// Wholesale/pro pricing — src/lib/loyalty.ts (100_tiers_loyalty), a module of
// this same build, unlike the optional neighbours below: no try/catch needed.
import { customerTier, getPricingSettings, proUnitPrice, quoteLoyaltyRedeem } from "@/lib/loyalty";
// Shipping defaults — src/lib/shipping.ts is a module of this build too (see
// docs/shipping.md), imported only for its constant so FALLBACK_SHIPPING below
// cannot drift from it; the live computeShipping() call itself still goes
// through the optional-neighbour door a few lines down.
import { DEFAULT_SHIPPING_RULES } from "@/lib/shipping";
// media: what product_overrides.video_url is allowed to hold — a pure module
// of this build, no side effects, see src/lib/video.ts.
import { cleanVideoUrl } from "@/lib/video";

/* ---------- types -------------------------------------------------------- */

/*
 * The fulfilment steps, in order: new → paid → shipped → delivered, with
 * cancelled / refunded off to the side. `delivered` is the owner's own last
 * step («Доставлен» on the order card): a hand-over the carrier's tracking
 * page or the customer confirmed, no letter behind it, undoable back to
 * shipped from the journal. The database's check constraint spells out the
 * same list — db/migrations/140_order_delivered.sql; add a value there and
 * here together, never in one place only.
 */
export const ORDER_STATUSES = ["new", "paid", "failed", "shipped", "delivered", "cancelled", "refunded"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** The statuses an order carries once its money arrived and stayed — the
 *  three fulfilment steps after payment. src/lib/analytics.ts's
 *  PAID_STATUSES is this same list under its own name. */
export const PAID_ORDER_STATUSES = ["paid", "shipped", "delivered"] as const satisfies readonly OrderStatus[];

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
  /** Parcel-machine operator: omniva | smartpost | dpd | venipak | unisend. */
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
  /** inventory: 'web' | 'pos' — where the order was made. db/migrations/091_pos_channel.sql. */
  channel: "web" | "pos";
  /* ---- wholesale/loyalty: db/migrations/100_tiers_loyalty.sql ------------ */
  /** The signed-in customer this order belongs to, or null (guest checkout, or an order placed before this column existed). */
  customerId: string | null;
  /** What was actually charged — 'retail' | 'pro' | null (guest). Never recomputed after the fact. */
  pricingTier: "retail" | "pro" | null;
  /** Euro taken off by «Использовать баллы» — quoted here, spent in src/lib/payments/apply.ts on the paid transition. */
  loyaltyDiscount: number;
  total: number;
  payment: Record<string, unknown> | null;
  notes: string | null;
  /* ---- «По счёту — для компаний»: db/migrations/141_invoices.sql ---------- */
  /** The buyer's company as typed at checkout ({name, regCode, vatNumber, address, email}), null on a private order.
   *  Optional in the type (mapOrder always sets it) so an Order literal written before migration 141 still compiles. */
  company?: Record<string, unknown> | null;
  /** The invoice issued for the order ({number, issueDate, dueAt, …} — src/lib/invoices.ts InvoiceRecord), null when paid another way. */
  invoice?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateOrderInput = {
  lang?: string;
  /** inventory: 'web' (default, the storefront checkout) or 'pos' (in-salon quick sale, POST /api/admin/pos-orders). */
  channel?: "web" | "pos";
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
  /** inventory: channel:'pos' only — a flat percent off the goods, typed at the register. */
  posDiscountPercent?: number | null;
  notes?: string | null;
  /* ---- wholesale/loyalty: db/migrations/100_tiers_loyalty.sql ------------ */
  /** «Использовать баллы» toggle at checkout — the amount is quoted server-side, never sent by the client. */
  redeemPoints?: boolean;
  /* ---- «По счёту — для компаний» (src/lib/invoices.ts) -------------------- */
  /** `{ method: "invoice" }` asks for an invoice instead of a payment page; anything else is ignored here. */
  payment?: { method?: string } | null;
  /** The company the invoice is made out to — required with `payment.method: "invoice"`, cleaned by cleanCompany(). */
  company?: unknown;
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
  /** Wholesale/pro price override — db/migrations/100_tiers_loyalty.sql. Null = computed from settings.pricing.proDiscountPct. */
  pro_price: string | number | null;
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
  /** Wholesale/pro price override, null = base price × (1 − proDiscountPct/100). Admin-only — never in the public /api/overrides response. */
  proPrice: number | null;
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

/* product creation: the owner's own rows (src/lib/custom-products.ts, ids
   `c-…`, db/migrations/131_custom_products.sql) are priced from the table,
   never from the browser. Loaded at call time like every other optional
   neighbour below — and only for ids the file does not have, so a basket of
   catalogue products never pays for the query. */
type CustomLookup = Map<string, { min: MinProduct; variants: { sizes: string[]; prices: number[] } | null }>;
async function customLookup(ids: unknown[]): Promise<CustomLookup> {
  const want = ids.filter((id): id is string => typeof id === "string" && id.startsWith("c-") && !BY_ID.has(id));
  if (!want.length) return new Map();
  try {
    const { customMinByIds } = await import("@/lib/custom-products");
    return await customMinByIds(want);
  } catch (err) {
    console.error("[orders] custom products not loaded:", err);
    return new Map();
  }
}

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

async function optionalLib(
  name: "shipping" | "giftcards" | "promos" | "mail-hooks" | "bundles",
): Promise<AnyModule | null> {
  try {
    if (name === "shipping") return (await import("@/lib/shipping")) as unknown as AnyModule;
    if (name === "giftcards") return (await import("@/lib/giftcards")) as unknown as AnyModule;
    if (name === "promos") return (await import("@/lib/promos")) as unknown as AnyModule;
    /* Sets live in the `bundles` table now (db/migrations/120_bundles.sql).
       Imported at call time like every other neighbour — and, unlike them, it
       imports THIS module back for getOverrides(), which is exactly why it
       must not be a static import at the top of this file. */
    if (name === "bundles") return (await import("@/lib/bundles")) as unknown as AnyModule;
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

/**
 * Last-resort numbers if src/lib/shipping.ts's own computeShipping() throws —
 * derived from DEFAULT_SHIPPING_RULES there (docs/shipping.md § «Тарифы
 * Montonio») instead of a second hand-typed copy, so the two cannot drift
 * apart the way they already had once (EE parcel/courier sat at the old
 * 3.49/5.99 brief numbers here while the real defaults moved to 5.47/10.84).
 */
export const FALLBACK_SHIPPING = {
  parcelEE: DEFAULT_SHIPPING_RULES.methods.parcel.EE,
  courierEE: DEFAULT_SHIPPING_RULES.methods.courier.EE,
  eu: DEFAULT_SHIPPING_RULES.methods.courier.default,
  freeFrom: DEFAULT_SHIPPING_RULES.freeFrom ?? 59,
};

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
 * One box at the checkout takes two different things, so one function resolves
 * both. `RMP-XXXX-XXXX` is a gift card (src/lib/giftcards.ts); anything else is
 * looked up in `promo_codes` (src/lib/promos.ts). Neither is spent here — both
 * are quoted onto the order and taken on the paid transition in
 * src/lib/payments/apply.ts.
 *
 * A free-shipping code comes back as a discount equal to the delivery price
 * rather than as a zeroed shipping line: the receipt then still shows what the
 * parcel costs and what the code took off it, and `shipping_price` keeps
 * meaning «what this delivery costs» for everything downstream.
 */
async function codeDiscount(
  code: string | null | undefined,
  subtotal: number,
  shipping: number,
): Promise<number> {
  if (!code) return 0;
  const promos = await optionalLib("promos");
  const isGift = fn(promos, "looksLikeGiftCode");
  const quote = fn(promos, "quotePromo");
  /* Only take the promo branch when the module can positively say this is not
     a card. Missing module, missing export, half-written file — all of them
     fall through to the gift-card path, which answers 0 for a code it does not
     know. The degradation is «no discount», never «the wrong discount». */
  if (isGift && quote && !isGift(code)) {
    try {
      const out = (await quote(code, subtotal, shipping)) as {
        ok?: boolean;
        discount?: unknown;
      } | null;
      if (!out?.ok) return 0;
      const discount = num(out.discount, 0);
      if (!Number.isFinite(discount) || discount <= 0) return 0;
      return money(Math.min(discount, subtotal + shipping));
    } catch (err) {
      console.error("[orders] quotePromo failed, order priced without a discount:", err);
      return 0;
    }
  }
  return giftDiscountFor(code, money(subtotal + shipping));
}

/**
 * Gift cards are the features agent's. Whatever shape applyGiftCard returns —
 * a number, {discount}, {amount} or the new {total} — it comes out of here as
 * a discount in euro, clamped to the order.
 */
async function giftDiscountFor(code: string | null | undefined, total: number): Promise<number> {
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
    proPrice: r.pro_price == null ? null : money(num(r.pro_price)),
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

  /* inventory: numeric stock wins over the manual in/low/out override the
     moment a product has actually been counted — see src/lib/inventory.ts's
     module doc ("tracked" = at least one real stock_moves row). A product
     nobody has scanned or adjusted yet is left untouched here and keeps its
     manual value. Best effort and dynamically imported like every optional
     neighbour above: a broken inventory module must not take the storefront
     down with it. */
  try {
    const { productStockStates } = await import("@/lib/inventory");
    const derived = await productStockStates(ids);
    for (const [id, stock] of Object.entries(derived)) {
      out[id] = out[id]
        ? { ...out[id], stock }
        : { price: null, stock, seoTitle: null, seoDesc: null, subcat: null, varImg: null, videoUrl: null, gallery: null, proPrice: null, updatedAt: null };
    }
  } catch (err) {
    console.error("[orders] inventory stock derivation failed, using manual overrides:", err);
  }

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
  if ("varImg" in patch) cols.var_img = patch.varImg == null ? null : jsonbParam(patch.varImg);
  /* media: only a link this shop can actually turn into a player — YouTube,
     Vimeo, an Instagram reel/post, or an .mp4/.mov in our own bucket. Anything
     else (a javascript: URL above all, but equally a link to a page that just
     happens to have a video on it) is refused rather than stored: a stored
     link that renders nothing looks identical to no link at all. */
  if ("videoUrl" in patch) {
    try {
      cols.video_url = cleanVideoUrl(patch.videoUrl);
    } catch {
      throw new OrderError("bad_video", String(patch.videoUrl ?? "").slice(0, 120));
    }
  }
  if ("gallery" in patch) {
    const list = cleanGallery(patch.gallery);
    cols.gallery = list == null ? null : jsonbParam(list);
  }
  if ("proPrice" in patch) cols.pro_price = patch.proPrice == null ? null : money(num(patch.proPrice));

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

  /* «Снова в наличии» (account-flows). Pending stock_alerts rows only exist
     for a product somebody found sold out, so "the owner set stock to in and
     there are rows waiting" IS the out→in transition — no before/after read
     needed. Loaded lazily and swallowed: a mail problem must never stop the
     owner saving a price. */
  if (cols.stock === "in") {
    try {
      const { runBackInStock } = await import("@/lib/flows");
      await runBackInStock(productId);
    } catch (err) {
      console.error("[orders] back-in-stock flow failed:", err);
    }
  }

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
    [key, jsonbParam(value)],
  );
}

/* ---------- audit -------------------------------------------------------- */

export async function writeAudit(actor: string, action: string, payload?: unknown): Promise<void> {
  await query("insert into admin_audit (actor, action, payload) values ($1, $2, $3::jsonb)", [
    actor,
    action,
    jsonbParam(payload),
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

function variantOf(
  productId: string,
  variant: unknown,
  table?: { sizes: string[]; prices: number[] } | null,
): { label: string | null; price: number | null } {
  // a custom product carries its own size ladder (customLookup); the file's otherwise
  const v = table ?? VARIANTS[productId];
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
  items?: Array<{
    /** `id` in src/data/bundles.json, `productId` in the `bundles` table. */
    id?: string;
    productId?: string;
    variant?: string | number | null;
    size?: number | string | null;
    qty?: number;
  }>;
  products?: string[];
  discount?: number;
};

/**
 * Where a «bundle:<id>» line gets its definition — and therefore its price.
 *
 * The `bundles` table first (db/migrations/120_bundles.sql): that is what the
 * owner edits in the admin, and a set the shop is showing at one price must
 * never be charged at another. Hidden and switched-off sets are included on
 * purpose — a customer who put a set in the cart an hour ago must be able to
 * finish paying for it (see bundleDefsForOrders() in src/lib/bundles.ts).
 *
 * src/data/bundles.json stays behind it as the fallback for a deployment with
 * no database, or one whose migration has not run yet: without it a shop that
 * lost its database would reject every set line as `bundle_unknown` instead
 * of simply pricing it from the file it shipped with.
 */
async function bundleDefs(): Promise<Record<string, BundleDef>> {
  const fromDb = fn(await optionalLib("bundles"), "bundleDefsForOrders");
  if (fromDb) {
    try {
      const rows = (await fromDb()) as Record<string, BundleDef>;
      if (rows && Object.keys(rows).length) return rows;
    } catch (err) {
      console.error("[orders] bundles table unavailable, falling back to bundles.json:", err);
    }
  }
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
  if (def.items) {
    return def.items
      .map((it) => ({ ...it, id: String(it.productId ?? it.id ?? "") }))
      .filter((it) => !!it.id);
  }
  return (def.products ?? []).map((id) => ({ id, qty: 1 }));
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

/** What the caller already knows about who is buying — wholesale/loyalty (100_tiers_loyalty). */
export type PriceContext = { customerId?: string | null };

/**
 * Turns the browser's `{id, variant, qty}` list into priced lines. Throws
 * OrderError on anything it cannot price honestly.
 *
 * `ctx.customerId`, when given, may turn plain product lines into pro-priced
 * ones — see the "wholesale" block below. Bundles and gift cards never get a
 * pro price: a bundle is already one fixed price, and a gift card's face
 * value is not a markup to discount. `pricingTier` on the result is what was
 * actually charged ('retail' even for a pro customer whose basket did not
 * reach settings.pricing.proMinOrder), for the admin to see on the order.
 */
export async function priceItems(
  items: CreateOrderInput["items"],
  lang = "RU",
  ctx: PriceContext = {},
): Promise<{ lines: PricedLine[]; subtotal: number; pricingTier: "retail" | "pro" | null }> {
  if (!Array.isArray(items) || !items.length) throw new OrderError("empty_order");
  if (items.length > 50) throw new OrderError("too_many_items");

  const overrides = await getOverrides();
  const bundles = items.some((it) => typeof it?.id === "string" && it.id.startsWith("bundle:"))
    ? await bundleDefs()
    : {};
  // product creation: the owner's own products, by id — empty for a catalogue-only basket
  const custom = await customLookup(items.map((it) => it?.id));

  /* ---- wholesale: is this a customer the owner approved for pro pricing? ---
     Resolved once, up front — every product line below asks only "what does
     THIS unit cost at the pro rate", never the database again. */
  let pricingTier: "retail" | "pro" | null = null;
  let proDiscountPct = 0;
  let proMinOrder = 0;
  if (ctx.customerId) {
    const tier = await customerTier(ctx.customerId);
    pricingTier = tier ?? "retail";
    if (tier === "pro") {
      const pricing = await getPricingSettings();
      proDiscountPct = pricing.proDiscountPct;
      proMinOrder = pricing.proMinOrder;
    }
  }
  // the pro unit price for each line pushed below, in the same order —
  // null for bundle/gift lines and for any line priced before a pro rate
  // could be resolved (i.e. this customer is not pro at all)
  const proUnits: Array<number | null> = [];

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
      proUnits.push(null); // no pro price on a set — it is already one fixed price
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
      proUnits.push(null); // no pro price on a gift card — its face value is not a markup
      continue;
    }

    const own = custom.get(raw.id);
    const p = BY_ID.get(raw.id) ?? own?.min;
    if (!p) throw new OrderError("unknown_item", raw.id);

    const o = overrides[raw.id];
    // a hidden custom product answers s:"out" from customLookup — «нет в
    // наличии» is the honest refusal for something the owner took off sale
    const stock: StockState = own && own.min.s === "out" ? "out" : (o?.stock ?? (p.s as StockState)) || "in";
    if (stock === "out") throw new OrderError("out_of_stock", raw.id);

    const v = variantOf(raw.id, raw.variant, own?.variants);
    /* A size the product does not have — «250 ml» against a «250 мл» ladder,
       an index past the end — used to fall through to the base price with
       the browser's label kept on the line: a tampered cart bought the big
       bottle at the small bottle's price, and the owner shipped what the
       label said. With a ladder to check against, an unknown size is refused
       (security re-audit 04.09.2026). A product with no ladder keeps taking
       whatever label the cart carries, priced at its one price, as before. */
    const ladder = own?.variants ?? VARIANTS[raw.id];
    if (ladder && ladder.sizes.length && raw.variant != null && raw.variant !== "" && v.price == null) {
      throw new OrderError("bad_variant", raw.id);
    }
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
    // Same "override replaces the base, the size keeps its own premium" rule
    // as above, just for the pro base instead of the retail one — see
    // proUnitPrice() in src/lib/loyalty.ts.
    const base = o?.price != null ? o.price : p.p;
    proUnits.push(pricingTier === "pro" ? proUnitPrice(base, unit, o?.proPrice, proDiscountPct) : null);
  }

  const retailSubtotal = money(lines.reduce((s, l) => s + l.sum, 0));
  let subtotal = retailSubtotal;
  if (pricingTier === "pro" && retailSubtotal >= proMinOrder) {
    // Swap in the pro unit price on every line that has one, then reprice —
    // gated on the RETAIL subtotal (not yet discounted) so «от 200 €»
    // means the same 200 € the basket would otherwise have cost.
    for (let i = 0; i < lines.length; i++) {
      const pro = proUnits[i];
      if (pro == null) continue;
      lines[i] = { ...lines[i], price: pro, sum: money(pro * lines[i].qty) };
    }
    subtotal = money(lines.reduce((s, l) => s + l.sum, 0));
  } else if (pricingTier === "pro") {
    // approved for pro pricing, but this basket has not reached proMinOrder —
    // billed (and recorded) as retail for this one order
    pricingTier = "retail";
  }

  return { lines, subtotal, pricingTier };
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
  channel: string;
  customer_id: string | null;
  pricing_tier: string | null;
  loyalty_discount: string | number | null;
  total: string | number;
  payment: unknown;
  notes: string | null;
  company?: unknown;
  invoice?: unknown;
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
    channel: r.channel === "pos" ? "pos" : "web",
    customerId: r.customer_id ?? null,
    pricingTier: r.pricing_tier === "pro" || r.pricing_tier === "retail" ? r.pricing_tier : null,
    loyaltyDiscount: money(num(r.loyalty_discount)),
    total: money(num(r.total)),
    payment: jsonOf<Record<string, unknown> | null>(r.payment, null),
    notes: r.notes ?? null,
    company: jsonOf<Record<string, unknown> | null>(r.company, null),
    invoice: jsonOf<Record<string, unknown> | null>(r.invoice, null),
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
/* «digital» is the fourth: a cart that holds nothing but gift cards is not a
   parcel at all — there is no country, no carrier and no address, and the
   checkout's second step asks who the card is for instead of where it goes
   (docs/features.md § «Только подарочные карты»). It is refused for any order
   that also holds something physical (not_digital, below). */
const SHIP_METHODS = ["parcel", "courier", "pickup", "digital"] as const;
const SHIP_CARRIERS = ["omniva", "smartpost", "dpd", "venipak", "unisend"] as const;
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
 * "parcel" | "courier" | "pickup" | "digital". Older clients (and the
 * Estonian/Russian labels the first checkout sent) are mapped rather than
 * refused, so the stored value is always one of four words — which is what the
 * admin renders.
 */
export function shipMethodOf(v: unknown): (typeof SHIP_METHODS)[number] {
  const s = String(v ?? "").toLowerCase().trim();
  if ((SHIP_METHODS as readonly string[]).includes(s)) {
    return s as (typeof SHIP_METHODS)[number];
  }
  /* Nothing is guessed into "digital": the other three are shapes a shopper
     could describe in words, this one is a statement about what the order is,
     and createOrder() refuses it for anything but an all-gift-card cart. */
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
  const method = shipMethodOf(ship?.method);
  /* A digital order has no parcel behind it, so it stores none of a parcel's
     fields — a carrier or a pickup point left over from a client that changed
     its mind mid-checkout would print in the admin card and in the letter as if
     something were being shipped. The country is kept: it is the customer's,
     not the parcel's, and the accountant export reads it. */
  const parcel = method !== "digital";
  return {
    method,
    country: /^[A-Za-z]{2}$/.test(String(ship?.country ?? ""))
      ? String(ship.country).toUpperCase()
      : "EE",
    carrier: parcel ? shipCarrierOf(ship?.carrier) : null,
    pointId: parcel ? shipText(ship?.pointId, 80) : null,
    pointName: parcel ? shipText(ship?.pointName, 160) : null,
    address: parcel ? shipAddress(ship?.address) : null,
    price,
  };
}

/**
 * `ctx.customerId` is resolved by the caller (the route reads the `rmp_cust`
 * cookie — this file has no Request to read it from itself) from a valid,
 * signed-in session, never from anything the body claims. It drives both pro
 * pricing (priceItems) and, below, the loyalty redeem quote and the
 * `customer_id`/`pricing_tier` columns.
 */
export async function createOrder(input: CreateOrderInput, ctx: PriceContext = {}): Promise<Order> {
  // inventory: 'pos' is the in-salon till (POST /api/admin/pos-orders) — a
  // walk-in sale has no e-mail and often no name typed at all, unlike the
  // web checkout where both identify the shopper for the receipt and account.
  const channel: "web" | "pos" = input.channel === "pos" ? "pos" : "web";
  const customer = input?.customer ?? {};
  const name = String(customer.name ?? "").trim().slice(0, 120) || (channel === "pos" ? "Продажа в салоне" : "");
  const email = String(customer.email ?? "").trim().toLowerCase().slice(0, 160);
  const phone = String(customer.phone ?? "").trim().slice(0, 40);
  if (!name) throw new OrderError("bad_name");
  if (channel === "pos") {
    // optional, but if the cashier did type one it still has to be a real
    // address — an account-history lookup on a malformed e-mail is silent junk
    if (email && !EMAIL_RE.test(email)) throw new OrderError("bad_email");
  } else if (!EMAIL_RE.test(email)) {
    throw new OrderError("bad_email");
  }

  const lang = String(input.lang ?? "RU").toUpperCase().slice(0, 5);

  /* «По счёту — для компаний» (src/lib/invoices.ts, migration 141): the web
     checkout's fourth payment method. The company block is rebuilt from a
     whitelist before anything is priced — an invoice without a name, a
     registry code and an address is not an invoice — and the order is
     numbered and mailed right after the row is written, below. The till never
     sends `payment`, so a POS sale is untouched. */
  const invoiceMethod = channel === "web" && !!input.payment && typeof input.payment === "object" && input.payment.method === "invoice";
  let company: Record<string, unknown> | null = null;
  if (invoiceMethod) {
    const { cleanCompany } = await import("@/lib/invoices");
    company = cleanCompany(input.company, email);
  }

  const { lines, subtotal, pricingTier } = await priceItems(input.items, lang, ctx);

  // Rebuilt from a whitelist before anything is priced or stored (audit C2/M2).
  const shippingJson = cleanShipping(input?.shipping ?? {}, 0);
  const { method, country, carrier } = shippingJson;
  // Nothing physical ships when the whole order is gift cards.
  const giftOnly = lines.length > 0 && lines.every((l) => l.kind === "gift");
  /* «Электронная доставка» is a promise about the whole order, and this is the
     door that keeps it true: a body that asks for it while carrying a bottle of
     shampoo (or a set) would otherwise get free delivery on a real parcel. The
     browser never sends it for a mixed cart — but the browser is not what
     decides here, exactly like every price in this file. */
  if (method === "digital" && !giftOnly) throw new OrderError("not_digital");
  const shipPrice = giftOnly || method === "digital" ? 0 : await shippingPrice(country, method, subtotal, carrier);
  shippingJson.price = shipPrice;

  /* inventory: POS has no promo/gift-card box — it has a percent the cashier
     types at the register. The two are mutually exclusive by construction
     (a POS order never carries a discountCode), and the percent is folded
     into `discount_code` as a readable label so the existing admin order
     screen (and receipt) show it with zero extra rendering code — the same
     column that would otherwise hold "SUVI10" holds "POS -15%". */
  let discount: number;
  let discountCodeStored: string | null;
  if (channel === "pos") {
    const pct = Math.round(num(input.posDiscountPercent, 0));
    discount = pct > 0 && pct <= 90 ? money(subtotal * (pct / 100)) : 0;
    discountCodeStored = discount > 0 ? `POS -${pct}%` : null;
  } else {
    discount = await codeDiscount(input.discountCode, subtotal, shipPrice);
    discountCodeStored = input.discountCode ? String(input.discountCode).trim().slice(0, 60) : null;
  }

  /* «Использовать баллы» — quoted here, exactly like the gift card and the
     promo code above: nothing is spent yet, only the euro amount is baked
     into the total the customer is about to pay. Spent once, on the paid
     transition, in src/lib/payments/apply.ts. */
  let loyaltyDiscount = 0;
  if (input.redeemPoints && ctx.customerId) {
    const pricing = await getPricingSettings();
    if (pricing.loyalty.enabled) {
      const quote = await quoteLoyaltyRedeem(ctx.customerId, subtotal, pricing.loyalty);
      /* Never more than what the promo or gift card left to pay: a 50 € card
         on a 30 € basket used to leave the points quoted against the full
         basket, so the order came to 0 and the customer still lost the
         points on the paid transition (src/lib/payments/apply.ts takes what
         was quoted). One point is one euro, so whole euros only — the
         checkout's loyaltyMaxRedeem() in public/shop2/app.js draws the same
         two lines, and the summary and the bill stay the same arithmetic. */
      const left = Math.floor(Math.max(0, subtotal + shipPrice - discount));
      if (quote.balance >= quote.minRedeem) loyaltyDiscount = money(Math.min(quote.maxRedeemable, left));
    }
  }

  const total = money(Math.max(0, subtotal + shipPrice - discount - loyaltyDiscount));
  /* Nothing to invoice when a gift card or the points already cover the whole
     order — the shopper is told to pick another way (the zero-total path
     belongs to the payment routes, not to an invoice for 0 €). */
  if (invoiceMethod && !(total > 0)) throw new OrderError("invoice_zero_total");

  const rows = await query<OrderRow>(
    `insert into orders (lang, email, phone, name, shipping, items, subtotal, shipping_price, discount, discount_code, channel, customer_id, pricing_tier, loyalty_discount, total, notes, company)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
     returning *`,
    [
      lang,
      email,
      phone,
      name,
      jsonbParam(shippingJson),
      jsonbParam(lines),
      subtotal,
      shipPrice,
      discount,
      discountCodeStored,
      channel,
      ctx.customerId ?? null,
      ctx.customerId ? pricingTier : null,
      loyaltyDiscount,
      total,
      typeof input.notes === "string" ? input.notes.replace(/\s+$/, "").slice(0, 2000) || null : null,
      company ? jsonbParam(company) : null,
    ],
  );
  let order = mapOrder(rows[0]);

  /* The invoice: a serial number, the record on the row, the letter with the
     PDF. Only the number is fatal — an order the owner cannot invoice is worse
     than a shopper who has to try again; the letter is best effort inside. */
  if (invoiceMethod) {
    const { issueInvoice } = await import("@/lib/invoices");
    order = await issueInvoice(order);
  }

  /* Neither the gift card nor the promo code is spent here (audit H3). The
     discount and the code are quoted onto the order; the card's balance and
     the code's use counter are taken in src/lib/payments/apply.ts the moment
     the payment is confirmed. A checkout that is abandoned on the bank's page,
     or that fails, costs the customer nothing and burns no promo use — which
     is what applyGiftCard()'s own docstring has always promised. */

  /* An order is the end of an abandoned cart: the reminder must not go out
     after the person has already paid (account-flows). Never fatal. */
  try {
    const { markCartRecovered } = await import("@/lib/customers");
    await markCartRecovered(email);
  } catch (err) {
    console.error("[orders] cart recovery failed:", err);
  }

  // The mail agent's hook must never be able to lose an order that is already
  // in the database. An invoice order already got its letter — the invoice
  // itself is the «order received, awaiting payment» message for a company.
  if (!invoiceMethod) {
    try {
      const hook = fn(await optionalLib("mail-hooks"), "onOrderCreated");
      /* `sendPending` used to be missing entirely, so the "order received,
         awaiting payment" letter could never fire whatever the setting said
         (audit top-15 #3). The owner's switch is `settings.flows.pending`; with
         no row, MAIL_PENDING_PAYMENT still decides inside the hook. */
      if (hook) await hook(order, await pendingMailOptions());
    } catch (err) {
      console.error("[orders] onOrderCreated failed:", err);
    }
  }

  return order;
}

/**
 * `{ sendPending: true }` when the owner has turned «письмо об ожидании
 * оплаты» on, `{}` when there is no setting at all — which leaves
 * MAIL_PENDING_PAYMENT in charge, exactly as docs/mail.md describes.
 */
async function pendingMailOptions(): Promise<Record<string, unknown>> {
  try {
    const rows = await query<{ value: unknown }>("select value from settings where key = 'flows'");
    const raw = rows.length ? rows[0].value : null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return {};
    const v = (parsed as Record<string, unknown>).pending;
    if (v === undefined) return {};
    return { sendPending: v === true || v === 1 || /^(1|true|on|yes|да)$/i.test(String(v)) };
  } catch {
    return {};
  }
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

/**
 * The order a provider knows by its own id — `orders.payment.ref`.
 *
 * Refund webhooks name the order by the provider's uuid (Montonio's
 * `orderUuid`), never by our merchantReference, so this is the only way in for
 * a refund made in Montonio's own portal. Newest first: an id is unique in
 * practice, and taking the newest is the safer answer if it ever is not.
 */
export async function getOrderByPaymentRef(ref: string): Promise<Order | null> {
  const r = String(ref ?? "").trim();
  if (!r) return null;
  const rows = await query<OrderRow>(
    "select * from orders where payment->>'ref' = $1 order by created_at desc limit 1",
    [r],
  );
  return rows.length ? mapOrder(rows[0]) : null;
}

/** Merges into the existing payment payload rather than replacing it. */
export async function setOrderPayment(id: string, payment: Record<string, unknown>): Promise<Order | null> {
  if (!id || !UUID_RE.test(id)) return null;
  const rows = await query<OrderRow>(
    `update orders set payment = coalesce(payment, '{}'::jsonb) || $2::jsonb, updated_at = now()
     where id = $1 returning *`,
    [id, jsonbParam(payment ?? {})],
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

  /* inventory: a refund or a cancellation that follows a paid (or already-
     shipped) order is goods coming back — put the quantity back with a
     'return' move. An order that was never paid never took stock in the
     first place (see the paid-transition decrement in
     src/lib/payments/apply.ts), so cancelling one here has nothing to return.
     Product lines only: a bundle line's id ("bundle:<id>") is not a catalogue
     product, so its parts are not resolved and returned individually here —
     out of scope for this pass, same boundary the decrement below draws.
     Best effort: a stock hiccup must never stop a refund from being recorded. */
  const wasPaid = (PAID_ORDER_STATUSES as readonly string[]).includes(before.status);
  if (wasPaid && (status === "refunded" || status === "cancelled")) {
    try {
      const { move, isTracked } = await import("@/lib/inventory");
      for (const item of before.items) {
        if (item.kind !== "product" || !item.qty) continue;
        /* Only a counted shelf gets the bottle back. The sale of an uncounted
           variant was skipped (move() — "tracked"), so there is nothing to
           return; a +N here made the variant tracked at N and the shop said
           «мало» about a product the owner never counted. */
        if (!(await isTracked(item.id, item.variant ?? ""))) continue;
        await move({
          productId: item.id,
          variant: item.variant ?? "",
          delta: Math.abs(item.qty),
          reason: "return",
          ref: after.number,
          actor,
        });
      }
    } catch (err) {
      console.error("[orders] return stock move failed:", err);
    }
  }

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
