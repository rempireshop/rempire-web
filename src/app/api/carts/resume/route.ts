/**
 * GET /api/carts/resume/?t=<token>
 *   → { ok: true, items: [{ id, size, qty }], code: "REM-CART-…" | "" }
 *   → { ok: false, error: "bad_token" }
 *
 * The verified read of the link the abandoned-cart letters carry
 * (`/shop2/checkout/?resume=…`, src/lib/flows.ts makeResumeToken).
 *
 * The storefront already decodes that payload by itself and refills the
 * basket from it (resumeCart(), public/shop2/app.js), and that is fine
 * *because of what it trusts*: catalogue ids at a capped quantity, nothing
 * that is not on sale, which is exactly what a shopper could type into their
 * own basket by hand. The worst a forged link can do there is put products
 * into its own reader's cart.
 *
 * A promo CODE is not in that category. The second letter's code rides inside
 * the token (`p`), and a code read out of an unverified payload is a string
 * anybody could have written — so the shop must not say «скидка применена»
 * on the strength of it. This route checks the HMAC before it answers, which
 * makes it the one place a code from a letter can be believed. Nothing is
 * spent here either way: the checkout looks the code up and prices it like
 * any other (quotePromo), and a `cart` code that meets a basket it was not
 * written for simply finds no lines to discount.
 *
 * No address is involved — the token deliberately carries none — so there is
 * nothing here to gate behind a session, and the letter is opened in a
 * browser that has never seen this shop.
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { readResumeToken } from "@/lib/flows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request) {
  if (rateLimit("cart-resume", clientIp(req), 60, 60_000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }
  const token = new URL(req.url).searchParams.get("t");
  /* One answer for a forged token, a stale one and a malformed one: telling
     the three apart would be telling a guesser which of them he had. */
  const payload = readResumeToken(token);
  if (!payload) {
    return Response.json({ ok: false, error: "bad_token" }, { status: 400, headers: NO_STORE });
  }
  return Response.json({ ok: true, ...payload }, { headers: NO_STORE });
}
