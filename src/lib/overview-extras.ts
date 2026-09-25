/**
 * Two small numbers «Обзор» carries for the phone's «Ещё» list (admin redesign
 * 1a, screen 14; Dim, 25.09.2026, q13): how many articles the blog has, and how
 * many connections want the owner's attention. They ride on
 * GET /api/admin/overview because that is the one answer the panel already
 * asks for at start-up — loading «Блог» or «Подключения» in the background to
 * count them is what 7301d1d had to revert (it wiped form drafts).
 *
 * Cheap on purpose: one count query over `posts`, one `settings` row, and three
 * environment checks. No request leaves the server. Each half fails soft to
 * `null` — «не знаем» — and the panel then prints the section's fixed line
 * instead of a number, so a problem here can never take «Обзор» down with it.
 *
 * «Требуют внимания» counts the problems the SERVER can know about, the red
 * rows of «Подключения» it can decide without the browser:
 *   · Montonio — the red rows of montonioReadinessRows(): built from «no keys»
 *     right here when the keys are missing, and otherwise read off the dated
 *     snapshot GET /api/admin/montonio writes on every visit to «Подключения»
 *     (`settings.montonio_readiness.problems`). Before the first visit there is
 *     no snapshot and this half says nothing;
 *   · «Письмо магазину о заказе» — no RESEND_API_KEY or no RESEND_TO;
 *   · Google Search Console — no usable key or site url.
 * The rows only a browser can decide (the bank list, the carriers' live
 * tariffs, a test letter that bounced, the phone's camera) stay on
 * «Подключения» itself.
 */
import { query } from "@/lib/db";
import { gscConfigured } from "@/lib/gsc";
import { montonioReadinessRows } from "@/lib/montonio-problems";
import { ownerMailConfig } from "@/lib/notify";
import { montonioConfigFromEnv } from "@/lib/payments/montonio";

export type OverviewExtras = {
  /** Live articles and drafts; deleted ones are neither. `null` = could not count. */
  blog: { published: number; drafts: number } | null;
  /** Red rows of «Подключения» the server can see; `null` = not known yet. */
  integrations: { problems: number } | null;
};

const int = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
};

async function blogCounts(): Promise<OverviewExtras["blog"]> {
  try {
    const rows = await query<{ published: string | number; drafts: string | number }>(
      `select count(*) filter (where status = 'published') as published,
              count(*) filter (where status = 'draft') as drafts
         from posts where deleted_at is null`,
    );
    return { published: int(rows[0]?.published), drafts: int(rows[0]?.drafts) };
  } catch (err) {
    console.error("[overview-extras] blog count failed:", err);
    return null;
  }
}

/** The Montonio rows that are red, or `null` while there is nothing to go on. */
async function montonioProblems(env: NodeJS.ProcessEnv): Promise<number | null> {
  if (!montonioConfigFromEnv(env)) {
    // no keys: the very rows «Подключения» prints for that, counted here
    return montonioReadinessRows({
      configured: false,
      env: null,
      keys: null,
      bankPayments: null,
      refundableBankPayments: null,
      refundSampleMethod: null,
      carriers: null,
      webhook: null,
      pendingRefunds: 0,
      overdueRefunds: 0,
    }).filter((r) => !r.ok).length;
  }
  const rows = await query<{ value: { problems?: unknown } | null }>(
    "select value from settings where key = 'montonio_readiness'",
  );
  const p = rows[0]?.value?.problems;
  return typeof p === "number" && Number.isFinite(p) ? Math.max(0, Math.trunc(p)) : null;
}

async function integrationProblems(env: NodeJS.ProcessEnv): Promise<OverviewExtras["integrations"]> {
  try {
    const mail = ownerMailConfig();
    let problems = (mail.key && mail.to ? 0 : 1) + (gscConfigured() ? 0 : 1);
    const montonio = await montonioProblems(env);
    if (montonio === null) return problems ? { problems } : null;
    problems += montonio;
    return { problems };
  } catch (err) {
    console.error("[overview-extras] integrations count failed:", err);
    return null;
  }
}

export async function getOverviewExtras(env: NodeJS.ProcessEnv = process.env): Promise<OverviewExtras> {
  const [blog, integrations] = await Promise.all([blogCounts(), integrationProblems(env)]);
  return { blog, integrations };
}
