/**
 * GET/POST /api/cron/payments-reconcile — the lost-webhook safety net.
 *
 * Asks Montonio about every order that is still «ждёт оплаты» and settles the
 * ones that turn out to have been paid all along. What it does and why is in
 * src/lib/payments/reconcile.ts; this file is only the door.
 *
 * Same shape and the same shared secret as the other two jobs:
 *
 *   authorization: Bearer <CRON_SECRET>
 *
 * which is what Vercel Cron sends by itself once CRON_SECRET is set. With no
 * secret configured the route refuses everything — an open endpoint that can
 * mark orders paid is not a thing to leave lying around.
 *
 * **It has no entry of its own in `vercel.json`, on purpose.** The shop is on
 * Vercel's Hobby plan, which allows two cron jobs and no more (docs/HOSTING.md),
 * and both slots are taken. So the sweep is also run at the end of
 * /api/cron/flows, which already fires once a day — that is what makes it work
 * while Renat is asleep, with no third slot. The day the project moves to Pro
 * (docs/HOSTING.md says it must, because Hobby forbids commercial use), give
 * this path its own hourly entry and the money sits unclaimed for an hour
 * instead of a day. Running it from both places is harmless: settling is
 * idempotent, and a second pass finds nothing left to do.
 */
import { timingSafeEqual } from "node:crypto";
import { reconcileUnpaidOrders } from "@/lib/payments/reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* Up to 50 orders × one round trip to Montonio each (15 s timeout apiece in
   the worst case). The default 10 s is not enough for a bad day. */
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
    const report = await reconcileUnpaidOrders();
    return Response.json({ ok: true, ...report }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/cron/payments-reconcile] failed:", err);
    return Response.json({ ok: false, error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}

/** Same job, same secret — for a scheduler that can only POST. */
export const POST = GET;
