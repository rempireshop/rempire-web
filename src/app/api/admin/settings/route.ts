/**
 * PUT /api/admin/settings — shop-wide switches.
 *
 *   { "chatbot": false }
 *   { "flows": { "abandoned": true, "birthday": false, "backstock": true } }
 *   { "settings": { "shipping": { "freeFrom": 59 } } }
 *
 * Each top-level key becomes one row in `settings`; the value is stored as
 * jsonb exactly as sent. GET returns the whole map (admin only — the public
 * copy lives at /api/overrides).
 */
import { requireAdmin } from "@/lib/auth";
import { getSettings, setSetting, writeAuditSafe } from "@/lib/orders";
import { cleanPricing } from "@/lib/loyalty";
import { parseShippingRules } from "@/lib/shipping";
import { cleanMailTexts } from "@/emails/texts";
import { cleanGiftAmounts } from "@/lib/giftcards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY_RE = /^[a-z0-9_.-]{1,64}$/i;

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    return Response.json({ ok: true, settings: await getSettings() }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/settings] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}

export async function PUT(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  /* The biggest thing this route ever legitimately carries is the shop's own
     content document (hero slides, the contact page, the mail texts in three
     languages) — tens of kilobytes. Nothing capped the request, and a key
     outside the five validated ones is stored as raw jsonb AND written a
     second time into admin_audit, so one request could persist twice its own
     size for good. Same cap and the same code as the other admin writers. */
  const MAX_BYTES = 256_000;
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  if (raw.length > MAX_BYTES) return Response.json({ ok: false, error: "too_large" }, { status: 413 });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
  }

  // {key, value} · {settings:{…}} · a flat map — all mean the same thing here.
  let entries: Array<[string, unknown]>;
  if (typeof body.key === "string" && "value" in body) entries = [[body.key, body.value]];
  else if (body.settings && typeof body.settings === "object") entries = Object.entries(body.settings as object);
  else entries = Object.entries(body);

  if (!entries.length || entries.length > 50) return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
  for (const [key] of entries) {
    if (!KEY_RE.test(key)) return Response.json({ ok: false, error: "bad_key", detail: key }, { status: 400 });
  }

  try {
    for (let [key, value] of entries) {
      // wholesale/loyalty: clamp to sane bounds regardless of who is
      // writing (panel form, demoApply's undo, or the assistant's
      // set_pricing action) — the same "first door, not the only one"
      // reasoning as every other validated setting.
      if (key === "pricing") value = cleanPricing(value);
      // the same parser the checkout reads with — a rule the storefront would
      // ignore (NaN, 1e9, a negative) is normalised here instead of stored raw
      if (key === "shipping_rules") value = parseShippingRules(value);
      /* «Письма»: the owner's subject / intro / signature per letter and
         language. Unknown template or language keys are dropped, control
         characters stripped and every string clamped (200/1500/300) before
         anything is stored — src/emails/texts.ts cleanMailTexts(). The
         letters escape it again at render time; this is the first door. */
      if (key === "mail_texts") value = cleanMailTexts(value);
      /* «Подарочные карты»: which denominations the /gift/ page offers. Kept to
         a subset of the amounts the checkout will actually accept
         (GIFT_AMOUNTS), sorted and de-duplicated, and never empty — a gift page
         with no button on it is a page that cannot sell. Same "first door, not
         the only one" reasoning as pricing and shipping_rules above. */
      if (key === "gift_amounts") value = cleanGiftAmounts(value);
      await setSetting(key, value);
      await writeAuditSafe("admin", "setting.set", { key, value });
      /* src/lib/shipping.ts caches the tariff row for a minute. Without this
         the owner saves a price in «Настройки → Доставка» and the very next
         checkout still bills the old one — which is exactly the "the panel
         says one thing, the shop charges another" the editor exists to fix. */
      if (key === "shipping_rules") {
        try {
          (await import("@/lib/shipping")).resetShippingRulesCache();
        } catch {
          // no shipping module, nothing to invalidate
        }
      }
    }
    return Response.json({ ok: true, settings: await getSettings() }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/settings] write failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
