/**
 * GET /api/admin/shipping/rates/?country=EE — the best tariff Montonio (or
 * the static price-list table) has for each carrier+method in one country.
 *
 * Thin wrapper over src/lib/shipping/tariffs.ts's getMontonioTariffsForCountry()
 * — live when MONTONIO_ACCESS_KEY/SECRET_KEY are set and carriers are
 * activated in the partner portal (cached 24h there), the static table
 * otherwise. Each row already carries its own `source: "live" | "static"`,
 * so the admin's shipping-settings tab (public/shop2/app.js, shipRulesCard)
 * can label the grey hint under EE/LV/LT/FI accordingly instead of always
 * assuming the static price list. requireAdmin: this is the door
 * docs/shipping.md § «Тарифы Montonio» describes as "a future admin route".
 */
import { requireAdmin } from "@/lib/auth";
import { getMontonioTariffsForCountry } from "@/lib/shipping/tariffs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COUNTRIES = new Set(["EE", "LV", "LT", "FI"]);

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const country = String(url.searchParams.get("country") || "EE").toUpperCase();
  if (!COUNTRIES.has(country)) {
    return Response.json({ ok: false, error: "bad_country" }, { status: 400 });
  }

  try {
    const rates = await getMontonioTariffsForCountry(country);
    return Response.json({ ok: true, country, rates }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/shipping/rates] failed:", err);
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
