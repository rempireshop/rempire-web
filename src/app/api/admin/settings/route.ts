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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
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
