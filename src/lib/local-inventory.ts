/**
 * The Google local product inventory feed — /feed/google-local.xml, answered
 * by src/app/feed/[file]/route.ts beside the three product feeds. What Dim
 * does with it in Merchant Center: docs/google-local-listings.md.
 *
 * Why: the shop's stock is physically on the shelf of the salon at Mardi 1,
 * Tallinn — the pickup point the checkout offers. Once the salon's Google
 * Business Profile is linked to Merchant Center 5819586565, Google's free
 * local listings can say «in stock at Rempire, Mardi 1» on Maps and in local
 * search. That needs this second, much smaller feed: one line per product
 * size per store — which item, which store, whether it is on the shelf.
 *
 * **Switched off until the profile exists.** The store code is
 * settings.gbp_store_code — the code Google's Business Profile shows for the
 * salon («Store code» in the profile's info; Merchant Center matches by it,
 * case-sensitively). While the setting is empty the route answers 404, so a
 * Merchant Center data source pointed at the address too early fetches
 * nothing rather than a store nobody has linked. There is no panel field for
 * it: it is set once, by Dim, the day the profile is linked (the doc says
 * how).
 *
 * Every value is the product feed's own, by construction — listedOffers() in
 * src/lib/merchant-feed.ts is the list buildFeed() writes from:
 *   id            the product feed's g:id, per size; a set's «set-…» id.
 *                 Google joins the two feeds on it.
 *   availability  in_stock / out_of_stock exactly as the product feed says
 *                 it: the counted shelf, a manual «нет в наличии», a size
 *                 counted to zero. The online shop and the salon sell from
 *                 the same shelf, so there is no second number to send.
 *   price         the same price, VAT in (EU prices include tax). Optional
 *                 for Google; sent so the store's price can never be read as
 *                 anything but the shop's.
 *   pickup_method «buy»: the checkout sells the item online and the shopper
 *                 collects it at Mardi 1 («Самовывоз — Mardi 1, Таллинн»).
 *   pickup_sla    «same day»: what «Доставка и оплата» promises for pickup —
 *                 «напишем, когда заказ можно забрать — обычно в день оплаты».
 * Hidden products, switched-off custom products and items without a photo are
 * absent here exactly as they are absent from the product feed. No quantity:
 * it is optional, and the product feed states availability only too.
 *
 * Google's attribute list: «Local product inventory data specification»
 * (support.google.com/merchants/answer/14819809) — store_code, id and
 * availability required; price, quantity, pickup_method, pickup_sla optional.
 * pickup_cost is not sent: pickup is free (the spec requires it in the EU
 * from 30.09.2026 only where a pickup is charged).
 */
import { getSettingRaw } from "@/lib/orders";
import { listedOffers, type FeedInput } from "@/lib/merchant-feed";
import { cleanStoreCode, STORE_CODE_KEY } from "@/lib/store-code";

export { cleanStoreCode, STORE_CODE_KEY, STORE_CODE_MAX } from "@/lib/store-code";

/** The file name the feed answers at — what Dim pastes into Merchant Center. */
export const LOCAL_FEED_FILE = "google-local.xml";

/** How the salon's pickup works — see the module comment. */
export const PICKUP = { method: "buy", sla: "same day" } as const;

/** Is a database configured at all? Without one there is no setting, so the feed is off. */
function hasDatabase(): boolean {
  return !!process.env.DATABASE_URL || process.env.DB_DRIVER === "pglite";
}

/** settings.gbp_store_code, cleaned — "" when it is not set (or there is no database). Throws when the database does not answer. */
export async function loadStoreCode(): Promise<string> {
  if (!hasDatabase()) return "";
  const { found, value } = await getSettingRaw(STORE_CODE_KEY);
  return found ? cleanStoreCode(value) : "";
}

const xmlText = (s: unknown) =>
  String(s ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const el = (tag: string, value: unknown) => `<${tag}>${xmlText(value)}</${tag}>`;
const eurText = (n: number) => (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2) + " EUR";

export type LocalFeedStats = { items: number; inStock: number; outOfStock: number };

export type LocalFeedOptions = Pick<FeedInput, "overrides" | "descriptions" | "custom" | "bundles"> & {
  storeCode: string;
  base: string;
  now?: Date;
};

/** The whole local inventory feed for one store — pure: everything it reads is in `opts`. */
export function buildLocalFeed(opts: LocalFeedOptions): { xml: string; stats: LocalFeedStats } {
  const code = cleanStoreCode(opts.storeCode);
  if (!code) throw new Error("buildLocalFeed: no store code");
  const stats: LocalFeedStats = { items: 0, inStock: 0, outOfStock: 0 };
  const items = listedOffers(opts).map((o) => {
    stats.items++;
    if (o.available) stats.inStock++;
    else stats.outOfStock++;
    return "  <item>\n    " + [
      el("g:store_code", code),
      el("g:id", o.id),
      el("g:availability", o.available ? "in_stock" : "out_of_stock"),
      el("g:price", eurText(o.price)),
      el("g:pickup_method", PICKUP.method),
      el("g:pickup_sla", PICKUP.sla),
    ].join("\n    ") + "\n  </item>";
  });
  const now = (opts.now ?? new Date()).toISOString();
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n' +
    "<channel>\n" +
    `  ${el("title", "REMPIRE — Mardi 1, Tallinn")}\n` +
    `  ${el("link", opts.base + "/")}\n` +
    `  ${el("description", "Local product inventory of the Rempire salon, Mardi 1, 10145 Tallinn")}\n` +
    /* No double hyphen can reach the comment: the code is the owner's, so it is
       left out of it; the counts and the date are ours. */
    `  <!-- local inventory · ${now} · ${stats.items} items · ${stats.inStock} in stock · ${stats.outOfStock} out of stock -->\n` +
    items.join("\n") +
    (items.length ? "\n" : "") +
    "</channel>\n</rss>\n";
  return { xml, stats };
}
