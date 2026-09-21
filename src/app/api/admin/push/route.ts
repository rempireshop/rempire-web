/**
 * GET /api/admin/push/ → { ok, configured, publicKey, devices }
 *
 * What the panel asks before it draws «Уведомления на телефон»: can this
 * deployment send at all, what key does the browser need to subscribe with,
 * and which of Renat's devices are already on.
 *
 * `publicKey` is here rather than in the script because public/shop2/ is a
 * plain static file — no build step touches it, so there is no NEXT_PUBLIC_*
 * substitution to bake a key into. It is the VAPID *public* key and is meant
 * to be handed to browsers; it is still behind requireAdmin, because the list
 * of devices beside it is not, and one route is one lock.
 *
 * `configured: false` is the honest answer for a shop with no VAPID keys, and
 * the panel must read it before offering the button: a device subscribed to a
 * shop that cannot send would show «включено» and stay silent for ever. See
 * src/lib/push.ts, and src/lib/notify.ts for the letter this repeats.
 *
 * NB: trailing slash (next.config has trailingSlash: true).
 */
import { requireAdmin } from "@/lib/auth";
import { listSubscriptions, pushConfigured, pushPublicKey } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const configured = pushConfigured();
  const publicKey = pushPublicKey();
  try {
    const devices = await listSubscriptions();
    return Response.json({ ok: true, configured, publicKey, devices }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/push] the device list could not be read:", err);
    /* The two facts that do not need the database travel with the refusal, so
       a panel drawn during an outage still knows whether to say «ключи не
       настроены» or «список устройств недоступен». */
    return Response.json(
      { ok: false, error: "db_unavailable", configured, publicKey },
      { status: 503, headers: NO_STORE },
    );
  }
}
