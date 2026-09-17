/**
 * POST /api/promos/check   { code, subtotal?, shipping?, items? }
 *   → { ok: true,  code, kind, value, discount, freeShipping, minSubtotal,
 *                  scope, scopeValue, base }
 *   → { ok: false, error, scope, scopeValue }
 *
 * The checkout's «Промокод» box. Read-only: it quotes what the code would take
 * off this basket and spends nothing — the use is counted when the payment is
 * confirmed (src/lib/payments/apply.ts).
 *
 * `items` is the basket line by line — `[{id, brand, sum}]`, the gift cards
 * already left out by the caller. A code narrowed to one brand or one product
 * (db/migrations/170_promo_scope.sql) is priced on the lines it matches, so
 * without them there is nothing to price and the answer is `no_match`. The
 * BRAND of a line is taken from the catalogue whenever the id is one the shop
 * sells, never from the body: a shopper's browser must not be able to tell the
 * shop that its bottle is a Davines one. What a line COSTS still comes from the
 * body, exactly as `subtotal` always has — this endpoint draws a preview, and
 * createOrder() re-prices every cent of it from the catalogue before anyone is
 * charged.
 *
 * Public, so it is rate-limited per IP: 20 tries a minute is generous for a
 * shopper retyping a code and useless for walking the code space. Errors are
 * deliberately specific («срок вышел», «не хватает до 40 €», «в корзине нет
 * товаров Davines») — the code was printed on a flyer, and «неверный код» for
 * an expired one just costs Renat a support message.
 *
 * NB: POST to "/api/promos/check/" WITH the trailing slash (trailingSlash: true).
 */
import catalogueMin from "@/data/catalogue.min.json";
import { clientIp, rateLimit } from "@/lib/auth";
import { normalisePromoCode, quotePromo, type PromoBasketLine } from "@/lib/promos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8_000;
const MAX_LINES = 60;
const NO_STORE = { "cache-control": "no-store" } as const;

const BRAND_BY_ID = new Map(
  (catalogueMin as Array<{ id: string; b: string }>).map((p) => [p.id, p.b]),
);

/**
 * The basket, rebuilt from a whitelist — id, brand and a clamped sum, nothing
 * else. A line whose id the shop knows gets the catalogue's brand; anything
 * else (a set, a custom product, a line this build has never heard of) keeps
 * the brand the body sent, because the alternative is telling a shopper his
 * code does not apply to goods it will in fact apply to at checkout.
 */
function cleanLines(raw: unknown): PromoBasketLine[] | null {
  if (!Array.isArray(raw)) return null;
  const out: PromoBasketLine[] = [];
  for (const item of raw.slice(0, MAX_LINES)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const x = item as Record<string, unknown>;
    const id = String(x.id ?? "").slice(0, 120);
    if (!id) continue;
    const known = BRAND_BY_ID.get(id);
    const brand = known ?? (typeof x.brand === "string" ? x.brand.slice(0, 80) : "");
    const sum = Math.max(0, Math.min(100_000, Number(x.sum) || 0));
    /* «gift:100» lines are refused by promoLineMatches() whatever arrives, so
       the kind is carried through rather than trusted: one rule, one file. */
    out.push({ id, brand, sum, kind: typeof x.kind === "string" ? x.kind.slice(0, 20) : "product" });
  }
  return out;
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (rateLimit("promo-check", ip, 20, 60_000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  if (raw.length > MAX_BYTES) {
    return Response.json({ ok: false, error: "too_large" }, { status: 413, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  /* `null`, `5` and `[]` are all valid JSON and all crash on body.code — the
     literal string "null" parses to null, which typeof still calls "object". */
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400, headers: NO_STORE });
  }

  const code = normalisePromoCode(body.code);
  if (!code) {
    return Response.json({ ok: false, error: "bad_code" }, { status: 400, headers: NO_STORE });
  }

  const subtotal = Math.max(0, Math.min(100_000, Number(body.subtotal) || 0));
  const shipping = Math.max(0, Math.min(1_000, Number(body.shipping) || 0));
  const items = cleanLines(body.items);

  try {
    const quote = await quotePromo(code, subtotal, shipping, items);
    if (!quote.ok) {
      /* The scope travels with the refusal too: «не хватает до 40 €» has to be
         able to say «до 40 € товаров Davines», and «в корзине нет ничего
         подходящего» has to be able to name what is missing. */
      return Response.json(
        {
          ok: false,
          error: quote.error,
          code,
          minSubtotal: quote.minSubtotal,
          scope: quote.scope,
          scopeValue: quote.scopeValue,
          base: quote.base,
        },
        { status: 200, headers: NO_STORE },
      );
    }
    return Response.json(
      {
        ok: true,
        code: quote.code,
        kind: quote.kind,
        value: quote.value,
        discount: quote.discount,
        freeShipping: quote.freeShipping,
        minSubtotal: quote.minSubtotal,
        scope: quote.scope,
        scopeValue: quote.scopeValue,
        base: quote.base,
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("[api/promos/check] failed:", err);
    // No database is not «код неверный» — say so, so the shopper retries later
    return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
