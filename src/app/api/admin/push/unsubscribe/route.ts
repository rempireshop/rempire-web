/**
 * POST /api/admin/push/unsubscribe/  { endpoint } → { ok, removed }
 *
 * «Выключить» — for this device, or for one of the others in the list. The
 * endpoint is the id; the panel has it from `pushManager.getSubscription()`
 * for the phone in his hand, and from GET /api/admin/push/ for the rest.
 *
 * The browser's own `subscription.unsubscribe()` is the other half and the
 * panel should call it for the device it is running on — but only this side
 * can turn off the Mac from the phone, and only this side stops the shop
 * sending to a device whose browser is never opened again.
 *
 * `removed: false` is not an error. It means no LIVE row carried that
 * endpoint — already off, or already retired by the push service — so the
 * panel can redraw the list instead of showing a failure for work that was
 * already done.
 *
 * Unlike the subscribe route this does NOT ask whether VAPID keys are
 * configured. Turning a device off must work on a shop whose keys have just
 * been pulled; a switch that only opens when the thing it guards is healthy
 * is a switch that is stuck at the worst moment.
 *
 * NB trailing slash: next.config has trailingSlash:true — POST to
 * "/api/admin/push/unsubscribe/" or the request 308s and the body is dropped.
 */
import { requireAdmin } from "@/lib/auth";
import { removeSubscription } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 4_000;
const NO_STORE = { "cache-control": "no-store" } as const;

export async function POST(req: Request): Promise<Response> {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  if (raw.length > MAX_BYTES) {
    return Response.json({ ok: false, error: "too_large" }, { status: 413, headers: NO_STORE });
  }

  let body: { endpoint?: unknown };
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400, headers: NO_STORE });
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint) {
    return Response.json({ ok: false, error: "bad_endpoint" }, { status: 400, headers: NO_STORE });
  }

  try {
    const removed = await removeSubscription(endpoint, "owner");
    return Response.json({ ok: true, removed }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/push/unsubscribe] the device could not be retired:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}

export function GET(): Response {
  return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
