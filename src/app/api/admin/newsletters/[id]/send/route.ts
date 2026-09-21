/**
 * POST /api/admin/newsletters/<id>/send/  — one call's worth of sending
 * GET  /api/admin/newsletters/<id>/send/  — where it stands, without sending
 *
 * One call's worth of sending (src/lib/newsletters.ts sendNewsletterBatch):
 * the first call freezes the audience into `newsletter_sends` and starts,
 * every call sends what fits in the function's budget and answers
 *
 *   { ok: true, done, sent, failed, left, total, status, retryAfterMs?,
 *     parked?, budget, plan, newsletter }
 *
 * — `done:false` means «call again»: the panel loops until `done`, and a
 * call that never came back (a closed tab, a dead function) is picked up by
 * the next one, «Продолжить». Idempotent throughout: an address gets the
 * letter once however many calls it takes, and a letter already sent is
 * refused with 409.
 *
 * `parked:true` is the one case where `done:false` does NOT mean «call
 * again»: the day's marketing allowance is spent (src/lib/mail-budget.ts) and
 * the rest goes out tomorrow, carried by the daily cron — «отправлено 70 из
 * 180, продолжится завтра». `budget` says where the day stands and `plan` how
 * long the rest will take; both are read-only and come back from the GET as
 * well, so the panel can print «сегодня отправлено N из CAP · рассылке
 * доступно M» before anybody presses anything.
 *
 * Refusals, all 4xx JSON for the panel to word: `not_found`, `already_sent`,
 * `busy` (another call holds the lease), `empty_body`, `no_subject`,
 * `no_recipients`; `no_api_key` (503) when nothing can leave this deployment
 * — checked before a single row is queued.
 *
 * NB trailing slash: POST to "/api/admin/newsletters/<id>/send/".
 */
import { requireAdmin } from "@/lib/auth";
import { campaignPlan, mailBudgetView } from "@/lib/mail-budget";
import {
  isNewsletterId,
  NewsletterError,
  newsletterErrorStatus as statusOf,
  newsletterMailReady,
  newsletterProgress,
  sendNewsletterBatch,
} from "@/lib/newsletters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const NO_STORE = { "cache-control": "no-store" } as const;

function bad(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status, headers: NO_STORE });
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!isNewsletterId(id)) return bad("not_found", 404);
  if (!newsletterMailReady()) return bad("no_api_key", 503);

  try {
    const { progress, newsletter } = await sendNewsletterBatch(id);
    /* Read after the batch, not before: the letters this very call sent have
       already been counted, so the figure the panel prints is the one that
       will decide the NEXT call. */
    const budget = await mailBudgetView();
    return Response.json(
      { ok: true, ...progress, budget, plan: campaignPlan(progress.left, budget), newsletter },
      { headers: NO_STORE },
    );
  } catch (err) {
    if (err instanceof NewsletterError) return bad(err.code, statusOf(err.code));
    console.error("[api/admin/newsletters/send] failed:", err);
    return bad("unavailable", 503);
  }
}

/**
 * The same numbers without sending anything — what «Продолжить» and a reopened
 * panel read, and the one call that answers «сколько ещё дней» for a campaign
 * that is already under way. Sends nothing, takes no lease, changes nothing.
 */
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!isNewsletterId(id)) return bad("not_found", 404);

  try {
    const progress = await newsletterProgress(id);
    if (!progress) return bad("not_found", 404);
    const budget = await mailBudgetView();
    return Response.json(
      { ok: true, ...progress, budget, plan: campaignPlan(progress.left, budget) },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("[api/admin/newsletters/send] status failed:", err);
    return bad("db_unavailable", 503);
  }
}
