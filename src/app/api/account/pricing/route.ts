/**
 * GET /api/account/pricing — the signed-in shopper's own pricing.
 *
 * `{ok, tier, proDiscountPct, proMinOrder, proPrices}`. `proPrices` is a
 * `{productId: price}` map covering the whole catalogue, computed the same
 * way src/lib/orders.ts priceItems() prices a pro line (per-product
 * pro_price override, else base price × (1 − proDiscountPct/100)) — the
 * storefront recomputes cards/product/cart with it after login, and
 * `proMinOrder` is what the basket needs to reach before these prices apply
 * (0 = always), the same gate app.js already applies to a promo code's own
 * minSubtotal.
 *
 * Requires the `rmp_cust` cookie. A signed-in but retail customer gets a
 * well-formed, empty answer (tier:"retail", no prices) rather than a 401 —
 * this route's job is "what does THIS shopper see", and a retail shopper
 * sees nothing special. Never called for an anonymous visitor: the pro
 * discount must never reach one (docs/loyalty.md).
 */
import catalogueMin from "@/data/catalogue.min.json";
import { sessionEmail, getCustomer } from "@/lib/customers";
import { getOverrides } from "@/lib/orders";
import { getPricingSettings, proUnitPrice, type PricingSettings } from "@/lib/loyalty";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

type MinProduct = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as MinProduct[];

async function proPricesFor(pricing: PricingSettings): Promise<Record<string, number>> {
  const overrides = await getOverrides();
  const out: Record<string, number> = {};
  for (const p of CATALOGUE) {
    const o = overrides[p.id];
    const base = o?.price ?? p.p;
    out[p.id] = proUnitPrice(base, base, o?.proPrice ?? null, pricing.proDiscountPct);
  }
  return out;
}

export async function GET(req: Request) {
  const email = sessionEmail(req);
  if (!email) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  try {
    const customer = await getCustomer(email);
    if (!customer || customer.tier !== "pro") {
      return Response.json(
        { ok: true, tier: customer?.tier ?? "retail", proDiscountPct: 0, proMinOrder: 0, proPrices: {} },
        { headers: NO_STORE },
      );
    }
    const pricing = await getPricingSettings();
    const proPrices = await proPricesFor(pricing);
    return Response.json(
      { ok: true, tier: "pro", proDiscountPct: pricing.proDiscountPct, proMinOrder: pricing.proMinOrder, proPrices },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("[api/account/pricing] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
