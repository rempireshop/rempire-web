/**
 * GET /api/partner/products/lookup — the booking app finds a product
 * (docs/partner-api.md). Behind BOOKING_API_SECRET (src/lib/partner-auth.ts).
 *
 * Exactly one of:
 *   ?barcode=<EAN>                      the code on the bottle — hidden products too
 *   ?q=<text>&limit=<1..20, default 10> brand / name in RU, ET or EN, ≥ 2 characters,
 *                                       on-sale products only
 *   ?id=<productId>&variant=<size>      one size — hidden products too
 * plus, optionally, &lang=ru|et|en (default ru) for the name and the size.
 *
 * 200 {"items": [Product]} — an empty list when nothing matches.
 * 400 {"error": "bad_request"} for anything else.
 * 429 {"error": "rate_limited"} past 120 requests a minute (src/lib/partner-auth.ts),
 *     with Retry-After. Never cached. Reads only.
 */
import { partnerJson, partnerOverBudget, requirePartner } from "@/lib/partner-auth";
import { lookupByBarcode, lookupById, PARTNER_LANGS, searchProducts, type PartnerLang } from "@/lib/partner-products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BAD = { error: "bad_request" } as const;

export async function GET(req: Request) {
  const denied = requirePartner(req);
  if (denied) return denied;
  const over = partnerOverBudget("lookup");
  if (over) return over;

  const sp = new URL(req.url).searchParams;
  const langRaw = (sp.get("lang") ?? "ru").trim().toLowerCase();
  if (!(PARTNER_LANGS as readonly string[]).includes(langRaw)) return partnerJson(BAD, 400);
  const lang = langRaw as PartnerLang;

  const picked = ["barcode", "q", "id"].filter((k) => sp.has(k));
  if (picked.length !== 1) return partnerJson(BAD, 400);

  try {
    if (picked[0] === "barcode") {
      if (sp.has("limit") || sp.has("variant")) return partnerJson(BAD, 400);
      const code = (sp.get("barcode") ?? "").trim();
      if (!/^[A-Za-z0-9-]{4,64}$/.test(code)) return partnerJson(BAD, 400);
      return partnerJson({ items: await lookupByBarcode(code, lang) });
    }

    if (picked[0] === "q") {
      if (sp.has("variant")) return partnerJson(BAD, 400);
      const q = (sp.get("q") ?? "").trim();
      if (q.length < 2 || q.length > 120) return partnerJson(BAD, 400);
      let limit = 10;
      if (sp.has("limit")) {
        const raw = (sp.get("limit") ?? "").trim();
        if (!/^\d{1,2}$/.test(raw)) return partnerJson(BAD, 400);
        limit = Number(raw);
        if (limit < 1 || limit > 20) return partnerJson(BAD, 400);
      }
      return partnerJson({ items: await searchProducts(q, limit, lang) });
    }

    if (sp.has("limit")) return partnerJson(BAD, 400);
    const id = (sp.get("id") ?? "").trim();
    const variant = (sp.get("variant") ?? "").trim();
    if (!id || id.length > 200 || variant.length > 120) return partnerJson(BAD, 400);
    return partnerJson({ items: await lookupById(id, variant, lang) });
  } catch (err) {
    console.error("[api/partner/products/lookup] failed:", err);
    return partnerJson({ error: "server_error" }, 500);
  }
}
