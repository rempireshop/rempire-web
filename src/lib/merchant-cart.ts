/**
 * Merchant Center's «Checkout» link — `/cart/<item id>:<qty>` — answered by
 * this shop.
 *
 * Merchant Center → Business info → Checkout is set to Shopify's cart
 * permalink, `https://rempireshop.com/cart/{id}:1`, where {id} is the feed
 * item's id. Google fills it in for a «Buy» click and sends the shopper to
 * it. Shopify turned that into a basket and a checkout; the day
 * rempireshop.com points here, the same address has to do the same — with
 * OUR ids, the ones src/lib/merchant-feed.ts writes into g:id: the product id,
 * a shortened stem with a hash for the long ones, and `_<size>` for one size
 * of several.
 *
 * The ids are not parsed. They are looked up in feedOffers() — the same pass
 * that hands them out to the feed (planFeed), over the same live input — so
 * a long id shortened into a hashed stem, a size with a collision suffix, an
 * id that exists only because of the owner's own ladder all resolve exactly
 * as the feed spelled them, and the two cannot drift apart.
 *
 * What the shopper gets:
 *   · the item exists and can be bought → its product page, on that size,
 *     with `buy=<qty>`: the storefront puts it in the basket and opens the
 *     checkout (buyFromLink() in public/shop2/app.js). The basket lives in
 *     the browser, so the server cannot fill it; the product page is also
 *     where a custom product's data arrives before the page paints.
 *   · the item exists and is sold out → the product page on that size, with
 *     no `buy`: it says «нет в наличии» and offers «Сообщить о поступлении».
 *   · the id is not in the feed, but names a product that is on sale (a size
 *     since removed, say) → that product's page.
 *   · anything else — an unknown id, a hidden product → the shop's home page.
 *     A hidden product's own address is a 404 (src/middleware.ts), which is
 *     no place to land somebody who came to buy.
 */
import { createHash } from "node:crypto";
import catalogueMin from "@/data/catalogue.min.json";
import type { CartLinkLine } from "@/lib/cart-permalink";
import { feedOffers, type FeedInput, type FeedOffer } from "@/lib/merchant-feed";
import { langPath } from "@/lib/seo-head.mjs";

const hash8 = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 8);

const CATALOGUE_IDS = (catalogueMin as Array<{ id: string }>).map((p) => p.id);

/**
 * The product an id that is NOT in today's feed still points at: the part
 * before the size (`_…`), which is either the product id itself or a stem
 * shortened with the hash of the whole id (idStem in merchant-feed.ts).
 */
function productOfStaleId(id: string, productIds: string[]): string | null {
  const stem = id.includes("_") ? id.slice(0, id.lastIndexOf("_")) : id;
  for (const candidate of [id, stem]) {
    if (productIds.includes(candidate)) return candidate;
    const h = /^(.+)-([0-9a-f]{8})$/.exec(candidate);
    if (!h) continue;
    const hit = productIds.find((pid) => pid.startsWith(h[1]) && hash8(pid) === h[2]);
    if (hit) return hit;
  }
  return null;
}

/** A product page, in one language, with an optional query. */
function productPath(seg: string, productId: string, query: string): string {
  return langPath(seg, "/p/" + encodeURIComponent(productId) + "/") + (query ? "?" + query : "");
}

export type CartLinkTarget = {
  /** The path to send the shopper to (same origin). */
  path: string;
  /** Why — for the X-Rempire-Cart header, the logs and the tests. */
  reason: "buy" | "sold-out" | "product" | "hidden" | "unknown";
};

/**
 * The address a permalink answers with. Only the first line is honoured:
 * Merchant Center always sends one item, and a basket that silently took
 * half of a longer list would be worse than one that took the item clicked.
 */
export function resolveCartLink(
  lines: CartLinkLine[],
  input: Pick<FeedInput, "overrides" | "descriptions" | "custom">,
  seg: string,
  offers: FeedOffer[] = feedOffers(input),
): CartLinkTarget {
  const line = lines[0];
  if (!line) return { path: langPath(seg, "/"), reason: "unknown" };

  const offer = offers.find((o) => o.id === line.id);
  if (offer) {
    const size = offer.slug ? "size=" + encodeURIComponent(offer.slug) : "";
    if (!offer.available) return { path: productPath(seg, offer.productId, size), reason: "sold-out" };
    return {
      path: productPath(seg, offer.productId, (size ? size + "&" : "") + "buy=" + line.qty),
      reason: "buy",
    };
  }

  /* Not an item of today's feed. Google keeps an item for a day or so after
     it leaves the feed, so this is a product the owner has since hidden, a
     size he has taken off the ladder, or an id nobody ever issued. */
  const productId = productOfStaleId(line.id, [...CATALOGUE_IDS, ...input.custom.map((c) => c.id)]);
  if (!productId) return { path: langPath(seg, "/"), reason: "unknown" };
  if (!offers.some((o) => o.productId === productId)) return { path: langPath(seg, "/"), reason: "hidden" };
  return { path: productPath(seg, productId, ""), reason: "product" };
}
