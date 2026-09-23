/**
 * The Google Merchant Center product feed — RSS 2.0 with the `g:` namespace,
 * one per language, answered live by /feed/google-<en|et|ru>.xml
 * (src/app/feed/[file]/route.ts). The owner's guide is docs/merchant-feed.md.
 *
 * Why it exists: Merchant Center account 5819586565 earns ~175 free clicks a
 * month from six Shopify App API sources, and those stop updating the day
 * rempireshop.com points at this shop. This is what is added beside them on
 * that day (and what replaces them once Google has approved it).
 *
 * The rule for every field is the same one: **say what the shop says**. A
 * feed that disagrees with the product page or the checkout is the commonest
 * way a Merchant Center account gets suspended, so nothing here computes a
 * number of its own — every value comes from the function the shop already
 * uses for it:
 *
 *   price         priceItems() in src/lib/orders.ts, restated as rungsOf()
 *                 below: the owner's saved ladder first, else the file's
 *                 ladder shifted by his «Цена», else the file. Per SIZE — a
 *                 product sold in 75/250/500 мл is three items grouped by
 *                 g:item_group_id. tests/merchant-feed.test.ts prices every
 *                 item through priceItems() itself and compares.
 *   availability  the stock word getOverrides() folds (manual word, then the
 *                 counted shelf), and per size `stockByVariant` — a size
 *                 counted to zero is refused at the checkout, so it is
 *                 out_of_stock here while its siblings are in stock.
 *   hidden        «Показывать в магазине» off (product_overrides.hidden) and
 *                 a switched-off custom product: absent, like the sitemap.
 *   shipping      quoteFromRules() over the stored settings.shipping_rules —
 *                 the very call the checkout bills with — for every country
 *                 the checkout offers, per item, with the item's own price as
 *                 the basket: a bottle that reaches a country's free-delivery
 *                 threshold ships at 0 there. See shippingFor().
 *   title/text    the storefront's own name (translateProductName, the
 *                 server port of trName() in app.js) and its description:
 *                 the owner's override for the language, else the static
 *                 content*.js text (src/data/catalogue.feed.json), else the
 *                 English one — descFor() in app.js, in that order.
 *   images        the owner's uploaded gallery, else the file's photos; the
 *                 size's own photo (varImg) first.
 *   gtin          the barcode Renat bound to that size in «Склад»
 *                 (stock_levels.ean), when it is a real GTIN with a valid
 *                 check digit. See validGtin().
 *
 * Prices include Estonian VAT (24 %), exactly as the shop shows them; EU
 * feeds carry VAT-inclusive prices and no g:tax. There is no sale price: the
 * shop has none — every product has one price, and a promotion is a code at
 * the checkout.
 *
 * The links point at the production origin whatever deployment answers
 * (liveBaseFrom() in src/lib/seo-head.mjs): a copy fetched from staging must
 * not hand Google a staging address.
 */
import { createHash } from "node:crypto";
import catalogueMin from "@/data/catalogue.min.json";
import catalogueFeed from "@/data/catalogue.feed.json";
import variantData from "@/data/catalogue.variants.json";
import { listCustomProducts, type CustomProduct } from "@/lib/custom-products";
import { query } from "@/lib/db";
import { getOverrides, overrideLadder, type Override } from "@/lib/orders";
import { getDescriptionOverrides, type DescriptionOverride } from "@/lib/product-descriptions";
import { translateProductName, translateVariant } from "@/lib/product-name";
import {
  countryOff,
  DEFAULT_SHIPPING_RULES,
  EUROPE,
  loadShippingRules,
  pickupOffered,
  quoteFromRules,
  type ShippingRules,
} from "@/lib/shipping";
import { offeredCarriers } from "@/lib/shipping/country-prices";
import { catName, clip, LANGS, langPath, liveBaseFrom, merchantText, T } from "@/lib/seo-head.mjs";

/* ---------- the three feeds --------------------------------------------- */

export type FeedLang = "EN" | "ET" | "RU";

/** The file name each feed answers at — what the owner pastes into Merchant Center. */
export const FEED_FILES: Readonly<Record<string, FeedLang>> = {
  "google-en.xml": "EN",
  "google-et.xml": "ET",
  "google-ru.xml": "RU",
};

/** The language a requested file name stands for, or null — an own-property lookup, so «constructor» is not a feed. */
export function feedLangOf(file: unknown): FeedLang | null {
  const f = String(file ?? "");
  return Object.prototype.hasOwnProperty.call(FEED_FILES, f) ? FEED_FILES[f] : null;
}

/** Where the feed's links point: the live origin, whatever deployment is answering. */
export const feedBase = (env: string | undefined): string => liveBaseFrom(env);

/* ---------- the data ---------------------------------------------------- */

type StockState = "in" | "low" | "out";
type MinProduct = { id: string; b: string; n: string; c: string; p: number; s: string };
type Ladder = { sizes: string[]; prices: number[] };
type FeedRow = { img: string[]; vi?: number[]; d: Partial<Record<FeedLang, string>> };

const CATALOGUE = catalogueMin as MinProduct[];
const VARIANTS = variantData as Record<string, Ladder>;
const FEED_DATA = catalogueFeed as Record<string, FeedRow>;

/** Everything the feed reads, gathered once per request by loadFeedInput(). */
export type FeedInput = {
  /** getOverrides(): price, stock, hidden, sizes, gallery, varImg, stockByVariant. */
  overrides: Record<string, Override>;
  /** product_overrides.description {RU,ET,EN} — the owner's own text. */
  descriptions: Record<string, DescriptionOverride>;
  /** The owner's own products, active ones only. */
  custom: CustomProduct[];
  /** stock_levels.ean by product and size label ('' for no size). */
  eans: Record<string, Record<string, string>>;
  /** settings.shipping_rules as the checkout reads it. */
  rules: ShippingRules;
};

/** Is a database configured at all? Without one the feed is the files' own — a local preview. */
function hasDatabase(): boolean {
  return !!process.env.DATABASE_URL || process.env.DB_DRIVER === "pglite";
}

async function loadEans(): Promise<Record<string, Record<string, string>>> {
  const rows = await query<{ product_id: string; variant: string | null; ean: string | null }>(
    "select product_id, variant, ean from stock_levels where ean is not null",
  );
  const out: Record<string, Record<string, string>> = {};
  for (const r of rows) {
    if (!r.ean) continue;
    (out[r.product_id] ??= {})[String(r.variant ?? "").trim()] = String(r.ean);
  }
  return out;
}

/**
 * The live half of the feed. Throws when the database is configured but does
 * not answer — and the route turns that into a 503, deliberately, rather than
 * a feed built from the files alone. Merchant Center keeps the items of its
 * last good fetch when a fetch fails and retries later; a feed that silently
 * lost the owner's hidden switches, his prices and the counted stock would be
 * accepted as the truth and re-publish all of it. A missing answer is safer
 * than a wrong one here.
 */
export async function loadFeedInput(): Promise<FeedInput> {
  if (!hasDatabase()) {
    return { overrides: {}, descriptions: {}, custom: [], eans: {}, rules: DEFAULT_SHIPPING_RULES };
  }
  const [overrides, descriptions, custom, eans, rules] = await Promise.all([
    getOverrides(),
    getDescriptionOverrides(),
    listCustomProducts({ activeOnly: true }),
    loadEans(),
    loadShippingRules(),
  ]);
  return { overrides, descriptions, custom, eans, rules: rules ?? DEFAULT_SHIPPING_RULES };
}

/* ---------- small helpers ----------------------------------------------- */

function money(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : NaN;
}
const eurText = (n: number) => money(n).toFixed(2) + " EUR";

/* XML 1.0 has no place for most control characters, however they got into a
   text — an owner's paste, a mangled import. They go; everything else is
   escaped as text. The class is built from char codes, not typed: a raw NUL
   or U+FFFE in a source file makes grep call it binary and find nothing in
   it (the trap src/lib/og-card.ts once set), and this file must stay
   searchable. CYRILLIC below is built the same way, so its range reads as
   the numbers it is (U+0400–U+04FF). */
const XML_INVALID = new RegExp(
  "[" + String.fromCharCode(0x0) + "-" + String.fromCharCode(0x8) + String.fromCharCode(0xb) + String.fromCharCode(0xc) +
    String.fromCharCode(0xe) + "-" + String.fromCharCode(0x1f) + String.fromCharCode(0xfffe) + String.fromCharCode(0xffff) + "]",
  "g",
);
function xmlText(s: unknown): string {
  return String(s ?? "")
    .replace(XML_INVALID, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
const el = (tag: string, value: unknown) => `<${tag}>${xmlText(value)}</${tag}>`;

function absUrl(base: string, u: string): string {
  return /^https?:\/\//i.test(u) ? u : base + (u.startsWith("/") ? u : "/" + u);
}

/** Merchant Center reads JPEG, PNG, GIF, BMP, TIFF and WebP — never SVG (a custom product's placeholder tower is one). */
const usableImage = (u: string) => !!u && !/\.svg(\?|#|$)/i.test(u);

/* ---------- ids --------------------------------------------------------- */

/** Merchant Center refuses an id (and an item_group_id) over 50 characters. */
export const MAX_ID = 50;

/** «250 мл» → «250ml», «white / S» → «white-s», «7,5 мл» → «7-5ml». */
export function sizeSlug(label: string): string {
  return String(label)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/мл/g, "ml")
    .replace(/г/g, "g")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const hash8 = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 8);

/**
 * The product half of every Merchant Center id for one product: the product
 * id itself, or — when it, or it with its longest size, would pass the 50
 * characters Google takes (22 catalogue ids do) — its start and 8 characters
 * of a hash of the whole id. Readable, the same every day, never two products
 * on one stem, and the same stem for the group and all its sizes.
 */
export function idStem(productId: string, longestSuffix = 0): string {
  if (productId.length + longestSuffix <= MAX_ID) return productId;
  const room = Math.max(8, MAX_ID - 9 - longestSuffix);
  return productId.slice(0, room).replace(/[-_]+$/, "") + "-" + hash8(productId);
}

/** One item's id: the stem, plus `_<size>` for one size of several («system-4-bio-botanical-shampoo_250ml»). */
export function merchantId(stem: string, slug?: string): string {
  const raw = slug ? stem + "_" + slug : stem;
  return raw.length <= MAX_ID ? raw : raw.slice(0, MAX_ID - 9).replace(/[-_]+$/, "") + "-" + hash8(raw);
}

/* ---------- identifiers ------------------------------------------------- */

/**
 * A barcode Merchant Center will take as a GTIN: 8, 12, 13 or 14 digits with
 * a valid check digit, and not from a range GS1 reserves for use inside one
 * company — the shop's own labels (prefix 2 on EAN-13, 02/04 on UPC, 0 or 2
 * on EAN-8) and coupons (98, 99). The scanner also binds internal codes with
 * letters in them (normEan() in src/lib/inventory.ts); those are not GTINs.
 */
export function validGtin(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\s+/g, "");
  if (!/^\d+$/.test(s) || ![8, 12, 13, 14].includes(s.length) || /^0+$/.test(s)) return null;
  const digits = s.split("").map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i] * w;
  if ((10 - (sum % 10)) % 10 !== check) return null;
  if (s.length === 8) return /^[02]/.test(s) ? null : s;
  const g13 = s.padStart(14, "0").slice(1);
  if (s.length === 14 && s[0] !== "0") return s; // a GTIN-14 with its own packaging indicator
  if (/^2/.test(g13) || /^0[24]/.test(g13) || /^9[89]/.test(g13)) return null;
  return s;
}

/** The shop's own brand: no manufacturer's barcode exists for it, so it is the one honest `identifier_exists=no`. */
const OWN_BRANDS = new Set(["rempire"]);

/* ---------- names, texts, categories ------------------------------------ */

const CYRILLIC = new RegExp("[" + String.fromCharCode(0x400) + "-" + String.fromCharCode(0x4ff) + "]");

/**
 * The product's name in the feed's language. Russian is the catalogue's own.
 * Estonian and English go through the storefront's translation of the type
 * tail («— шампунь» → «— shampoo»), and a tail it cannot translate is dropped
 * rather than printed in Russian — the storefront keeps «— скраб для лица» on
 * the English site, but a Russian word in an English feed is the kind of
 * mismatch Merchant Center flags. A name that is Russian through and through
 * («Чёрное мыло 666») has nothing to fall back on and stays as it is.
 */
export function feedName(name: string, lang: FeedLang): string {
  if (lang === "RU") return name;
  const parts = translateProductName(name, lang).split(" — ");
  while (parts.length > 1 && CYRILLIC.test(parts[parts.length - 1])) parts.pop();
  return parts.join(" — ").trim();
}

/** Google's own taxonomy, by the shop's section. Merch is apparel only when it comes in clothing sizes. */
const GOOGLE_CATEGORY: Record<string, string> = {
  hair: "Health & Beauty > Personal Care > Hair Care",
  styling: "Health & Beauty > Personal Care > Hair Care",
  beard: "Health & Beauty > Personal Care > Shaving & Grooming",
  face: "Health & Beauty > Personal Care > Cosmetics > Skin Care",
  body: "Health & Beauty > Personal Care > Cosmetics > Bath & Body",
  perfume: "Health & Beauty > Personal Care > Cosmetics > Perfume & Cologne",
};
const APPAREL_CATEGORY = "Apparel & Accessories > Clothing";

const CLOTHING_SIZE = /^(XXS|XS|S|M|L|XL|XXL|XXXL)(-(XXS|XS|S|M|L|XL|XXL|XXXL))?$/i;

/** A merch size as colour and size: «white / S», «yellow-1» (a colour), «S-M». Null for anything else. */
export function apparelOf(label: string): { color?: string; size?: string } | null {
  const s = String(label).trim();
  const both = /^([a-z]+)\s*\/\s*(\S+)$/i.exec(s);
  if (both && CLOTHING_SIZE.test(both[2])) return { color: both[1].toLowerCase(), size: both[2].toUpperCase() };
  const colour = /^([a-z]+)-\d+$/i.exec(s);
  if (colour) return { color: colour[1].toLowerCase() };
  if (CLOTHING_SIZE.test(s)) return { size: s.toUpperCase() };
  return null;
}

/** «250 мл» / «50 г» as a unit-pricing measure («250ml», «50g»); null for a size that is not a quantity. */
function unitMeasure(label: string): { measure: string; base: string } | null {
  const m = /^(\d+(?:[.,]\d+)?)\s*(мл|ml|г|g)$/i.exec(String(label).trim());
  if (!m) return null;
  const qty = m[1].replace(",", ".");
  const unit = /^(мл|ml)$/i.test(m[2]) ? "ml" : "g";
  return { measure: qty + unit, base: "100" + unit };
}

/** The owner's plain-text description (paragraphs split by blank lines) as feed text. */
function ownerText(t: string): string {
  const html = String(t)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => "<p>" + p.replace(/\n/g, " ") + "</p>")
    .join("");
  return merchantText(html);
}

/* ---------- shipping ---------------------------------------------------- */

/** The home rows the checkout lists first; the rest of Europe is the second select. */
const HOME_COUNTRIES = ["EE", "LV", "LT", "FI"] as const;

/**
 * Every country the checkout lets a shopper pick: Estonia, Latvia, Lithuania,
 * Finland, and «Другая страна Европы» with its list — minus the ones switched
 * off in «Настройки → Доставка» (seven by default: Montonio has no route to
 * them). A country the shop does not deliver to gets no g:shipping entry, so
 * Google does not show the product there.
 */
export function sellCountries(rules: ShippingRules): string[] {
  return [...HOME_COUNTRIES, ...[...EUROPE].sort()].filter((c) => !countryOff(rules, c));
}

const SERVICE: Record<FeedLang, { parcel: string; courier: string }> = {
  EN: { parcel: "Parcel locker", courier: "Courier" },
  ET: { parcel: "Pakiautomaat", courier: "Kuller" },
  RU: { parcel: "Пакомат", courier: "Курьер" },
};

export type ShippingOption = { country: string; service: "parcel" | "courier"; price: number };

/**
 * What delivering ONE of this item costs, country by country — the cheapest
 * pickup point / locker and the cheapest courier the checkout would offer.
 *
 * Each price is quoteFromRules() over the checkout's own rules for one
 * carrier the shopper can tap (offeredCarriers(), the list the checkout
 * draws, in Montonio's order), with the item's price as the basket subtotal.
 * So a country's free-delivery threshold applies exactly as it would to a
 * basket holding just this item: 0 in Estonia for a 59 € bottle, 0 in
 * Germany from 200 €. A locker is only listed where the checkout offers one
 * (pickupOffered(): the mirror has a carrier there and the owner has not
 * switched it off).
 *
 * Per item rather than one table per account, because the free-delivery
 * threshold makes the price depend on the item; both services, because
 * Google shows the cheapest and a shopper who wants a courier should find
 * its price true too.
 */
export function shippingFor(price: number, rules: ShippingRules): ShippingOption[] {
  const out: ShippingOption[] = [];
  const cheapest = (country: string, method: "parcel" | "courier", carriers: string[]) => {
    const quotes = (carriers.length ? carriers : [undefined]).map(
      (carrier) => quoteFromRules(rules, { country, method, carrier, subtotal: price }).price,
    );
    return Math.min(...quotes);
  };
  for (const country of sellCountries(rules)) {
    if (pickupOffered(rules, country)) {
      const carriers = offeredCarriers(country, "parcel");
      if (carriers.length) out.push({ country, service: "parcel", price: cheapest(country, "parcel", carriers) });
    }
    out.push({ country, service: "courier", price: cheapest(country, "courier", offeredCarriers(country, "courier")) });
  }
  return out;
}

/* ---------- one product, as the feed sees it ----------------------------- */

type FeedProduct = {
  id: string;
  brand: string;
  name: string;
  cat: string;
  /** The price priceItems() shifts a ladder by: the file's `p`, or a custom row's first price. */
  basePrice: number;
  /** The stock word before any override: the file's, or «in» for a custom row. */
  fileStock: StockState;
  /** The size ladder before the owner's own: catalogue.variants.json, or a custom row's sizes. */
  ladder: Ladder | null;
  photos: string[];
  varImg: number[] | null;
  texts: Partial<Record<FeedLang, string>>;
  descOv: DescriptionOverride | null;
};

function catalogueProducts(descriptions: Record<string, DescriptionOverride>): FeedProduct[] {
  return CATALOGUE.map((p) => {
    const row = FEED_DATA[p.id];
    return {
      id: p.id,
      brand: p.b,
      name: p.n,
      cat: p.c,
      basePrice: p.p,
      fileStock: (["in", "low", "out"].includes(p.s) ? p.s : "in") as StockState,
      ladder: VARIANTS[p.id] ?? null,
      photos: row?.img ?? [],
      varImg: row?.vi ?? null,
      texts: row?.d ?? {},
      descOv: descriptions[p.id] ?? null,
    };
  });
}

function customProducts(rows: CustomProduct[]): FeedProduct[] {
  return rows
    .filter((r) => r.active)
    .map((r) => ({
      id: r.id,
      brand: r.brand,
      name: r.name,
      cat: r.cat,
      basePrice: r.prices[0],
      fileStock: "in" as StockState,
      ladder: r.sizes.length ? { sizes: r.sizes.slice(), prices: r.prices.slice() } : null,
      photos: (r.gallery ?? []).map((g) => g.url),
      varImg: null,
      texts: {},
      descOv: r.description,
    }));
}

type Rung = { label: string | null; price: number };

/**
 * The sizes a shopper can buy and what each costs — priceItems() in
 * src/lib/orders.ts, line for line:
 *   · the owner's saved ladder (product_overrides.sizes) is the whole truth
 *     where he has one, every rung at the price he typed;
 *   · otherwise the file's ladder (or a custom row's own), each size keeping
 *     its premium over the base when the owner has overridden «Цена»;
 *   · no ladder: the one price, overridden or not.
 * One exception is the storefront's, not the till's: a saved ladder of ONE
 * rung with no label is «один объём» — the product page offers no sizes at
 * all then (applyDemoOverrides() in app.js), so neither does the feed.
 */
function rungsOf(p: FeedProduct, o: Override | undefined): Rung[] {
  const own = overrideLadder(o);
  const single = !own && !!o?.sizes && o.sizes.length === 1 && !o.sizes[0].size;
  const ladder = own ?? (single ? null : p.ladder);
  if (!ladder || !ladder.sizes.length) {
    return [{ label: null, price: o?.price != null ? o.price : p.basePrice }];
  }
  return ladder.sizes.map((label, i) => {
    const v = num(ladder.prices[i]);
    let unit: number;
    if (own) unit = Number.isFinite(v) ? v : own.prices[0];
    else if (o?.price != null) unit = Number.isFinite(v) ? money(o.price + (v - p.basePrice)) : o.price;
    else unit = Number.isFinite(v) ? v : p.basePrice;
    return { label, price: money(unit) };
  });
}

/**
 * The photos the product page shows, and the per-size map into them — the
 * owner's upload replacing the file's, his size→photo map winning when it
 * fits the ladder, and anything pointing past the end falling back to the
 * main photo (applyDemoOverrides() in app.js does the same three things).
 */
function photosOf(p: FeedProduct, o: Override | undefined, rungCount: number): { photos: string[]; varImg: number[] } {
  const photos = (o?.gallery?.length ? o.gallery.map((g) => g.url) : p.photos).filter(Boolean);
  const map = o?.varImg && o.varImg.length === rungCount ? o.varImg : p.varImg ?? [];
  const varImg = Array.from({ length: rungCount }, (_, i) => {
    const x = Number(map[i]);
    return Number.isInteger(x) && x >= 0 && x < photos.length ? x : 0;
  });
  return { photos, varImg };
}

/* ---------- which items the feed carries, and their ids ------------------

   One pass, shared by the feed and by the checkout link Merchant Center
   builds from those ids (`/cart/<id>:<qty>`, resolveCartLink() below), so the
   two can never disagree about which product and which size an id means.
   The order matters: an id that collides takes a numbered suffix, and which
   one collides depends on what came before it — so the pass walks the
   products, skips the hidden and the unsellable ones, and hands out ids in
   exactly the order buildFeed() writes them. */

type PlannedRung = Rung & { index: number };
type PlannedProduct = {
  p: FeedProduct;
  o: Override | undefined;
  rungs: PlannedRung[];
  photos: string[];
  varImg: number[];
  usable: string[];
  group: boolean;
  stem: string;
  slugs: Array<string | undefined>;
  ids: string[];
};
type FeedPlan = { products: PlannedProduct[]; hidden: number; skippedNoImage: string[] };

function planFeed(products: FeedProduct[], overrides: Record<string, Override>): FeedPlan {
  const plan: FeedPlan = { products: [], hidden: 0, skippedNoImage: [] };
  const seen = new Set<string>();
  for (const p of products) {
    const o = overrides[p.id];
    if (o?.hidden) {
      plan.hidden++;
      continue;
    }
    const ladder = rungsOf(p, o);
    /* A size with no price the till could charge is not an offer. Its index
       is kept — it is what the per-size photo map is keyed by. */
    const rungs = ladder.map((r, index) => ({ ...r, index })).filter((r) => Number.isFinite(r.price) && r.price > 0);
    if (!rungs.length) continue;
    const { photos, varImg } = photosOf(p, o, ladder.length);
    const usable = photos.filter(usableImage);
    if (!usable.length) {
      plan.skippedNoImage.push(p.id);
      continue;
    }
    const group = rungs.length > 1;
    /* Every size's id suffix first, so the product's ids can share one stem. */
    const taken = new Set<string>();
    const slugs = rungs.map((r) => {
      if (!group) return undefined;
      let slug = (r.label && sizeSlug(r.label)) || "v" + (r.index + 1);
      if (taken.has(slug)) slug += "-" + (r.index + 1);
      taken.add(slug);
      return slug;
    });
    const stem = idStem(p.id, Math.max(0, ...slugs.map((s) => (s ? s.length + 1 : 0))));
    const ids = rungs.map((r, i) => {
      const slug = slugs[i];
      let id = merchantId(stem, slug);
      if (seen.has(id)) id = merchantId(stem, (slug ? slug + "-" : "v") + (r.index + 1));
      seen.add(id);
      return id;
    });
    plan.products.push({ p, o, rungs, photos, varImg, usable, group, stem, slugs, ids });
  }
  return plan;
}

/** One item of the feed, as the checkout link has to find it again. */
export type FeedOffer = {
  /** The Merchant Center id — g:id. */
  id: string;
  productId: string;
  /** The size label («250 мл»), null for a product sold in one size. */
  label: string | null;
  /** The size's position in the product's ladder — the cart line's `size`. */
  index: number;
  /** The `?size=` the item's g:link carries, "" when it carries none. */
  slug: string;
  price: number;
  available: boolean;
};

/** Every item the feed carries today, with its id — in the feed's own order. */
export function feedOffers(input: Pick<FeedInput, "overrides" | "descriptions" | "custom">): FeedOffer[] {
  const products = [...catalogueProducts(input.descriptions), ...customProducts(input.custom)];
  const out: FeedOffer[] = [];
  for (const pp of planFeed(products, input.overrides).products) {
    const word = (pp.o?.stock ?? pp.p.fileStock) as StockState;
    pp.rungs.forEach((r, i) => {
      const sizeOut = pp.o?.stockByVariant?.[r.label ?? ""] === "out";
      out.push({
        id: pp.ids[i],
        productId: pp.p.id,
        label: r.label,
        index: r.index,
        slug: pp.slugs[i] ?? "",
        price: r.price,
        available: word !== "out" && !sizeOut,
      });
    });
  }
  return out;
}

/* ---------- the feed ---------------------------------------------------- */

export type FeedStats = {
  products: number;
  items: number;
  groups: number;
  outOfStock: number;
  withGtin: number;
  identifierExistsNo: number;
  /** Branded items with no GTIN Merchant Center would accept — «limited performance» until Renat scans them. */
  missingGtin: number;
  hidden: number;
  /** Products left out because no photo Merchant Center can read exists for them. */
  skippedNoImage: string[];
  /** Items whose title is still in Russian in an English or Estonian feed. */
  cyrillicTitles: string[];
};

export type FeedOptions = FeedInput & { lang: FeedLang; base: string; now?: Date };

/** The whole feed for one language — pure: everything it reads is in `opts`. */
export function buildFeed(opts: FeedOptions): { xml: string; stats: FeedStats } {
  const { lang, base, overrides, rules } = opts;
  const t = T[lang];
  const seg = (LANGS as Array<{ code: string; seg: string }>).find((l) => l.code === lang)?.seg ?? "";
  const service = SERVICE[lang];
  const stats: FeedStats = {
    products: 0, items: 0, groups: 0, outOfStock: 0, withGtin: 0, identifierExistsNo: 0,
    missingGtin: 0, hidden: 0, skippedNoImage: [], cyrillicTitles: [],
  };

  /* Many items share a price, and the shipping block depends on nothing else. */
  const shipMemo = new Map<string, string>();
  const shippingXml = (price: number) => {
    const key = money(price).toFixed(2);
    let xml = shipMemo.get(key);
    if (xml === undefined) {
      xml = shippingFor(price, rules)
        .map((s) =>
          `<g:shipping><g:country>${s.country}</g:country><g:service>${xmlText(service[s.service])}</g:service>` +
          `<g:price>${eurText(s.price)}</g:price></g:shipping>`)
        .join("\n    ");
      shipMemo.set(key, xml);
    }
    return xml;
  };

  const items: string[] = [];
  const products = [...catalogueProducts(opts.descriptions), ...customProducts(opts.custom)];
  /* Which products, which sizes and which ids — planFeed(), the pass the
     checkout link (resolveCartLink) reads the same ids from. */
  const plan = planFeed(products, overrides);
  stats.hidden = plan.hidden;
  stats.skippedNoImage = plan.skippedNoImage;

  for (const { p, o, rungs, photos, varImg, usable, group, stem, slugs, ids } of plan.products) {
    stats.products++;

    const name = feedName(p.name, lang);
    const head = name.toLowerCase().startsWith(p.brand.toLowerCase() + " ") ? name : `${p.brand} ${name}`;
    const description = (() => {
      const own = p.descOv?.[lang]?.trim();
      if (own) return ownerText(own);
      const fromFile = p.texts[lang] ?? p.texts.EN;
      if (fromFile) return fromFile;
      const ownEn = p.descOv?.EN?.trim();
      if (ownEn) return ownerText(ownEn);
      return clip(`${head}. ${catName(p.cat, lang)}.`, 5000);
    })();
    const link = base + langPath(seg, "/p/" + encodeURIComponent(p.id) + "/");
    const word: StockState = (o?.stock ?? p.fileStock) as StockState;
    const apparel = p.cat === "merch" && rungs.some((r) => r.label && apparelOf(r.label));
    const category = apparel ? APPAREL_CATEGORY : GOOGLE_CATEGORY[p.cat];
    const own = OWN_BRANDS.has(p.brand.trim().toLowerCase());
    if (group) stats.groups++;

    rungs.forEach((r, i) => {
      /* ---- id ---- */
      const slug = slugs[i];
      const id = ids[i];

      /* ---- the facts ---- */
      const sizeText = r.label ? translateVariant(r.label, lang) : "";
      const title = clip(sizeText ? `${head}, ${sizeText}` : head, 150);
      if (lang !== "RU" && CYRILLIC.test(title)) stats.cyrillicTitles.push(id);
      const sizeOut = o?.stockByVariant?.[r.label ?? ""] === "out";
      const available = word !== "out" && !sizeOut;
      if (!available) stats.outOfStock++;
      const sizePhoto = photos[varImg[r.index]];
      const main = sizePhoto && usableImage(sizePhoto) ? sizePhoto : usable[0];
      const more = usable.filter((u) => u !== main).slice(0, 10);
      const gtin = validGtin(opts.eans[p.id]?.[r.label ?? ""]);

      const f: string[] = [
        el("g:id", id),
        el("g:title", title),
        el("g:description", description),
        /* each size opens on itself — sizeFromQuery() in public/shop2/app.js;
           one address for all sizes shows the first size's price to Google */
        el("g:link", slug ? `${link}?size=${encodeURIComponent(slug)}` : link),
        el("g:image_link", absUrl(base, main)),
        ...more.map((u) => el("g:additional_image_link", absUrl(base, u))),
        el("g:availability", available ? "in_stock" : "out_of_stock"),
        el("g:price", eurText(r.price)),
        el("g:brand", p.brand),
        el("g:condition", "new"),
      ];
      if (gtin) {
        f.push(el("g:gtin", gtin));
        stats.withGtin++;
      } else if (own) {
        f.push(el("g:identifier_exists", "no"));
        stats.identifierExistsNo++;
      } else {
        stats.missingGtin++;
      }
      if (category) f.push(el("g:google_product_category", category));
      const section = catName(p.cat, lang);
      if (section) f.push(el("g:product_type", section));
      if (group) f.push(el("g:item_group_id", stem));
      if (r.label) {
        const wear = apparel ? apparelOf(r.label) : null;
        if (wear) {
          if (wear.color) f.push(el("g:color", wear.color));
          if (wear.size) f.push(el("g:size", wear.size));
        } else {
          f.push(el("g:size", sizeText));
        }
        const unit = unitMeasure(r.label);
        if (unit) {
          f.push(el("g:unit_pricing_measure", unit.measure));
          f.push(el("g:unit_pricing_base_measure", unit.base));
        }
      }
      if (apparel) {
        f.push(el("g:age_group", "adult"));
        f.push(el("g:gender", "unisex"));
      }
      f.push(shippingXml(r.price));
      items.push("  <item>\n    " + f.join("\n    ") + "\n  </item>");
      stats.items++;
    });
  }

  const now = (opts.now ?? new Date()).toISOString();
  const home = base + langPath(seg, "/");
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n' +
    "<channel>\n" +
    `  ${el("title", "REMPIRE")}\n` +
    `  ${el("link", home)}\n` +
    `  ${el("description", t.base)}\n` +
    /* For whoever opens the file: what is in it and what was left out. No
       double hyphen can reach a comment — ids are the only free text here. */
    `  <!-- ${lang} · ${now} · ${stats.items} items from ${stats.products} products · ` +
    `${stats.outOfStock} out of stock · ${stats.hidden} hidden · ` +
    `${stats.skippedNoImage.length} without a usable photo -->\n` +
    items.join("\n") +
    (items.length ? "\n" : "") +
    "</channel>\n</rss>\n";
  return { xml, stats };
}
