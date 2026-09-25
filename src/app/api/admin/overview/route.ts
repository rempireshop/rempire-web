/**
 * GET /api/admin/overview — the owner's «Обзор» tab, first screen of the
 * panel. requireAdmin; read-only.
 *
 * Everything on that screen used to be a mixture: real products, invented
 * orders, a random «вчера — 5». Now every number comes from this one call —
 * see getOverviewSummary() in src/lib/analytics.ts for which date and which
 * statuses each one counts, and docs/analytics.md for the owner-facing
 * version of the same explanation.
 */
import { requireAdmin } from "@/lib/auth";
import { getOverviewSummary } from "@/lib/analytics";
import { getOverviewExtras } from "@/lib/overview-extras";
import { getAttentionNames } from "@/lib/overview-names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  try {
    /* …and the two counts the phone's «Ещё» prints under «Блог» and
       «Подключения» (1a; getOverviewExtras never throws — each half is null
       when it cannot say). */
    /* …and the first few names under «отзыв ждёт проверки» and «заявка на
       партнёрство» (1a, q41; src/lib/overview-names.ts, never throws). */
    const [data, extras, attentionNames] = await Promise.all([
      getOverviewSummary(),
      getOverviewExtras(),
      getAttentionNames(),
    ]);
    return Response.json({ ok: true, ...data, ...extras, attentionNames }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/overview] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
