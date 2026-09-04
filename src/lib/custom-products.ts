/**
 * Custom products — the owner's own catalogue rows
 * (db/migrations/131_custom_products.sql).
 *
 * The catalogue is a file the owner cannot write (src/data/catalogue*.json,
 * served to the shop as /shop/catalogue2.js). This table is where «+ Товар»
 * in the panel and the assistant's create_product action put a product the
 * file does not have. The shop reads the active rows through GET
 * /api/overrides (`custom: [...]`, in the catalogue's own product shape) and
 * merges them into CATALOGUE at boot, so from then on a row here is a product
 * everywhere the storefront looks. The checkout's server-side price check
 * (priceItems() in src/lib/orders.ts) resolves a `c-…` id through
 * customMinByIds() below, so the price charged is the row's, never the
 * browser's.
 *
 * product_overrides still applies on top of a custom id — a price or stock
 * override written by the assistant («подними цену…») lands there exactly
 * as it does for a catalogue product, with nothing special-cased.
 *
 * Validation here is the whole of it: the routes pass the body through
 * cleanCustomProductInput() and store what comes back. Rebuilt field by
 * field, same discipline as every other sanitiser in this repo.
 */
import { jsonbParam, query } from "@/lib/db";
import { cleanGallery, type GalleryPhoto } from "@/lib/orders";
import { cleanDescriptionPatch, type DescriptionOverride } from "@/lib/product-descriptions";
import { cleanSeoPatch, type SeoOverride } from "@/lib/product-seo";

/* ---------- bounds ------------------------------------------------------ */

/** The shop's seven sections (CAT_NAMES in public/shop/catalogue2.js). */
export const PRODUCT_CATS = ["hair", "styling", "beard", "face", "body", "perfume", "merch"] as const;
export type ProductCat = (typeof PRODUCT_CATS)[number];

/** The subsections the storefront knows (SUBCATS in public/shop2/app.js) —
 *  anything else is dropped to «авто», never stored. */
export const SUBCATS: Record<string, readonly string[]> = {
  hair: ["sh", "co", "ca", "sp"],
  styling: ["pw", "sp", "ge", "pu"],
  beard: ["oi", "ba", "af", "ge"],
  face: ["to", "cl", "cs", "oi"],
};

/** Same 1–500 € window the editor's price box and the assistant's set_price use. */
export const PRICE_MIN = 1;
export const PRICE_MAX = 500;
export const MAX_SIZES = 12;
export const MAX_BRAND = 60;
export const MAX_NAME = 120;
export const MAX_SIZE_LABEL = 30;
export const MAX_ID = 80;
/** Every custom id starts with this — the panel tells a row from a catalogue product by it. */
export const CUSTOM_PREFIX = "c-";

/** What a product with no photo yet shows — the shop's own mark on the white tile. */
export const PLACEHOLDER_IMG = "/brand/rempire-tower.svg";

/* ---------- shapes ------------------------------------------------------ */

export type CustomProductInput = {
  brand: string;
  name: string;
  cat: ProductCat;
  subcat: string;
  /** [] for a single-price product … */
  sizes: string[];
  /** … in which case this is [price]; otherwise one price per size, aligned. */
  prices: number[];
  description: DescriptionOverride | null;
  gallery: GalleryPhoto[] | null;
  seo: SeoOverride | null;
};

export type CustomProduct = CustomProductInput & {
  id: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

/** The product as public/shop/catalogue2.js spells one — what the shop merges into CATALOGUE. */
export type CatalogueProduct = {
  id: string;
  brand: string;
  name: string;
  cat: string;
  subcat: string;
  price: number;
  prices?: number[];
  sizes?: string[];
  priceFrom?: boolean;
  img: string;
  gallery?: string[];
  /** The uploaded photos with their thumbnails — the editor's list. */
  photos: GalleryPhoto[];
  stock: "in";
  custom: true;
  active: boolean;
  description: DescriptionOverride | null;
  seo: SeoOverride | null;
  createdAt: string;
};

/** The {id,b,n,c,p,s} row src/lib/orders.ts and friends price from. */
export type MinProduct = { id: string; b: string; n: string; c: string; p: number; s: string };
/** …plus the size ladder and the first photo (or the placeholder) — what a letter or a report shows beside the name. */
export type MinWithVariants = { min: MinProduct; variants: { sizes: string[]; prices: number[] } | null; img: string };

export type CustomProductErrorCode =
  | "brand_required"
  | "name_required"
  | "bad_cat"
  | "bad_price"
  | "bad_size"
  | "sizes_duplicate"
  | "too_many_sizes"
  | "sizes_prices_mismatch"
  | "bad_id"
  | "not_found";

/** Which box the panel should point at — the same names the editor's fields carry. */
export type CustomProductField = "brand" | "name" | "cat" | "price" | "sizes" | "id";

export class CustomProductError extends Error {
  code: CustomProductErrorCode;
  field: CustomProductField;
  constructor(code: CustomProductErrorCode, field: CustomProductField, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.field = field;
  }
}

/* ---------- cleaning ---------------------------------------------------- */

/** One line, collapsed whitespace, capped. */
function line(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** «12,50» → 12.5, rounded to cents; null when not a price in 1–500 €. */
export function cleanPrice(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim().replace(",", "."));
  if (!Number.isFinite(n) || n < PRICE_MIN || n > PRICE_MAX) return null;
  return Math.round(n * 100) / 100;
}

/**
 * The input, rebuilt field by field. Throws CustomProductError naming the
 * field, so the panel can put the reason next to the right box.
 *
 * Sizes and prices arrive in three spellings and leave in one:
 *   { price: 12.5 }                                  → sizes [], prices [12.5]
 *   { sizes: ["75 мл","250 мл"], prices: [9, 16] }   → as given, aligned
 *   { sizes: ["75 мл","250 мл"], price: 9 }          → one price for every size
 *   { sizes: [{ size: "75 мл", price: 9 }, …] }      → the assistant's shape
 */
export function cleanCustomProductInput(raw: unknown): CustomProductInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CustomProductError("name_required", "name");
  const src = raw as Record<string, unknown>;

  const brand = line(src.brand, MAX_BRAND);
  if (!brand) throw new CustomProductError("brand_required", "brand");
  const name = line(src.name, MAX_NAME);
  if (!name) throw new CustomProductError("name_required", "name");

  const catRaw = line(src.cat ?? src.category, 20).toLowerCase();
  if (!(PRODUCT_CATS as readonly string[]).includes(catRaw)) throw new CustomProductError("bad_cat", "cat", catRaw);
  const cat = catRaw as ProductCat;
  const subRaw = line(src.subcat, 10).toLowerCase();
  const subcat = subRaw && (SUBCATS[cat] || []).includes(subRaw) ? subRaw : "";

  // sizes: strings, or the assistant's {size, price} objects
  const sizes: string[] = [];
  const sizePrices: Array<number | null> = [];
  const rawSizes = Array.isArray(src.sizes) ? src.sizes : [];
  for (const item of rawSizes) {
    const o = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
    const label = line(o ? (o.size ?? o.label ?? o.name) : item, MAX_SIZE_LABEL);
    if (!label) throw new CustomProductError("bad_size", "sizes");
    sizes.push(label);
    sizePrices.push(o && "price" in o ? cleanPrice(o.price) ?? NaN : null);
  }
  if (sizes.length > MAX_SIZES) throw new CustomProductError("too_many_sizes", "sizes", String(sizes.length));
  const seen = new Set<string>();
  for (const s of sizes) {
    const k = s.toLowerCase();
    if (seen.has(k)) throw new CustomProductError("sizes_duplicate", "sizes", s);
    seen.add(k);
  }

  const single = "price" in src && src.price !== null && src.price !== undefined ? cleanPrice(src.price) : null;
  if ("price" in src && src.price !== null && src.price !== undefined && single === null) {
    throw new CustomProductError("bad_price", "price", String(src.price));
  }
  const rawPrices = Array.isArray(src.prices) ? src.prices : null;

  let prices: number[];
  if (!sizes.length) {
    const p = single ?? (rawPrices && rawPrices.length ? cleanPrice(rawPrices[0]) : null);
    if (p === null) throw new CustomProductError("bad_price", "price");
    prices = [p];
  } else if (sizePrices.some((p) => p !== null)) {
    // the assistant's shape: every size names its own price
    prices = sizePrices.map((p, i) => {
      const v = p === null ? single : p;
      if (v === null || Number.isNaN(v)) throw new CustomProductError("bad_price", "sizes", sizes[i]);
      return v;
    });
  } else if (rawPrices && rawPrices.length) {
    if (rawPrices.length !== sizes.length) {
      throw new CustomProductError("sizes_prices_mismatch", "sizes", `${sizes.length} sizes, ${rawPrices.length} prices`);
    }
    prices = rawPrices.map((p, i) => {
      const v = cleanPrice(p);
      if (v === null) throw new CustomProductError("bad_price", "sizes", sizes[i]);
      return v;
    });
  } else if (single !== null) {
    prices = sizes.map(() => single);
  } else {
    throw new CustomProductError("bad_price", "price");
  }

  return {
    brand,
    name,
    cat,
    subcat,
    sizes,
    prices,
    description: src.description == null ? null : cleanDescriptionPatch(src.description),
    gallery: src.gallery == null ? null : cleanGallery(src.gallery),
    seo: src.seo == null ? null : cleanSeoPatch(src.seo),
  };
}

/* ---------- ids --------------------------------------------------------- */

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "j", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  õ: "o", ä: "a", ö: "o", ü: "u", š: "s", ž: "z",
};

/** «Proraso Beard Balm — бальзам» → `proraso-beard-balm-balzam`: ASCII, no
 *  spaces, readable in a URL. Cyrillic and Estonian letters are transliterated
 *  rather than dropped, so a product named in Russian still gets a real id. */
export function slugForId(text: string): string {
  const lower = String(text || "").toLowerCase();
  let out = "";
  for (const ch of lower) out += ch in TRANSLIT ? TRANSLIT[ch] : ch;
  return out.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** `c-<slug of brand + name>`, capped — the base the unique id is picked from. */
export function baseCustomId(brand: string, name: string): string {
  const slug = slugForId(`${brand} ${name}`).slice(0, MAX_ID - CUSTOM_PREFIX.length - 4).replace(/-+$/, "");
  return CUSTOM_PREFIX + (slug || "tovar");
}

export function isCustomId(id: unknown): id is string {
  return typeof id === "string" && id.startsWith(CUSTOM_PREFIX) && /^c-[a-z0-9][a-z0-9-]*$/.test(id) && id.length <= MAX_ID;
}

async function idTaken(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>("select id from custom_products where id = $1", [id]);
  return rows.length > 0;
}

/** The base id, or `-2`, `-3`, … when a product with that name already exists. */
export async function uniqueCustomId(brand: string, name: string): Promise<string> {
  const base = baseCustomId(brand, name);
  if (!(await idTaken(base))) return base;
  for (let n = 2; n < 200; n++) {
    const candidate = `${base}-${n}`;
    if (!(await idTaken(candidate))) return candidate;
  }
  throw new CustomProductError("bad_id", "id", base);
}

/* ---------- rows -------------------------------------------------------- */

type Row = {
  id: string;
  brand: string;
  name: string;
  cat: string;
  subcat: string | null;
  sizes: unknown;
  prices: unknown;
  description: unknown;
  gallery: unknown;
  seo: unknown;
  active: boolean;
  created_at: string | Date;
  updated_at: string | Date;
};

function parseJsonb(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v;
}

function iso(v: string | Date): string {
  return new Date(v).toISOString();
}

function fromRow(r: Row): CustomProduct {
  const sizesRaw = parseJsonb(r.sizes);
  const pricesRaw = parseJsonb(r.prices);
  const sizes = Array.isArray(sizesRaw) ? sizesRaw.map((s) => String(s)) : [];
  const prices = Array.isArray(pricesRaw) ? pricesRaw.map((p) => Number(p)).filter((p) => Number.isFinite(p)) : [];
  return {
    id: r.id,
    brand: r.brand,
    name: r.name,
    cat: ((PRODUCT_CATS as readonly string[]).includes(r.cat) ? r.cat : "hair") as ProductCat,
    subcat: r.subcat || "",
    sizes,
    prices: prices.length ? prices : [PRICE_MIN],
    description: cleanDescriptionPatch(parseJsonb(r.description)),
    gallery: cleanGallery(parseJsonb(r.gallery)),
    seo: cleanSeoPatch(parseJsonb(r.seo)),
    active: r.active !== false,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

const COLS = "id, brand, name, cat, subcat, sizes, prices, description, gallery, seo, active, created_at, updated_at";

export async function listCustomProducts(opts: { activeOnly?: boolean } = {}): Promise<CustomProduct[]> {
  const rows = await query<Row>(
    `select ${COLS} from custom_products${opts.activeOnly ? " where active" : ""} order by created_at desc, id`,
  );
  return rows.map(fromRow);
}

export async function getCustomProduct(id: string): Promise<CustomProduct | null> {
  if (!isCustomId(id)) return null;
  const rows = await query<Row>(`select ${COLS} from custom_products where id = $1`, [id]);
  return rows.length ? fromRow(rows[0]) : null;
}

/** Validates, picks a unique id and inserts. Throws CustomProductError on bad input. */
export async function createCustomProduct(raw: unknown): Promise<CustomProduct> {
  const input = cleanCustomProductInput(raw);
  const id = await uniqueCustomId(input.brand, input.name);
  const rows = await query<Row>(
    `insert into custom_products (id, brand, name, cat, subcat, sizes, prices, description, gallery, seo)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
     returning ${COLS}`,
    [
      id, input.brand, input.name, input.cat, input.subcat || null,
      jsonbParam(input.sizes), jsonbParam(input.prices),
      input.description ? jsonbParam(input.description) : null,
      input.gallery ? jsonbParam(input.gallery) : null,
      input.seo ? jsonbParam(input.seo) : null,
    ],
  );
  return fromRow(rows[0]);
}

/**
 * A PATCH: only the keys present in `raw` change, the merged row is validated
 * whole. `sizes` and `prices` travel together — sending one without the other
 * is taken as «this list, and the prices I already have» and checked for
 * alignment like any other input. Null when there is no such product.
 */
export async function updateCustomProduct(id: string, raw: unknown): Promise<CustomProduct | null> {
  const cur = await getCustomProduct(id);
  if (!cur) return null;
  const patch = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const merged: Record<string, unknown> = {
    brand: cur.brand, name: cur.name, cat: cur.cat, subcat: cur.subcat,
    sizes: cur.sizes, prices: cur.prices,
    description: cur.description, gallery: cur.gallery, seo: cur.seo,
  };
  for (const key of ["brand", "name", "cat", "subcat", "sizes", "prices", "description", "gallery", "seo", "price"] as const) {
    if (key in patch) merged[key] = patch[key];
  }
  // a plain {price} on a product that had sizes means «one price now»
  if ("price" in patch && !("sizes" in patch)) merged.sizes = [];
  // a new size list with no prices of its own: keep the old ladder when it
  // still fits, otherwise every size starts at the old first price
  if ("sizes" in patch && !("prices" in patch) && !("price" in patch)) {
    const sz = Array.isArray(patch.sizes) ? patch.sizes : [];
    if (sz.length && sz.every((s) => s && typeof s === "object")) {
      delete merged.prices; // the assistant's {size, price} shape carries its own
    } else {
      const n = Math.max(1, sz.length);
      merged.prices = n === cur.prices.length ? cur.prices : Array(n).fill(cur.prices[0]);
    }
  }
  const input = cleanCustomProductInput(merged);
  const rows = await query<Row>(
    `update custom_products
        set brand = $2, name = $3, cat = $4, subcat = $5, sizes = $6::jsonb, prices = $7::jsonb,
            description = $8::jsonb, gallery = $9::jsonb, seo = $10::jsonb, updated_at = now()
      where id = $1
      returning ${COLS}`,
    [
      id, input.brand, input.name, input.cat, input.subcat || null,
      jsonbParam(input.sizes), jsonbParam(input.prices),
      input.description ? jsonbParam(input.description) : null,
      input.gallery ? jsonbParam(input.gallery) : null,
      input.seo ? jsonbParam(input.seo) : null,
    ],
  );
  return rows.length ? fromRow(rows[0]) : null;
}

/** «Снять с продажи» (false) and its undo (true). Null when there is no such product. */
export async function setCustomProductActive(id: string, active: boolean): Promise<CustomProduct | null> {
  if (!isCustomId(id)) return null;
  const rows = await query<Row>(
    `update custom_products set active = $2, updated_at = now() where id = $1 returning ${COLS}`,
    [id, active],
  );
  return rows.length ? fromRow(rows[0]) : null;
}

/* ---------- the shapes the rest of the shop reads ----------------------- */

export function toCatalogueProduct(p: CustomProduct): CatalogueProduct {
  const photos = p.gallery ?? [];
  const urls = photos.map((g) => g.url);
  const multi = p.sizes.length > 0;
  const distinct = new Set(p.prices).size;
  const out: CatalogueProduct = {
    id: p.id,
    brand: p.brand,
    name: p.name,
    cat: p.cat,
    subcat: p.subcat,
    price: p.prices[0],
    img: urls[0] ?? PLACEHOLDER_IMG,
    photos,
    stock: "in",
    custom: true,
    active: p.active,
    description: p.description,
    seo: p.seo,
    createdAt: p.createdAt,
  };
  if (multi) {
    out.sizes = p.sizes.slice();
    out.prices = p.prices.slice();
    if (distinct > 1) out.priceFrom = true;
  }
  if (urls.length) out.gallery = urls;
  return out;
}

export function toMin(p: CustomProduct): MinWithVariants {
  return {
    min: { id: p.id, b: p.brand, n: p.name, c: p.cat, p: p.prices[0], s: p.active ? "in" : "out" },
    variants: p.sizes.length ? { sizes: p.sizes.slice(), prices: p.prices.slice() } : null,
    img: p.gallery?.[0]?.url ?? PLACEHOLDER_IMG,
  };
}

/** The active rows' ids and stamps, newest first — the sitemap the app serves (src/app/sitemap-custom.xml/route.ts). */
export async function listCustomSitemapRows(): Promise<Array<{ id: string; updatedAt: string }>> {
  const rows = await query<{ id: string; updated_at: string | Date }>(
    "select id, updated_at from custom_products where active order by created_at desc, id",
  );
  return rows.map((r) => ({ id: r.id, updatedAt: iso(r.updated_at) }));
}

/**
 * For the checkout (src/lib/orders.ts priceItems): the rows behind these ids.
 * A hidden product comes back with s:"out" so the order is refused as «нет в
 * наличии» rather than as an id the shop has never heard of — a shopper who
 * put it in the cart an hour ago gets the honest answer.
 */
export async function customMinByIds(ids: string[]): Promise<Map<string, MinWithVariants>> {
  const want = [...new Set(ids.filter(isCustomId))];
  const out = new Map<string, MinWithVariants>();
  if (!want.length) return out;
  const holes = want.map((_, i) => `$${i + 1}`).join(",");
  const rows = await query<Row>(`select ${COLS} from custom_products where id in (${holes})`, want);
  for (const r of rows) {
    const p = fromRow(r);
    out.set(p.id, toMin(p));
  }
  return out;
}

/** Every active custom product in the checkout's shape — the inventory universe and the assistant's prompt. */
export async function listCustomMin(): Promise<MinWithVariants[]> {
  return (await listCustomProducts({ activeOnly: true })).map(toMin);
}
