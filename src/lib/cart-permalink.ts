/**
 * The shape of Shopify's cart permalink — `/cart/<id>:<qty>[,<id>:<qty>…]` —
 * which Merchant Center's «Checkout» link is built on. Pure and dependency-
 * free, because src/middleware.ts (the edge) has to recognise it before the
 * legacy `/cart/*` redirect fires; what the ids mean is src/lib/merchant-cart.ts.
 */

/** The storefront's own ceiling for one basket line (CART_MAX_QTY in app.js, `bad_qty` in orders.ts). */
export const CART_LINK_MAX_QTY = 99;

/** One `<id>:<qty>` of the permalink. */
export type CartLinkLine = { id: string; qty: number };

/**
 * The shape and nothing else, with or without the trailing slash
 * `trailingSlash: true` adds. Shopify's variant ids were digits; ours are
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
 * Which of the shop's three languages to open: the first of Estonian,
 * Russian and English the browser asks for, English for any other — the
 * link carries no language of its own, and one template serves all three
 * feeds.
 */
export function segFromAcceptLanguage(header: string | null | undefined): string {
  const tags = String(header || "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { lang: tag.trim().toLowerCase().split("-")[0], q: q ? Number(q.slice(2)) || 0 : 1 };
    })
    .filter((t) => t.lang && t.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const t of tags) {
    if (t.lang === "et") return "et";
    if (t.lang === "ru") return "";
    if (t.lang === "en") return "en";
  }
  return "en";
}
