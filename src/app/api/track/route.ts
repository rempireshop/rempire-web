/**
 * POST /api/track — the storefront's analytics beacon. Public, no cookie, no
 * account, nothing that identifies a person: see db/migrations/080_events.sql
 * and docs/analytics.md for the full shape and the privacy statement.
 *
 * Body (JSON, ≤ 1 KB): {sid, type, path?, productId?, value?, lang?, ref?}
 * — sid is the storefront's per-tab sessionStorage id, type is one of
 * db/migrations/080_events.sql's seven, ref is a bare referrer host
 * (document.referrer's hostname, computed client-side). `ua_class` and
 * `country` are never taken from the body — they come from this request's
 * own User-Agent and x-vercel-ip-country headers, which a page cannot fake
 * on its own beacon.
 *
 * Always answers fast and always answers 204 for anything it could not use —
 * a bot UA, a malformed body, a database that is not there. sendBeacon()
 * never reads the response anyway; the only codes worth telling a caller
 * apart are the abuse ones. Nothing here ever throws past its own try/catch:
 * a tracking call must not be the reason a page fails.
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { classifyUA, isBotUA, maybeSweepOldEvents, recordEvent } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 1024;
const NO_STORE = { "cache-control": "no-store" } as const;

function empty204(): Response {
  return new Response(null, { status: 204, headers: NO_STORE });
}

export async function POST(req: Request) {
  if (rateLimit("track", clientIp(req), 60, 60_000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }

  const ua = req.headers.get("user-agent");
  if (isBotUA(ua)) return empty204(); // a crawler's "session" is not traffic

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return empty204();
  }
  if (raw.length > MAX_BYTES) {
    return Response.json({ ok: false, error: "too_large" }, { status: 413, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return empty204();
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return empty204();

  try {
    await recordEvent({
      sid: body.sid,
      type: body.type,
      path: body.path,
      productId: body.productId,
      value: body.value,
      lang: body.lang,
      ref: body.ref,
      uaClass: classifyUA(ua),
      country: req.headers.get("x-vercel-ip-country"),
    });
  } catch (err) {
    // Covers "no DATABASE_URL" exactly like every failed query would — there
    // is nothing a beacon caller can do with the detail, so it is logged and
    // dropped rather than turned into a status the client never reads.
    console.error("[api/track] not recorded:", err);
  }

  // Belt-and-suspenders retention (~1-in-2000 of these calls): the events
  // table ages out on its own even if the cron in vercel.json is never
  // wired up on this host. See docs/analytics.md.
  void maybeSweepOldEvents();

  return empty204();
}

export function GET() {
  return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
