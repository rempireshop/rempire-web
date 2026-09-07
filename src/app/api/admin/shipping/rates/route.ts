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
 *
 * The country whitelist is the tariff table's own list — the four the
 * checkout names plus every other European country Montonio quotes out of
 * Estonia — so a question about Germany gets an answer instead of a 400.
 * `?returns=1` answers a different question on the same door: whether the
 * return switch is on, per carrier contract. See below.
 */
import { requireAdmin } from "@/lib/auth";
import { fetchMontonioCarrierReturns } from "@/lib/shipping/montonio";
import { getMontonioTariffsForCountry, tariffCountries } from "@/lib/shipping/tariffs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);

  /*
   * `?returns=1` — is the return switch on?
   *
   * Montonio's Shipping API has no return endpoint at all; the only thing it
   * will say about returns is `contracts[].returnsAllowed` on GET /carriers
   * (src/lib/shipping/montonio.ts). Returns are enabled by ticking «Yes, send
   * SMS return code» per carrier in the partner portal, and the return code
   * goes to the customer by SMS — the merchant never sees it. So this answers
   * the one question that can be answered from here: is it switched on, and
   * for how many days. `contracts: null` means no keys, or Montonio would not
   * answer; an empty array means keys but no carrier contracts yet.
   */
  if (url.searchParams.get("returns")) {
    const contracts = await fetchMontonioCarrierReturns();
    return Response.json(
      { ok: true, contracts, configured: contracts !== null },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const country = String(url.searchParams.get("country") || "EE").toUpperCase();
  if (!tariffCountries().includes(country)) {
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
