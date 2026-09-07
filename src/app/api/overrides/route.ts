/**
 * GET /api/overrides — everything the storefront needs to render the owner's
 * edits: per-product overrides (price, stock, SEO, subcategory, variant photo
 * order, video, the photo gallery he uploaded) and the shop settings (chat bot
 * on/off, the home-page banner, mail flows, shipping rules).
 *
 * Public and cached at the edge for half a minute — a price change is visible
 * within 30 s, and a burst of shoppers costs one query. "Public" is meant
 * literally, so only the keys in PUBLIC_SETTINGS below leave the server.
 *
 * When there is no database the shop must still work, so the answer is a plain
 * 503 with {ok:false}; public/shop2/app.js falls back to its localStorage copy.
 */
import { mergeContent } from "@/lib/content";
import { getOverrides, getSettings } from "@/lib/orders";
import { getDescriptionOverrides } from "@/lib/product-descriptions";
import { getSeoOverrides } from "@/lib/product-seo";
import { cleanPricing, publicPricing } from "@/lib/loyalty";
import { cleanGiftAmounts } from "@/lib/giftcards";
import { listCustomProducts, toCatalogueProduct, type CatalogueProduct } from "@/lib/custom-products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SETTINGS: Record<string, unknown> = {
  chatbot: true,
  bundles: true,
  // the home-page banner: null means «стандартный» — app.js draws its built-in
  // slides. An object is { slides: [...], interval } written by the owner.
  hero: null,
  // the same three defaults as FLOW_DEFAULTS in src/lib/flows.ts — a shop with
  // no settings row must not claim it is mailing people it is not mailing
  flows: { abandoned: false, birthday: false, backstock: false },
  shipping: {},
  // wholesale/loyalty: enabled + earn rate only, for the storefront's own
  // copy («зарабатывайте баллы») — proDiscountPct never leaves the server
  // this way, see publicPricing() in src/lib/loyalty.ts.
  pricing: publicPricing(cleanPricing(null)),
  // the denominations the /gift/ page offers, owned by the panel's
  // «Маркетинг → Подарочные карты». Public by nature: they are the buttons.
  gift_amounts: cleanGiftAmounts(null),
};

/**
 * The settings this route is allowed to publish.
 *
 * `settings` is a free-form key/value table — PUT /api/admin/settings takes any
 * key matching /^[a-z0-9_.-]{1,64}$/i with an arbitrary jsonb value. Serving all
 * of it made every future note-to-self, token or internal flag a public
 * document, cached at the edge for 30 s (audit M1). A key that is not on this
 * list stays on the server until someone puts it here on purpose.
 */
const PUBLIC_SETTINGS = [
  "chatbot",
  "bundles",
  "hero",
  "flows",
  "shipping",
  "shipping_rules",
  // the shop's own words about itself — company details, hours, socials, the
  // announcement bar, the contact page. Public by nature: every one of these
  // strings is printed in the footer of every page.
  "content",
  // which gift-card denominations are on sale — the buttons on /gift/
  "gift_amounts",
  // «По счёту — для компаний»: the number prefix and the payment term the
  // checkout quotes («оплата в течение N дней») — src/lib/invoices.ts
  "invoice",
] as const;

/** The pro (salon) price is commercial information: never on the public feed.
    Signed-in partners get their prices from /api/account/pricing instead. */
function publicOverrides<T extends Record<string, unknown>>(all: Record<string, T>): Record<string, Omit<T, "proPrice">> {
  const out: Record<string, Omit<T, "proPrice">> = {};
  for (const [id, o] of Object.entries(all)) {
    const { proPrice: _pro, ...rest } = o as T & { proPrice?: unknown };
    void _pro;
    out[id] = rest as Omit<T, "proPrice">;
  }
  return out;
}

/**
 * The owner's own products (db/migrations/131_custom_products.sql), active
 * ones only, in the catalogue's product shape — the storefront merges them
 * into CATALOGUE at boot. Best effort on purpose: a deployment whose
 * migration has not run yet must still serve prices and settings.
 */
async function customForFeed(): Promise<CatalogueProduct[]> {
  try {
    return (await listCustomProducts({ activeOnly: true })).map(toCatalogueProduct);
  } catch (err) {
    console.error("[api/overrides] custom products unavailable:", err);
    return [];
  }
}

export async function GET() {
  try {
    const [overrides, descriptions, seos, stored, custom] = await Promise.all([
      getOverrides(),
      getDescriptionOverrides(),
      getSeoOverrides(),
      getSettings(),
      customForFeed(),
    ]);
    /* assistant-work: product_overrides.description {RU,ET,EN} — its own
       column (src/lib/product-descriptions.ts), merged in here rather than
       added to getOverrides() itself, which is owned by backend-core
       (docs/build-contracts.md). Absent for a product = no override, the
       storefront keeps the static content.ru.js/content.et.js/content.js text. */
    for (const [id, description] of Object.entries(descriptions)) {
      Object.assign(overrides[id] ??= {
        price: null, stock: null, seoTitle: null, seoDesc: null, subcat: null,
        varImg: null, videoUrl: null, gallery: null, proPrice: null,
        sizes: null, hidden: false, updatedAt: null,
      }, { description });
    }
    /* The per-language Google title/description (src/lib/product-seo.ts):
       the storefront's setHead() reads `seo[lang]` with a Russian fallback.
       `seoTitle`/`seoDesc` stay in the row as the Russian pair for anything
       older that still reads them. */
    for (const [id, seo] of Object.entries(seos)) {
      Object.assign(overrides[id] ??= {
        price: null, stock: null, seoTitle: null, seoDesc: null, subcat: null,
        varImg: null, videoUrl: null, gallery: null, proPrice: null,
        sizes: null, hidden: false, updatedAt: null,
      }, { seo });
    }
    const published = Object.fromEntries(
      Object.entries(stored).filter(([k]) => (PUBLIC_SETTINGS as readonly string[]).includes(k)),
    );
    /* `content` is the one setting that is a document rather than a value: a
       spread would let a half-written row erase the company name, so it is
       merged onto the defaults (and sanitised on the way) instead. */
    const content = mergeContent(published.content);
    /* wholesale/loyalty: "pricing" is deliberately NOT in PUBLIC_SETTINGS —
       proDiscountPct/proMinOrder must never reach an anonymous shopper. This
       recomputes the redacted subset straight from the real settings row,
       after the generic `published` spread, so it always wins. */
    const pricing = publicPricing(cleanPricing(stored.pricing));
    /* Same reasoning one line up: the storefront must never be handed a
       denomination the checkout would refuse, so the stored row is sanitised
       here rather than trusted through the generic spread. */
    const giftAmounts = cleanGiftAmounts(stored.gift_amounts);
    return Response.json(
      { ok: true, overrides: publicOverrides(overrides), custom, settings: { ...DEFAULT_SETTINGS, ...published, content, pricing, gift_amounts: giftAmounts } },
      { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch (err) {
    console.error("[api/overrides] unavailable:", err);
    return Response.json(
      { ok: false, error: "db_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
