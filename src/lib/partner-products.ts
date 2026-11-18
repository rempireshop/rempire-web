/**
 * The shop's products as REMPIRE booking sees them (docs/partner-api.md).
 *
 * One row per SIZE, keyed exactly like «Склад» (stock_levels: product_id,
 * variant '' for a product sold in one unnamed size, the size label otherwise)
 * — so the id the booking app keeps for a sale is the id the shelf, the
 * barcode and the order line all use. The universe is getLevels()'s: every
 * catalogue product and every one of the owner's own, on sale or not.
 *
 *   priceCents     what the till charges for it today, VAT included —
 *                  priceItems() itself (channel 'pos', the salon till), so
 *                  the owner's price, his size ladder and a size's premium
 *                  are the shop's and never recomputed here. The till will
 *                  not ring up a hidden product, or one marked «нет в
 *                  наличии»; for those alone the price is the same rule as
 *                  the feed restates it (sizePrices() in
 *                  src/lib/merchant-feed.ts). The shop has no sale prices.
 *   purchaseCents  always null in this version: the shop does not keep
 *                  purchase prices yet. The field is in the shape so the
 *                  booking app's reading of it does not change when it does.
 *   vatBp          the shop's VAT rate in basis points (24 % → 2400) —
 *                  settings.vat_rate, as every order is stamped with it.
 *   stock          the shelf count, or null for a size nobody has counted
 *                  (no counting move in the ledger — see src/lib/inventory.ts).
 *   barcode        the EAN bound to that shelf row, or null.
 *
 * Search (`?q=`) only finds what a shopper could buy — «Показывать в
 * магазине» on. A barcode or an id always answers, hidden or not: the barber
 * is holding the bottle.
 *
 * Everything here reads. Nothing writes to the database or to storage.
 */
import { listCustomProducts } from "@/lib/custom-products";
import { getLevels, byEan, shelfKey, type CatalogueLevelRow } from "@/lib/inventory";
import { feedBase, feedName, sizePhotos, sizePrices, type FeedLang, type SizePhotos } from "@/lib/merchant-feed";
import { getOverrides, getSettings, OrderError, priceItems } from "@/lib/orders";
import { translateVariant } from "@/lib/product-name";
import { resolveVatRate } from "@/lib/reports";

export type PartnerLang = "ru" | "et" | "en";
export const PARTNER_LANGS: readonly PartnerLang[] = ["ru", "et", "en"];

export type PartnerProduct = {
  productId: string;
  variant: string;
  name: string;
  variantLabel: string;
  brand: string;
  photo: string | null;
  priceCents: number;
  purchaseCents: number | null;
  vatBp: number;
  stock: number | null;
  barcode: string | null;
};

/** Everything a lookup reads, gathered once per request. */
export type PartnerCatalog = {
  rows: CatalogueLevelRow[];
  photos: Map<string, SizePhotos>;
  /** the till's rule per size, for a row the till refuses to ring up — see tillPrices() */
  listed: Map<string, Map<string, number>>;
  vatBp: number;
};

export async function loadPartnerCatalog(): Promise<PartnerCatalog> {
  const [rows, overrides, custom, settings] = await Promise.all([
    getLevels({ filter: "all", limit: 1000 }),
    getOverrides(),
    listCustomProducts().catch((err) => {
      console.error("[partner-products] custom products not loaded:", err);
      return [];
    }),
    getSettings().catch(() => ({}) as Record<string, unknown>),
  ]);
  const vatBp = Math.round(resolveVatRate((settings as Record<string, unknown>).vat_rate) * 100);
  return {
    rows,
    photos: sizePhotos(overrides, custom, feedBase(process.env.PUBLIC_BASE_URL)),
    listed: sizePrices(overrides, custom),
    vatBp,
  };
}

function rowKey(productId: string, variant: string): string {
  return productId + "\u0000" + variant;
}

/** The shelf row for one product × size, or null when the shop has no such size. */
export function findRow(cat: PartnerCatalog, productId: string, variant: string): CatalogueLevelRow | null {
  return cat.rows.find((r) => r.productId === productId && r.variant === variant) ?? null;
}

/**
 * Today's till price for each row, in cents — one priceItems() call for the
 * lot, and one per row only when the lot is refused, so a row the till
 * cannot price (an old size the owner renamed away) drops out alone.
 *
 * The till asked is the salon's (channel 'pos'): it does not hold a sale to
 * the shelf count, which may lag the bottle in the barber's hand. It does
 * refuse a product that is hidden or marked «нет в наличии» (out_of_stock),
 * and that row alone takes its price from `cat.listed` — the same rule,
 * restated for the feed — so the barber holding such a bottle still finds it.
 * Pricing here is a question only: priceItems() writes nothing.
 */
export async function tillPrices(cat: PartnerCatalog, rows: CatalogueLevelRow[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!rows.length) return out;
  const items = (list: CatalogueLevelRow[]) => list.map((r) => ({ id: r.productId, variant: r.variant, qty: 1 }));
  const put = (r: CatalogueLevelRow, price: number) => {
    if (Number.isFinite(price) && price >= 0) out.set(rowKey(r.productId, r.variant), Math.round(price * 100));
  };
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    try {
      const { lines } = await priceItems(items(chunk), "RU", { channel: "pos" });
      chunk.forEach((r, k) => put(r, lines[k]?.price ?? NaN));
    } catch (err) {
      if (!(err instanceof OrderError)) throw err;
      for (const r of chunk) {
        try {
          const { lines } = await priceItems(items([r]), "RU", { channel: "pos" });
          put(r, lines[0]?.price ?? NaN);
        } catch (one) {
          if (!(one instanceof OrderError)) throw one;
          const listed = one.code === "out_of_stock" ? cat.listed.get(r.productId)?.get(r.variant) : undefined;
          if (listed != null) out.set(rowKey(r.productId, r.variant), listed);
        }
      }
    }
  }
  return out;
}

export function priceOf(prices: Map<string, number>, r: CatalogueLevelRow): number | null {
  const v = prices.get(rowKey(r.productId, r.variant));
  return typeof v === "number" ? v : null;
}

function feedLang(lang: PartnerLang): FeedLang {
  return lang === "et" ? "ET" : lang === "en" ? "EN" : "RU";
}

export function toPartnerProduct(cat: PartnerCatalog, r: CatalogueLevelRow, priceCents: number, lang: PartnerLang): PartnerProduct {
  const L = feedLang(lang);
  const ph = cat.photos.get(r.productId);
  return {
    productId: r.productId,
    variant: r.variant,
    name: feedName(r.name, L) || r.name,
    variantLabel: r.variant ? translateVariant(r.variant, L) : "",
    brand: r.brand,
    photo: ph ? (ph.bySize.get(r.variant) ?? ph.main) : null,
    priceCents,
    purchaseCents: null, // not in this version — see the module doc
    vatBp: cat.vatBp,
    stock: r.tracked ? r.qty : null,
    barcode: r.ean ?? null,
  };
}

/** Rows → products, dropping any the till cannot price. */
export async function productsOf(cat: PartnerCatalog, rows: CatalogueLevelRow[], lang: PartnerLang): Promise<PartnerProduct[]> {
  const prices = await tillPrices(cat, rows);
  const out: PartnerProduct[] = [];
  for (const r of rows) {
    const p = priceOf(prices, r);
    if (p != null) out.push(toPartnerProduct(cat, r, p, lang));
  }
  return out;
}

/* ---------- the three lookups -------------------------------------------- */

export async function lookupByBarcode(code: string, lang: PartnerLang): Promise<PartnerProduct[]> {
  const hit = await byEan(code);
  if (!hit) return [];
  const cat = await loadPartnerCatalog();
  const row = findRow(cat, hit.productId, hit.variant);
  return row ? productsOf(cat, [row], lang) : [];
}

/**
 * The shelf row a caller's (productId, variant) means — the size label, or ''
 * for a product with none; a one-size product named without its size lands
 * on its labelled row, the way «Склад» does (shelfKey()).
 */
export async function resolveRow(cat: PartnerCatalog, productId: string, variant: string): Promise<CatalogueLevelRow | null> {
  const exact = findRow(cat, productId, variant);
  if (exact) return exact;
  if (variant) return null;
  const key = await shelfKey(productId, variant).catch(() => "");
  return key ? findRow(cat, productId, key) : null;
}

export async function lookupById(productId: string, variant: string, lang: PartnerLang): Promise<PartnerProduct[]> {
  const cat = await loadPartnerCatalog();
  const row = await resolveRow(cat, productId, variant);
  return row ? productsOf(cat, [row], lang) : [];
}

function fold(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/**
 * Free text over brand and name in all three languages, every word required.
 * On-sale products only, best match first: words that start a word of the
 * brand or name rank above words found inside one, then what is on the shelf.
 */
export async function searchProducts(q: string, limit: number, lang: PartnerLang): Promise<PartnerProduct[]> {
  const words = fold(q).split(/[\s,.;:/\\|()«»"'+]+/).filter(Boolean);
  if (!words.length) return [];
  const cat = await loadPartnerCatalog();
  const scored: Array<{ r: CatalogueLevelRow; score: number }> = [];
  for (const r of cat.rows) {
    if (r.offSale) continue;
    const hay = fold([r.brand, r.name, feedName(r.name, "ET"), feedName(r.name, "EN"), r.variant].join(" "));
    let score = 0;
    let all = true;
    for (const w of words) {
      const at = hay.indexOf(w);
      if (at < 0) {
        all = false;
        break;
      }
      score += at === 0 || /[\s\-—(]/.test(hay[at - 1]) ? 2 : 1;
    }
    if (!all) continue;
    if (r.tracked && r.qty > 0) score += 0.5;
    scored.push({ r, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.r.brand + " " + a.r.name).localeCompare(b.r.brand + " " + b.r.name, "ru") ||
      a.r.variant.localeCompare(b.r.variant, "ru"),
  );
  /* priced a few past the limit, so a row the till refuses does not leave
     the list one short */
  const picked = scored.slice(0, limit + 5).map((s) => s.r);
  const out = await productsOf(cat, picked, lang);
  return out.filter((p) => p.priceCents > 0).slice(0, limit);
}

/* ---------- what the photo matcher is shown ------------------------------ */

/** One on-sale product with its sizes, numbered for the photo prompt. */
export type IdentifyCandidate = { productId: string; brand: string; name: string; sizes: string[] };

export function identifyCandidates(cat: PartnerCatalog): IdentifyCandidate[] {
  const byId = new Map<string, IdentifyCandidate>();
  for (const r of cat.rows) {
    if (r.offSale) continue;
    let c = byId.get(r.productId);
    if (!c) {
      c = { productId: r.productId, brand: r.brand, name: r.name, sizes: [] };
      byId.set(r.productId, c);
    }
    c.sizes.push(r.variant);
  }
  return [...byId.values()];
}
