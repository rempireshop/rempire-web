/**
 * Shopify's variant ids, onto this shop's product and size.
 *
 * Until Merchant Center approves the shop's own feeds (/feed/google-*.xml) it
 * goes on serving Shopify's product sources, and their links name a Shopify
 * VARIANT — the «Checkout» link as `/cart/shopify_ZZ_<product>_<variant>:1`
 * (src/lib/merchant-cart.ts), the landing link as `?variant=<variant>`
 * (src/lib/legacy-redirects.ts). The table is src/data/shopify-variants.json,
 * written by tools/build-shopify-variants.mjs from a Merchant Center export:
 * `p` the catalogue product, `s` the `?size=` the product page opens on (none
 * when the shop sells the product in one size, or not in that size).
 *
 * Edge-safe on purpose — one JSON import and nothing else: src/middleware.ts
 * reads it through legacy-redirects.ts.
 */
import table from "@/data/shopify-variants.json";

export type ShopifyVariant = { p: string; s?: string };

const VARIANTS = table as Record<string, ShopifyVariant>;

/** The product and size a Shopify variant id stands for, or null. */
export function shopifyVariant(variantId: string | null | undefined): ShopifyVariant | null {
  const k = String(variantId ?? "").trim();
  return /^\d{1,20}$/.test(k) && Object.prototype.hasOwnProperty.call(VARIANTS, k) ? VARIANTS[k] : null;
}

/**
 * The variant id inside a Merchant Center item id of Shopify's product source
 * — `shopify_<country, or ZZ>_<product id>_<variant id>` — or a bare one, the
 * form of Shopify's own cart permalink (`/cart/<variant id>:1`); null for
 * anything else.
 */
export function shopifyVariantId(itemId: string | null | undefined): string | null {
  const m = /^(?:shopify_[A-Za-z]{2}_\d{1,20}_)?(\d{1,20})$/.exec(String(itemId ?? ""));
  return m ? m[1] : null;
}
