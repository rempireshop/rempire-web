/**
 * GET/POST /api/cron/events-retention — deletes analytics events older than
 * 90 days. Same shape as /api/cron/flows: a shared secret in the header,
 *
 *   authorization: Bearer <CRON_SECRET>
 *
 * which is exactly what Vercel Cron sends once CRON_SECRET is set and this
 * path is registered in vercel.json. With no secret configured the route
 * refuses everything.
 *
 * Belt-and-suspenders: POST /api/track also runs this sweep itself on
 * roughly 1-in-2000 calls (src/lib/events.ts maybeSweepOldEvents), so the
 * table still ages out on a hosting plan where this cron was never wired up
 * or where a plan's cron-job quota left it out. This route is still the
 * correct, on-schedule way to do it — see docs/analytics.md.
 */
import { timingSafeEqual } from "node:crypto";
import { deleteOldEvents } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const RETENTION_DAYS = 90;

function authorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false;
  const header = (req.headers.get("authorization") ?? "").trim();
  const bearer = /^bearer\s+/i.test(header) ? header.replace(/^bearer\s+/i, "") : "";
  if (!bearer) return false;
  const want = Buffer.from(secret);
  const got = Buffer.from(bearer);
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function GET(req: Request) {
  if (!(process.env.CRON_SECRET ?? "").trim()) {
    return Response.json({ ok: false, error: "not_configured" }, { status: 503, headers: NO_STORE });
  }
  if (!authorized(req)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  try {
    const deleted = await deleteOldEvents(RETENTION_DAYS);
    return Response.json({ ok: true, deleted, days: RETENTION_DAYS }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/cron/events-retention] failed:", err);
    return Response.json({ ok: false, error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}

/** Same job, same secret — for a scheduler that can only POST. */
export const POST = GET;
