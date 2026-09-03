/**
 * GET /api/cron/flows — the only scheduled job the shop has.
 *
 * Runs the three automatic letters (`src/lib/flows.ts`) and answers with what
 * it did. Idempotent: every send stamps its row before the letter leaves, so
 * calling this twice in a minute sends nothing twice, and a missed run catches
 * up on the next one.
 *
 * Auth is a shared secret in the header:
 *
 *   authorization: Bearer <CRON_SECRET>
 *
 * which is exactly what Vercel Cron sends by itself once `CRON_SECRET` is set
 * in the project's environment. With no secret configured the route refuses
 * everything — an open endpoint that mails customers is not a thing to leave
 * lying around. See docs/flows.md.
 */
import { timingSafeEqual } from "node:crypto";
import { runFlows } from "@/lib/flows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* A run walks at most 100 carts, 100 alerts and 100 birthdays; the default 10 s
   is not enough for a hundred round trips to Resend. */
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

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
    const report = await runFlows();
    return Response.json({ ok: true, ...report }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/cron/flows] failed:", err);
    return Response.json({ ok: false, error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}

/** Same job, same secret — for a scheduler that can only POST. */
export const POST = GET;
