/**
 * The shape of Shopify's cart permalink — `/cart/<id>:<qty>[,<id>:<qty>…]` —
 * which Merchant Center's «Checkout» link is built on. Pure, and its one
 * import is too, because src/middleware.ts (the edge) has to recognise it
 * before the legacy `/cart/*` redirect fires; what the ids mean is
 * src/lib/merchant-cart.ts.
 */
import { langFromAcceptLanguage } from "@/lib/shop-paths.mjs";

/** The storefront's own ceiling for one basket line (CART_MAX_QTY in app.js, `bad_qty` in orders.ts). */
export const CART_LINK_MAX_QTY = 99;

/** One `<id>:<qty>` of the permalink. */
export type CartLinkLine = { id: string; qty: number };

/**
 * The shape and nothing else, with or without a trailing slash (the
 * middleware lets this one shape through untouched, slash and all).
 * Shopify's variant ids were digits; ours are
 * `[a-z0-9-]` plus `_` before a size, and a custom product's `c-…`.
 */
const PERMALINK = /^\/cart\/([A-Za-z0-9_%.-]+:\d{1,6}(?:,[A-Za-z0-9_%.-]+:\d{1,6})*)\/?$/;

/** Is this path a cart permalink? */
export function isCartPermalink(pathname: string): boolean {
  return PERMALINK.test(String(pathname || ""));
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The lines of a permalink, quantities clamped to 1…99; null for any other path. */
export function parseCartPermalink(pathname: string): CartLinkLine[] | null {
  const m = PERMALINK.exec(String(pathname || ""));
  if (!m) return null;
  return m[1].split(",").map((part) => {
    const at = part.lastIndexOf(":");
    const qty = Math.round(Number(part.slice(at + 1)));
    return {
      id: safeDecode(part.slice(0, at)),
      qty: Math.max(1, Math.min(CART_LINK_MAX_QTY, Number.isFinite(qty) ? qty : 1)),
    };
  });
}

/**
 * Which of the shop's three languages to open, as its path prefix: the first
 * of Estonian, Russian and English the browser asks for — "et", "ru", or ""
 * for English, which is the unprefixed one since 08.10.2026 — and English for
 * any other. The link carries no language of its own, and one template serves
 * all three feeds. The same reading of the header src/middleware.ts makes for
 * an unprefixed page (langFromAcceptLanguage in src/lib/shop-paths.mjs).
 */
export function segFromAcceptLanguage(header: string | null | undefined): string {
  const lang = langFromAcceptLanguage(header);
  return lang === "RU" ? "ru" : lang === "ET" ? "et" : "";
}
