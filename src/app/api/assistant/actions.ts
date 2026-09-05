/**
 * The door every model-proposed action passes through.
 *
 * The assistant writes JSON; this decides what of it is allowed to reach the
 * shop. Anything outside the whitelist — unknown type, unknown id, an
 * out-of-range value, a stray key — is dropped, so a prompt-injected "action"
 * can at worst be one of these bounded, client-confirmed operations. Objects
 * are rebuilt field by field rather than filtered, so nothing unexpected can
 * ride along inside one.
 *
 * Lives beside the route rather than inside it because a Next.js route file
 * may only export handlers, and this is the piece the tests need.
 */

import { sanitizeContentPatch } from "@/lib/content";

export const CATEGORIES = ["hair", "styling", "beard", "face", "body", "perfume", "merch", "all"];
export const INFO_PAGES = ["shipping", "returns", "terms", "contact", "privacy"];

/* inventory: duplicated from src/lib/inventory.ts's MOVE_REASONS on purpose —
   this file must stay free of database imports (it is tested as a pure
   function; @/lib/inventory pulls in @/lib/db). A conversational adjustment
   only ever gets the three reasons a human plausibly means to say out loud;
   'sale_web'/'sale_pos' are written by a real sale, never by this action. */
export const STOCK_ADJUST_REASONS = ["goods_in", "adjust", "return"] as const;

/** One line the panel can print: no control or format characters, collapsed whitespace, capped. */
function oneLine(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/* ---- the home-page banner (set_hero) ----------------------------------- */

const HERO_MAX_SLIDES = 5;
const HERO_LANGS = ["RU", "ET", "EN"] as const;
/** Field → the longest string the storefront's layout can carry. */
const HERO_FIELDS: Array<[key: string, max: number]> = [
  ["eyebrow", 40],
  ["title", 40],
  ["sub", 90],
  ["cta", 24],
];

type Trilingual = Partial<Record<(typeof HERO_LANGS)[number], string>>;

function heroText(raw: unknown, max: number): Trilingual {
  const out: Trilingual = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const lang of HERO_LANGS) {
    const v = src[lang];
    if (typeof v !== "string") continue;
    // one line: the banner is a headline, not a paragraph
    const t = v.replace(/\s+/g, " ").trim().slice(0, max);
    if (t) out[lang] = t;
  }
  return out;
}

/** A link the storefront knows how to follow, or "" when it does not. */
function heroGo(raw: unknown, known: Set<string>): string {
  const g = typeof raw === "string" ? raw.trim() : "";
  if (g === "bundles" || g === "gift" || g === "brands") return g;
  if (g.startsWith("cat:") && CATEGORIES.includes(g.slice(4))) return g;
  if (g.startsWith("page:") && INFO_PAGES.includes(g.slice(5))) return g;
  if (g.startsWith("product:") && known.has(g.slice(8))) return g;
  return "";
}

/** A catalogue photo (by product id) or a picture URL — nothing else. */
function heroImage(raw: unknown, known: Set<string>): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v || v.length > 300) return "";
  if (known.has(v)) return v;
  if (/^https?:\/\/[^\s"'<>]+$/i.test(v)) return v;
  if (/^\/shop\/[^\s"'<>]+$/.test(v)) return v;
  return "";
}

export function sanitizeHero(raw: unknown, known: Set<string>): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  if (!Array.isArray(src.slides)) return null;

  const slides: object[] = [];
  for (const s of src.slides.slice(0, HERO_MAX_SLIDES)) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const row = s as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, max] of HERO_FIELDS) out[key] = heroText(row[key], max);
    // a slide with no headline in any language is not a slide
    if (!Object.keys(out.title as Trilingual).length) continue;
    const rawId = typeof row.id === "string" ? row.id.trim() : "";
    out.id = /^[A-Za-z0-9_-]{1,24}$/.test(rawId) ? rawId : `s${slides.length + 1}`;
    out.go = heroGo(row.go, known) || "cat:all";
    out.image = heroImage(row.image, known);
    out.on = row.on !== false;
    slides.push(out);
  }
  if (!slides.length) return null;

  const tick = typeof src.interval === "number" && Number.isFinite(src.interval) ? Math.round(src.interval) : 6000;
  return { slides, interval: Math.min(30_000, Math.max(2_000, tick)) };
}

/* ---- promo codes (create_promo, toggle_promo) --------------------------- */

/**
 * Bounds are duplicated from src/lib/promos.ts on purpose: this file must stay
 * free of database imports (the tests run it as a pure function), and the two
 * copies are checked against each other in tests/promos.test.ts. The server
 * validates again in POST /api/admin/promos — this is the first door, not the
 * only one.
 */
const PROMO_KINDS = ["percent", "fixed", "free_shipping"] as const;
const PROMO_CODE_RE = /^[A-Z0-9-]{1,24}$/;

/** An ISO date the model wrote, or null. Anything unparseable is dropped. */
function promoDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return null;
  // a code that expired before it was made is a mistake, not an instruction
  if (d.getTime() < Date.now() - 365 * 24 * 3600_000) return null;
  return d.toISOString();
}

export function sanitizePromo(raw: unknown): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;

  const code = String(x.code ?? "").toUpperCase().replace(/\s+/g, "");
  if (!PROMO_CODE_RE.test(code) || !/[A-Z0-9]/.test(code)) return null;

  const kind = (PROMO_KINDS as readonly string[]).includes(String(x.kind))
    ? (String(x.kind) as (typeof PROMO_KINDS)[number])
    : "percent";

  let value = 0;
  if (kind === "percent") {
    const n = Math.round(Number(x.value));
    if (!Number.isFinite(n) || n < 1 || n > 90) return null;
    value = n;
  } else if (kind === "fixed") {
    const n = Math.round(Number(x.value) * 100) / 100;
    if (!Number.isFinite(n) || !(n > 0) || n > 200) return null;
    value = n;
  }

  const minRaw = Math.round(Number(x.minSubtotal ?? 0) * 100) / 100;
  const minSubtotal = Number.isFinite(minRaw) && minRaw >= 0 && minRaw <= 10_000 ? minRaw : 0;

  const usesRaw = Math.trunc(Number(x.maxUses));
  const maxUses = Number.isFinite(usesRaw) && usesRaw >= 1 && usesRaw <= 1_000_000 ? usesRaw : null;

  const startsAt = promoDate(x.startsAt);
  const endsAt = promoDate(x.endsAt);
  // an end before the start is nonsense; keep the start and drop the end
  const ends = startsAt && endsAt && new Date(endsAt) <= new Date(startsAt) ? null : endsAt;

  const note = typeof x.note === "string" ? x.note.replace(/\s+/g, " ").trim().slice(0, 200) : "";

  return {
    code,
    kind,
    value,
    minSubtotal,
    startsAt,
    endsAt: ends,
    maxUses,
    active: x.active !== false,
    note,
  };
}

/* ---- delivery prices (set_shipping_rules) ------------------------------- */

/** The countries the checkout offers, plus "default" for everything else. */
const SHIP_COUNTRIES = ["EE", "LV", "LT", "FI", "EU"];
const SHIP_METHODS = ["parcel", "courier", "pickup"] as const;
const SHIP_CARRIERS = ["omniva", "smartpost", "dpd", "venipak"];

/** 0–99 €, two decimals. A price outside that is a typo, not a tariff. */
function shipPrice(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 99) return null;
  return Math.round(n * 100) / 100;
}

/**
 * A PARTIAL rules patch — «сделай доставку в Латвию 6,90» must not wipe the
 * other eleven prices. Only the keys the model actually named come back, and
 * every one of them is a known method, a known country and a number in range;
 * the storefront merges the patch over what it already has.
 */
export function sanitizeShippingRules(raw: unknown): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (x.freeFrom === null) out.freeFrom = null;
  else if (x.freeFrom !== undefined) {
    const n = typeof x.freeFrom === "number" ? x.freeFrom : Number(String(x.freeFrom).replace(",", "."));
    if (Number.isFinite(n) && n >= 0 && n <= 10_000) out.freeFrom = Math.round(n * 100) / 100;
  }

  if (x.freeFromByCountry && typeof x.freeFromByCountry === "object" && !Array.isArray(x.freeFromByCountry)) {
    const by: Record<string, number | null> = {};
    for (const [c, v] of Object.entries(x.freeFromByCountry as Record<string, unknown>)) {
      const country = c.toUpperCase();
      if (!SHIP_COUNTRIES.includes(country)) continue;
      if (v === null) { by[country] = null; continue; }
      const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
      if (Number.isFinite(n) && n >= 0 && n <= 10_000) by[country] = Math.round(n * 100) / 100;
    }
    if (Object.keys(by).length) out.freeFromByCountry = by;
  }

  if (x.methods && typeof x.methods === "object" && !Array.isArray(x.methods)) {
    const methods: Record<string, Record<string, number>> = {};
    for (const m of SHIP_METHODS) {
      const table: unknown = (x.methods as Record<string, unknown>)[m];
      if (!table || typeof table !== "object" || Array.isArray(table)) continue;
      const row: Record<string, number> = {};
      for (const [c, v] of Object.entries(table as Record<string, unknown>) as Array<[string, unknown]>) {
        const key: string = c === "default" ? "default" : c.toUpperCase();
        if (key !== "default" && !SHIP_COUNTRIES.includes(key)) continue;
        const p = shipPrice(v);
        if (p !== null) row[key] = p;
      }
      if (Object.keys(row).length) methods[m] = row;
    }
    if (Object.keys(methods).length) out.methods = methods;
  }

  if (x.carriers && typeof x.carriers === "object" && !Array.isArray(x.carriers)) {
    const carriers: Record<string, Record<string, number>> = {};
    for (const [name, table] of Object.entries(x.carriers as Record<string, unknown>)) {
      const carrier = name.toLowerCase();
      if (!SHIP_CARRIERS.includes(carrier)) continue;
      if (!table || typeof table !== "object" || Array.isArray(table)) continue;
      const row: Record<string, number> = {};
      for (const [c, v] of Object.entries(table as Record<string, unknown>)) {
        const key = c === "default" ? "default" : c.toUpperCase();
        if (key !== "default" && !SHIP_COUNTRIES.includes(key)) continue;
        const p = shipPrice(v);
        if (p !== null) row[key] = p;
      }
      if (Object.keys(row).length) carriers[carrier] = row;
    }
    if (Object.keys(carriers).length) out.carriers = carriers;
  }

  return Object.keys(out).length ? out : null;
}

/* ---- blog posts (draft_post, publish_post) ------------------------------
 *
 * Mirrors the shape @/lib/blog's upsertPost() cleans again server-side in
 * POST /api/admin/blog — this is the first door, not the only one. The body
 * cap here (6000/language) is the assistant's own ceiling, tighter than what
 * a human typing in the editor is allowed (20 000, see db/migrations/070):
 * a model that free-writes an article should not be able to fill the page
 * with output nobody asked it to keep going on.
 */
const BLOG_LANGS = ["RU", "ET", "EN"] as const;
const BLOG_TITLE_MAX = 200;
const BLOG_EXCERPT_MAX = 500;
const BLOG_BODY_MAX = 6000;
const BLOG_TAG_MAX = 30;
const BLOG_TAGS_MAX = 12;
const BLOG_PRODUCTS_MAX = 12;
/* The Google snippet: what @/lib/blog stores per language (upsertPost caps
   seoTitle at 70 and seoDesc at 170); the prompt asks the model for 60/155,
   the same margin the editor's own boxes leave. */
const BLOG_SEO_TITLE_MAX = 70;
const BLOG_SEO_DESC_MAX = 170;

function blogTrilingual(raw: unknown, max: number): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const lang of BLOG_LANGS) {
    const v = src[lang];
    if (typeof v !== "string") continue;
    const t = v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
    if (t) out[lang] = t;
  }
  return out;
}

function blogList(raw: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const t = v.replace(/\s+/g, " ").trim().slice(0, maxLen);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** A post the assistant cannot even name in Russian is not a draft. */
export function sanitizeDraftPost(raw: unknown, known: Set<string>): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const title = blogTrilingual(x.title, BLOG_TITLE_MAX);
  if (!title.RU) return null;
  /* The Google snippet the model writes with the article —
     {"title":{RU,ET,EN},"description":{RU,ET,EN}} — becomes the post's own
     seoTitle/seoDesc when the owner applies the draft (applyBlogAction() in
     public/shop2/app.js): the same per-language pair the blog editor's
     «Заполнить автоматически» fills. Nothing sent, or nothing left after
     cleaning → no `seo` key at all, and the post falls back to its title and
     excerpt the way an untouched editor draft does. */
  const seoRaw = (x.seo && typeof x.seo === "object" && !Array.isArray(x.seo) ? x.seo : {}) as Record<string, unknown>;
  const seoTitle = blogTrilingual(seoRaw.title ?? x.seoTitle, BLOG_SEO_TITLE_MAX);
  const seoDesc = blogTrilingual(seoRaw.description ?? x.seoDesc, BLOG_SEO_DESC_MAX);
  const seo = Object.keys(seoTitle).length || Object.keys(seoDesc).length
    ? { title: seoTitle, description: seoDesc }
    : null;
  return {
    title,
    excerpt: blogTrilingual(x.excerpt, BLOG_EXCERPT_MAX),
    body: blogTrilingual(x.body, BLOG_BODY_MAX),
    tags: blogList(x.tags, BLOG_TAGS_MAX, BLOG_TAG_MAX),
    products: blogList(x.products, BLOG_PRODUCTS_MAX, 80).filter((id) => known.has(id)),
    ...(seo ? { seo } : {}),
  };
}

const BLOG_SLUG_RE = /^[a-z0-9-]{1,80}$/;
export function sanitizePublishPost(raw: unknown): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const slug = typeof x.slug === "string" ? x.slug.trim().toLowerCase() : "";
  if (!BLOG_SLUG_RE.test(slug) || typeof x.publish !== "boolean") return null;
  return { slug, publish: x.publish };
}

/* ---- product creation (create_product) ----------------------------------
 *
 * The one action that makes a product the catalogue file does not have. The
 * bounds mirror src/lib/custom-products.ts (PRODUCT_CATS, 1–500 €, twelve
 * sizes) — duplicated on purpose, this file stays free of database imports;
 * tests/custom-products.test.ts checks the two agree. The route behind
 * «Применить» (POST /api/admin/products) validates again — this is the
 * first door, not the only one.
 */
const PRODUCT_CATS = ["hair", "styling", "beard", "face", "body", "perfume", "merch"];
const PRODUCT_PRICE = [1, 500] as const;
const PRODUCT_MAX_SIZES = 12;

function productPrice(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim().replace(",", "."));
  if (!Number.isFinite(n) || n < PRODUCT_PRICE[0] || n > PRODUCT_PRICE[1]) return null;
  return Math.round(n * 100) / 100;
}

/**
 * {brand, name, cat, price?, sizes?: [{size, price}] | [string], description?}
 * → {brand, name, cat, price, sizes: string[], prices: number[], description}.
 * Sizes without a price of their own take the product's; a product with
 * neither a price nor priced sizes is not a product.
 */
export function sanitizeCreateProduct(raw: unknown): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const clean = (v: unknown, max: number) =>
    typeof v === "string" ? v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  const brand = clean(x.brand, 60);
  const name = clean(x.name, 120);
  const cat = clean(x.cat ?? x.category, 20).toLowerCase();
  if (!brand || !name || !PRODUCT_CATS.includes(cat)) return null;

  const price = productPrice(x.price);
  const sizes: string[] = [];
  const prices: number[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(x.sizes) ? x.sizes.slice(0, PRODUCT_MAX_SIZES) : []) {
    const o = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
    const label = clean(o ? (o.size ?? o.label ?? o.name) : item, 30);
    if (!label || seen.has(label.toLowerCase())) continue;
    const own = o && o.price !== undefined ? productPrice(o.price) : null;
    const p = own ?? price;
    if (p === null) continue; // a size nobody priced is dropped, not guessed
    seen.add(label.toLowerCase());
    sizes.push(label);
    prices.push(p);
  }
  if (!sizes.length && price === null) return null;

  const description = blogTrilingual(x.description, 4000);
  return {
    brand,
    name,
    cat,
    price: sizes.length ? prices[0] : price,
    sizes,
    prices: sizes.length ? prices : [price as number],
    description: Object.keys(description).length ? description : null,
  };
}

/* ---- wholesale/loyalty (set_pricing, adjust_points) ---------------------
 *
 * Bounds are duplicated from src/lib/loyalty.ts PRICING_BOUNDS on purpose —
 * same reasoning as PROMO_MAX_* above: this file stays free of database
 * imports so its tests run as pure functions. tests/loyalty.test.ts checks
 * the two copies agree.
 */
const PRICING_BOUNDS = {
  proDiscountPct: [0, 90] as const,
  proMinOrder: [0, 100_000] as const,
  earnPct: [0, 50] as const,
  redeemMaxPct: [0, 100] as const,
  minRedeem: [0, 10_000] as const,
};
function inRange(v: unknown, [lo, hi]: readonly [number, number]): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

/**
 * A PARTIAL patch — «подними скидку для салонов до 25 %» must not silently
 * reset the loyalty rates. The panel (demoApply's set_pricing case,
 * public/shop2/app.js) merges this over what it already has, and
 * PUT /api/admin/settings clamps again on the way into the database
 * (cleanPricing() in src/lib/loyalty.ts) — this is the first door, not the
 * only one.
 */
export function sanitizePricing(raw: unknown): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  const pct = inRange(x.proDiscountPct, PRICING_BOUNDS.proDiscountPct);
  if (pct !== null) out.proDiscountPct = pct;
  const min = inRange(x.proMinOrder, PRICING_BOUNDS.proMinOrder);
  if (min !== null) out.proMinOrder = min;

  if (x.loyalty && typeof x.loyalty === "object" && !Array.isArray(x.loyalty)) {
    const l = x.loyalty as Record<string, unknown>;
    const loyalty: Record<string, unknown> = {};
    if (typeof l.enabled === "boolean") loyalty.enabled = l.enabled;
    const earn = inRange(l.earnPct, PRICING_BOUNDS.earnPct);
    if (earn !== null) loyalty.earnPct = earn;
    const redeemMax = inRange(l.redeemMaxPct, PRICING_BOUNDS.redeemMaxPct);
    if (redeemMax !== null) loyalty.redeemMaxPct = redeemMax;
    const minRedeem = inRange(l.minRedeem, PRICING_BOUNDS.minRedeem);
    if (minRedeem !== null) loyalty.minRedeem = minRedeem;
    if (Object.keys(loyalty).length) out.loyalty = loyalty;
  }

  return Object.keys(out).length ? out : null;
}

const CUSTOMER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// integration: format check only — duplicated from customers.ts's EMAIL_RE on
// purpose, same reasoning as CUSTOMER_ID_RE duplicating loyalty.ts's UUID_RE:
// this file stays free of database imports. The real resolution (and the
// only place an unknown address is rejected) is getCustomerAdminByEmail() in
// src/lib/loyalty.ts, called from the customers/[id] route.
const CUSTOMER_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/**
 * A manual credit or correction to one customer's point balance — reachable
 * once the panel is looking at that customer's card (customerId, the uuid it
 * already has) OR once the owner has named the customer by e-mail in the
 * conversation (customerEmail — the one identifier a model can plausibly
 * know without the card being open; resolved to a row server-side, see the
 * customers/[id] route). Exactly one of the two travels in the sanitised
 * action, never both.
 */
export function sanitizePointsAdjust(raw: unknown): object | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const customerId = typeof x.customerId === "string" ? x.customerId.trim() : "";
  const emailRaw = typeof x.customerEmail === "string" ? x.customerEmail : typeof x.customer_email === "string" ? x.customer_email : "";
  const customerEmail = emailRaw.trim().toLowerCase().slice(0, 160);
  const hasId = CUSTOMER_ID_RE.test(customerId);
  const hasEmail = !hasId && CUSTOMER_EMAIL_RE.test(customerEmail);
  if (!hasId && !hasEmail) return null;
  const delta = Math.trunc(Number(x.delta));
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 100_000) return null;
  const note = typeof x.note === "string" ? x.note.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  return hasId ? { customerId, delta, note } : { customerEmail, delta, note };
}

/* ---- everything the assistant may propose ------------------------------- */

export function sanitizeAction(a: unknown, known: Set<string>, isAdmin: boolean): object | null {
  if (!a || typeof a !== "object") return null;
  const x = a as Record<string, unknown>;
  const t = x.type;
  if (!isAdmin) {
    if (t === "add_to_cart") {
      const ids2 = Array.isArray(x.ids) ? x.ids.filter((i): i is string => typeof i === "string" && known.has(i)).slice(0, 5) : [];
      if (!ids2.length) return null;
      const then = x.then === "checkout" || x.then === "open_cart" ? x.then : undefined;
      return then ? { type: t, ids: ids2, then } : { type: t, ids: ids2 };
    }
    if (t === "open_product" && typeof x.id === "string" && known.has(x.id)) return { type: t, id: x.id };
    if (t === "open_category" && typeof x.id === "string" && CATEGORIES.includes(x.id)) return { type: t, id: x.id };
    if (t === "open_cart" || t === "checkout") return { type: t };
    return null;
  }
  if (t === "set_price" && typeof x.id === "string" && known.has(x.id) && typeof x.value === "number" && x.value >= 1 && x.value <= 500) {
    return { type: t, id: x.id, value: Math.round(x.value * 100) / 100 };
  }
  if (t === "set_stock" && typeof x.id === "string" && known.has(x.id) && (x.value === "in" || x.value === "low" || x.value === "out")) {
    return { type: t, id: x.id, value: x.value };
  }
  if (t === "set_seo" && typeof x.id === "string" && known.has(x.id)) {
    // the same one-line, 70/170 shape src/lib/product-seo.ts stores — a
    // snippet, not a paragraph, and nothing a <title> cannot carry
    const title = oneLine(x.title, 70);
    const description = oneLine(x.description, 170);
    if (!title && !description) return null;
    return { type: t, id: x.id, title, description };
  }
  if (t === "toggle_flow" && typeof x.id === "string" && ["abandoned", "birthday", "backstock"].includes(x.id) && typeof x.value === "boolean") {
    return { type: t, id: x.id, value: x.value };
  }
  if (t === "toggle_chatbot" && typeof x.value === "boolean") {
    return { type: t, value: x.value };
  }
  if (t === "toggle_bundles" && typeof x.value === "boolean") {
    return { type: t, value: x.value };
  }
  if (t === "set_hero") {
    // null is «вернуть стандартный баннер» — a real thing the owner asks for
    if (x.value === null) return { type: t, value: null };
    const hero = sanitizeHero(x.value, known);
    return hero ? { type: t, value: hero } : null;
  }
  if (t === "create_promo") {
    const promo = sanitizePromo(x.promo ?? x.value ?? x);
    return promo ? { type: t, promo } : null;
  }
  if (t === "toggle_promo" && typeof x.value === "boolean") {
    const code = String(x.code ?? "").toUpperCase().replace(/\s+/g, "");
    if (!PROMO_CODE_RE.test(code) || !/[A-Z0-9]/.test(code)) return null;
    return { type: t, code, value: x.value };
  }
  if (t === "set_shipping_rules") {
    const rules = sanitizeShippingRules(x.rules ?? x.value);
    return rules ? { type: t, rules } : null;
  }
  /* The shop's own details — company, hours, socials, announcement bar,
     contact page, letter footer. A PATCH, not a document: «поменяй телефон»
     sends only the phone, and everything else keeps the value it had. The
     rebuild-field-by-field sanitiser lives in @/lib/content so the panel and
     this route can never disagree about what is allowed. */
  if (t === "set_content") {
    const patch = sanitizeContentPatch(x.value ?? x.content);
    return patch ? { type: t, value: patch } : null;
  }
  // blog: no demo layer to write into, so the panel calls the admin API
  // directly once the owner clicks «Применить» — see applyBlogAction() in
  // public/shop2/app.js. Both still go through the same confirm-first flow.
  if (t === "draft_post") {
    const post = sanitizeDraftPost(x, known);
    return post ? { type: t, ...post } : null;
  }
  if (t === "publish_post") {
    const pub = sanitizePublishPost(x);
    return pub ? { type: t, ...pub } : null;
  }
  // assistant-work: the accountant export — «выгрузи отчёт за август» hands
  // back a month, the panel turns it into a download link
  // (GET /api/admin/reports/orders?month=…) rather than a demoApply/undo
  // change, so this is the whole of the sanitising this action needs.
  if (t === "export_report") {
    const month = String(x.month ?? "").trim();
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? { type: t, month } : null;
  }
  // wholesale/loyalty: pro discount, loyalty rates, on/off («подними скидку
  // для салонов до 25 %», «выключи баллы»); adjust_points is a manual credit
  // on one customer's card, only ever proposed once the panel has an id.
  if (t === "set_pricing") {
    const pricing = sanitizePricing(x.value ?? x);
    return pricing ? { type: t, value: pricing } : null;
  }
  if (t === "adjust_points") {
    const adj = sanitizePointsAdjust(x);
    return adj ? { type: t, ...adj } : null;
  }
  /* inventory: numeric stock, always variant-aware. stock_adjust is a
     relative move («приход 6 штук масла Proraso» → delta +6, reason
     'goods_in'); stock_set is an absolute «останется 10 штук». Both are
     admin-only and applied straight through POST /api/admin/inventory/moves/
     (applyStockAction() in public/shop2/app.js) — no demo layer, same story
     as the blog posts above. reason is deliberately NOT the full move-reason
     set: 'sale_web'/'sale_pos' are what a real web or till sale writes on
     its own, and letting the assistant claim one from a chat message risks
     a manual adjustment double-counting as a sale in the ledger. */
  if (t === "stock_adjust" && typeof x.product_id === "string" && known.has(x.product_id)) {
    const delta = Math.trunc(Number(x.delta));
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 10_000) return null;
    const reason = (STOCK_ADJUST_REASONS as readonly string[]).includes(String(x.reason)) ? String(x.reason) : "adjust";
    const variant = oneLine(x.variant, 120);
    return { type: t, product_id: x.product_id, variant, delta, reason };
  }
  if (t === "stock_set" && typeof x.product_id === "string" && known.has(x.product_id)) {
    const qty = Math.trunc(Number(x.qty));
    if (!Number.isFinite(qty) || qty < 0 || qty > 100_000) return null;
    const variant = oneLine(x.variant, 120);
    return { type: t, product_id: x.product_id, variant, qty };
  }
  /* product creation: a new row in custom_products — no demo layer, the
     panel POSTs it to /api/admin/products once the owner confirms and opens
     the editor on «Фото и видео» (applyCreateProduct() in app.js); the undo
     is «снять с продажи». */
  if (t === "create_product") {
    const product = sanitizeCreateProduct(x);
    return product ? { type: t, ...product } : null;
  }
  return null;
}

/* ---- what the panel tells the model about the banner it already has ----- */

type HeroBrief = { id: string; title: string; go: string; image: string; on: boolean };

/**
 * The storefront posts its current banner along with the question, so «поменяй
 * второй слайд» has something to point at. It is the owner's own text coming
 * back through the browser, and it lands inside a prompt — so it is trimmed
 * hard and stripped of anything that could be read as structure.
 */
export function briefHero(raw: unknown): HeroBrief[] {
  if (!Array.isArray(raw)) return [];
  const clean = (v: unknown, max: number) =>
    typeof v === "string" ? v.replace(/[`\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  return raw.slice(0, HERO_MAX_SLIDES).map((s, i) => {
    const row = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    return {
      id: clean(row.id, 24) || `s${i + 1}`,
      title: clean(row.title, 60),
      go: clean(row.go, 80),
      image: clean(row.image, 300),
      on: row.on !== false,
    };
  });
}

/* ---- analytics agent: what the panel tells the model about sales -------- */

export type AnalyticsBrief = {
  revenue: number;
  orders: number;
  aov: number;
  conversionPct: number;
  topProducts: Array<{ name: string; brand: string; revenue: number }>;
  topSearchTerms: Array<{ term: string; count: number }>;
};

/**
 * analyticsForAI() in app.js posts a 30-day summary along with the owner's
 * question — «сколько продали за неделю» needs numbers to answer from. It is
 * plain figures the panel itself fetched from GET /api/admin/analytics, not
 * anything the owner typed, so there is nothing here worth sanitising the way
 * briefHero() does for free-form text; this only re-shapes and bounds it, the
 * same defensive distance every other body field gets before it reaches a
 * prompt.
 */
export function briefAnalytics(raw: unknown): AnalyticsBrief | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const clean = (v: unknown, max: number) =>
    typeof v === "string" ? v.replace(/[`\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

  const products = Array.isArray(x.topProducts) ? x.topProducts.slice(0, 5) : [];
  const terms = Array.isArray(x.topSearchTerms) ? x.topSearchTerms.slice(0, 5) : [];
  return {
    revenue: n(x.revenue),
    orders: n(x.orders),
    aov: n(x.aov),
    conversionPct: n(x.conversionPct),
    topProducts: products.map((p) => {
      const row = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      return { name: clean(row.name, 80), brand: clean(row.brand, 40), revenue: n(row.revenue) };
    }),
    topSearchTerms: terms.map((t) => {
      const row = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
      return { term: clean(row.term, 60), count: n(row.count) };
    }),
  };
}
