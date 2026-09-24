/**
 * GET /api/cron/flows — the only scheduled job the shop has.
 *
 * Runs the three automatic letters (`src/lib/flows.ts`) and answers with what
 * it did. Calling it twice in a minute sends nothing twice, and a missed run
 * catches up on the next one.
 *
 * What makes that true is worth naming exactly, because the answer is not the
 * one this comment used to give. The row stamps (`reminded_at`,
 * `birthday_sent_year`, `unpaidRemindedAt`) are unconditional updates AFTER a
 * shared SELECT, so two overlapping runs both select the same rows. The thing
 * that stops the second letter is the `Idempotency-Key` on the send itself
 * (`src/lib/mail.ts`: `cart:<id>`, `bday:<id>:<year>`, `stock:<id>`,
 * `unpaid:<number>`) and Resend's 24-hour window behind it. The unpaid CANCEL
 * is genuinely atomic — it goes through setOrderStatus()'s `unless` guard. At
 * 3-5 orders a month none of this bites; it is written down so the next person
 * does not lean on a guarantee we do not have (audit F48).
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
import { resumeParkedNewsletters } from "@/lib/newsletters";
import { reconcileUnpaidOrders } from "@/lib/payments/reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* A run walks at most 100 carts, 100 alerts and 100 birthdays; the default 10 s
   is not enough for a hundred round trips to Resend. */
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

/** `abandoned: sent 1, skipped 2 (too_fresh) · abandonedDiscount: …` — counts and codes only, never an address. */
function flowsLogLine(report: Awaited<ReturnType<typeof runFlows>>): string {
  const flows = ["abandoned", "abandonedDiscount", "backstock", "birthday", "unpaid"] as const;
  const s = report.shipments;
  /* The parcel backup poll (src/lib/shipping/shipment-sync.ts) on the same
     line: a lost webhook it found is otherwise visible nowhere. */
  const parcels = s
    ? ` · shipments: checked ${s.checked}, changed ${s.changed}, errors ${s.errors}${s.reason ? ` (${s.reason})` : ""}`
    : "";
  return (
    flows
      .map((k) => {
        const r = report[k];
        return `${k}: sent ${r.sent}, skipped ${r.skipped}${r.reason ? ` (${r.reason})` : ""}`;
      })
      .join(" · ") + parcels + ` · ${report.ms} ms`
  );
}

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
  const started = Date.now();
  if (!(process.env.CRON_SECRET ?? "").trim()) {
    return Response.json({ ok: false, error: "not_configured" }, { status: 503, headers: NO_STORE });
  }
  if (!authorized(req)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  try {
    const report = await runFlows();
    /* One line in the log per morning (Dim, 23.09.2026: an abandoned-cart
       letter that did not come, and nothing anywhere to say whether the 07:00
       run had even looked at the basket). The panel's «Последний запуск» says
       the same thing per letter; this is the copy that survives in Vercel's
       log beside everything else that happened at that hour. */
    console.info(`[api/cron/flows] ${flowsLogLine(report)}`);
    /* …and, on the same daily trip, the lost-webhook sweep
       (/api/cron/payments-reconcile, src/lib/payments/reconcile.ts). It rides
       here because Vercel's Hobby plan allows exactly two cron jobs and both
       slots are taken (docs/HOSTING.md); the route of its own exists so that
       moving to Pro is a `vercel.json` line and nothing else.

       Entirely separate from the letters above — it shares no settings, no
       stamps and no queries with them, and in particular nothing with the
       seven-day «unpaid» cancel, which is a different feature and is off.
       Its own failure must never cost Renat his morning letters, so it is
       caught here rather than in the handler's catch. */
    let reconciled;
    try {
      reconciled = await reconcileUnpaidOrders();
    } catch (err) {
      console.error("[api/cron/flows] the payment sweep failed:", err);
      reconciled = { error: "failed" };
    }
    /* …and the campaigns that ran out of day. A «Рассылка» bigger than the
       free plan's hundred letters stops at the cap and parks itself
       (src/lib/mail-budget.ts, src/lib/newsletters.ts): nothing in a
       serverless shop would ever call it back, because the panel only loops
       while the tab is open. This is the call-back. It runs LAST of the three
       — the automatic letters and the payment sweep are about orders and
       people waiting for them, and this one is content to take another day.
       Its own failure is caught here for the same reason the sweep's is. */
    let newsletters;
    try {
      /* Whatever is left of this function's minute, less a margin for the
         answer: a whole day's allowance fits (70 letters at Resend's two a
         second is 35 s), where the library's own 20 s would leave a third of
         it for the morning after. */
      newsletters = await resumeParkedNewsletters({ budgetMs: Math.max(5_000, 50_000 - (Date.now() - started)) });
    } catch (err) {
      console.error("[api/cron/flows] the parked campaigns failed:", err);
      newsletters = { error: "failed" };
    }
    return Response.json(
      { ok: true, ...report, payments: reconciled, newsletters },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("[api/cron/flows] failed:", err);
    return Response.json({ ok: false, error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}

/** Same job, same secret — for a scheduler that can only POST. */
export const POST = GET;
