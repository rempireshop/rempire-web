/**
 * POST /api/admin/newsletters/<id>/send/
 *
 * One call's worth of sending (src/lib/newsletters.ts sendNewsletterBatch):
 * the first call freezes the audience into `newsletter_sends` and starts,
 * every call sends what fits in the function's budget and answers
 *
 *   { ok: true, done, sent, failed, left, total, status, retryAfterMs?, newsletter }
 *
 * — `done:false` means «call again»: the panel loops until `done`, and a
 * call that never came back (a closed tab, a dead function) is picked up by
 * the next one, «Продолжить». Idempotent throughout: an address gets the
 * letter once however many calls it takes, and a letter already sent is
 * refused with 409.
 *
 * Refusals, all 4xx JSON for the panel to word: `not_found`, `already_sent`,
 * `busy` (another call holds the lease), `empty_body`, `no_subject`,
 * `no_recipients`; `no_api_key` (503) when nothing can leave this deployment
 * — checked before a single row is queued.
 *
 * NB trailing slash: POST to "/api/admin/newsletters/<id>/send/".
 */
import { requireAdmin } from "@/lib/auth";
import {
  isNewsletterId,
  NewsletterError,
  newsletterErrorStatus as statusOf,
  newsletterMailReady,
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
    return Response.json({ ok: true, ...progress, newsletter }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof NewsletterError) return bad(err.code, statusOf(err.code));
    console.error("[api/admin/newsletters/send] failed:", err);
    return bad("unavailable", 503);
  }
}

export function GET(): Response {
  return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
