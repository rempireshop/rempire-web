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
 *
 * …and since 27.09.2026 a third thing, for «Сделать сегодня» rather than
 * «Ещё»: whether the nightly job still runs (cronHealth below). One settings
 * row, and on a shop whose cron never ran, one count over `orders`.
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
  /** The nightly job — see cronHealth(). `null` = could not read it. */
  cron: CronHealth | null;
};

/**
 * The one scheduled job the shop has (GET /api/cron/flows, 07:00 UTC): the
 * automatic letters, the payment sweep that finds lost webhooks, the parcel
 * re-check, the nightly «Доставлен». If it stops — CRON_SECRET missing
 * (the route answers 503 to Vercel and nobody sees it), the cron switched
 * off, a deploy that dropped vercel.json — every one of those stops with it,
 * silently (readiness pass 27.09.2026, B11 / G20).
 *
 * `lastRunAt` is the newest `at` the CRON wrote into `settings.flow_runs`
 * (src/lib/flows.ts recordFlowRun — one line per letter, every run, whatever
 * the switches say; «Запустить сейчас» in the panel writes `by: "admin"` and
 * does not count). `stale` turns «Обзор» red: more than CRON_STALE_HOURS
 * since that — a day and two hours, so one late run is not an alarm.
 *
 * Never run at all is `lastRunAt: null`, and red only on the production
 * deployment (VERCEL_ENV), where the job is supposed to run: at once when
 * CRON_SECRET is not set, otherwise once the shop's first order is older than
 * CRON_STALE_HOURS (the go-live reset empties `flow_runs`, so a fresh shop is
 * not red before its first morning). A laptop, a preview and the tests have no
 * cron and are never red for that.
 */
export type CronHealth = { lastRunAt: string | null; stale: boolean };
export const CRON_STALE_HOURS = 26;

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

/** The newest instant the cron itself recorded in `settings.flow_runs`, or NaN. */
function lastCronRun(raw: unknown): number {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  const map = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  let last = NaN;
  for (const v of Object.values(map)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const r = v as { at?: unknown; by?: unknown };
    if (r.by === "admin") continue;
    const t = typeof r.at === "string" ? Date.parse(r.at) : NaN;
    if (Number.isFinite(t) && !(t <= last)) last = t;
  }
  return last;
}

export async function cronHealth(env: NodeJS.ProcessEnv = process.env, now: number = Date.now()): Promise<CronHealth | null> {
  const limit = CRON_STALE_HOURS * 60 * 60 * 1000;
  try {
    const rows = await query<{ value: unknown }>("select value from settings where key = 'flow_runs'");
    const last = lastCronRun(rows[0]?.value);
    if (Number.isFinite(last)) return { lastRunAt: new Date(last).toISOString(), stale: now - last > limit };
    if ((env.VERCEL_ENV ?? "").trim() !== "production") return { lastRunAt: null, stale: false };
    if (!(env.CRON_SECRET ?? "").trim()) return { lastRunAt: null, stale: true };
    const [first] = await query<{ at: string | Date | null }>("select min(created_at) as at from orders");
    const since = first?.at ? new Date(first.at as string).getTime() : NaN;
    return { lastRunAt: null, stale: Number.isFinite(since) && now - since > limit };
  } catch (err) {
    console.error("[overview-extras] cron health unreadable:", err);
    return null;
  }
}

export async function getOverviewExtras(env: NodeJS.ProcessEnv = process.env): Promise<OverviewExtras> {
  const [blog, integrations, cron] = await Promise.all([blogCounts(), integrationProblems(env), cronHealth(env)]);
  return { blog, integrations, cron };
}
