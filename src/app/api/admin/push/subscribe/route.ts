/**
 * POST /api/admin/push/subscribe/  { endpoint, keys: { p256dh, auth }, label }
 *   → { ok, device }
 *
 * «Включить уведомления» — the panel hands over what
 * `pushManager.subscribe()` gave it, exactly as `JSON.stringify(sub)` writes
 * it, plus a name for the device so the list can tell his iPhone from his Mac.
 *
 * Safe to call on every boot of the panel, and it is meant to be: the endpoint
 * is the primary key, so a hundred calls from one browser leave one row
 * (src/lib/push.ts saveSubscription). That is also what repairs a subscription
 * the browser has rotated — there is no `pushsubscriptionchange` handler in
 * the worker, on purpose, and this is why there does not need to be.
 *
 * REFUSES rather than degrades when the shop has no VAPID keys. Everything
 * else in this shop's notification path goes quiet when it is unconfigured —
 * but a saved subscription is a promise on screen, and «включено» over a shop
 * that cannot send is the RESEND_TO mistake again (src/lib/notify.ts).
 *
 * NB trailing slash: next.config has trailingSlash:true — POST to
 * "/api/admin/push/subscribe/" or the request 308s and the body is dropped.
 */
import { requireAdmin } from "@/lib/auth";
import { cleanSubscription, pushConfigured, saveSubscription } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 4_000;
const NO_STORE = { "cache-control": "no-store" } as const;

export async function POST(req: Request): Promise<Response> {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  if (!pushConfigured()) {
    return Response.json(
      { ok: false, error: "not_configured" },
      { status: 503, headers: NO_STORE },
    );
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

  let body: { label?: unknown };
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400, headers: NO_STORE });
  }
  /* `null` is valid JSON and `typeof null === "object"`; so are a bare number,
     a string and an array. Every field read below would throw on those — a 500
     from a two-byte body (the same door src/app/api/admin/mail/test guards). */
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400, headers: NO_STORE });
  }

  const sub = cleanSubscription(body, body.label);
  if (!sub) {
    return Response.json({ ok: false, error: "bad_subscription" }, { status: 400, headers: NO_STORE });
  }

  try {
    const device = await saveSubscription(sub);
    return Response.json({ ok: true, device }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/push/subscribe] the device could not be saved:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}

export function GET(): Response {
  return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
