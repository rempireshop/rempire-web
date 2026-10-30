/**
 * «The site did not update» — Dim hears of a failed Vercel build himself.
 *
 * 29.10.2026, before the handover: the owner's panel edits and the night ask
 * Vercel for a fresh build through the deploy hook (src/lib/rebuild.ts). When
 * such a build fails, the previous one keeps serving — nothing looks broken,
 * but the pages Google reads stop following the owner's edits — and Vercel
 * mails only the account's own address, the shop's Gmail, which forwards
 * nothing (Gmail's forwarding needs the owner's phone to confirm; Dim, 29.10:
 * «directly routed to me»). Builds from a push are watched by
 * .github/workflows/promote.yml; these hook builds never reach GitHub at all.
 *
 * So the daily cron (runFlows, src/lib/flows.ts) compares what was asked with
 * what runs: BUILD_AT is stamped into this build by next.config.ts, the last
 * hook call is the settings row «rebuild». A call older than an hour that the
 * running build predates is a build that never went live. No call for more
 * than a day is a hook that stopped being sent. Either way one plain letter to
 * DEV_ALERT_TO (info@diipsolutions.eu), once a day while it lasts.
 *
 * Only on the live shop with a hook (rebuildEnabled()). Never throws.
 */
import { query } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { rebuildEnabled } from "@/lib/rebuild";

/** A hook build takes 5–10 minutes; past this it is not «still building». */
export const BUILD_GRACE_MS = 60 * 60_000;
/** The night sends every day at 03:30 UTC; past this the hook stopped. */
export const HOOK_SILENT_MS = 26 * 3600_000;

type RebuildState = { lastAt?: string; pending?: boolean; reason?: string };

export type BuildProblem =
  | { kind: "build_failed"; askedAt: string; reason?: string; builtAt: string }
  | { kind: "hook_silent"; lastAt?: string; builtAt: string };

/** What is wrong, if anything — or null when the running build is current. */
export function buildProblem(state: RebuildState, builtAt: string | undefined, now: number): BuildProblem | null {
  const built = builtAt ? Date.parse(builtAt) : NaN;
  if (!Number.isFinite(built)) return null; // a build without the stamp cannot tell
  const asked = state.lastAt ? Date.parse(state.lastAt) : NaN;
  if (Number.isFinite(asked) && built < asked && now - asked > BUILD_GRACE_MS) {
    return { kind: "build_failed", askedAt: state.lastAt as string, reason: state.reason, builtAt: builtAt as string };
  }
  if (!Number.isFinite(asked) || now - asked > HOOK_SILENT_MS) {
    return { kind: "hook_silent", lastAt: state.lastAt, builtAt: builtAt as string };
  }
  return null;
}

const utc = (iso?: string) => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "never");

export function buildLetter(p: BuildProblem): { subject: string; text: string } {
  const head =
    p.kind === "build_failed"
      ? [
          `rempireshop.com asked Vercel for a new build at ${utc(p.askedAt)}${p.reason ? ` (${p.reason})` : ""},`,
          `but the site still runs the build from ${utc(p.builtAt)}. That build most likely failed.`,
          "",
          "Check: Vercel → rempire-web → Deployments → the red one → Build Logs.",
        ]
      : [
          `The deploy hook has not been called since ${utc(p.lastAt)} — not even the nightly rebuild.`,
          `The site runs the build from ${utc(p.builtAt)}.`,
          "",
          "Check: Vercel → rempire-web → Settings → Environment Variables → DEPLOY_HOOK_URL,",
          "and Settings → Git → Deploy Hooks (branch production). The function log of",
          "/api/cron/events-retention/ says what the hook answered.",
        ];
  const text = [
    ...head,
    "",
    "Nothing is down: the previous build keeps serving and the shop's screens read live data.",
    "Only the pages Google reads (prices, stock, the owner's texts) stay as of that build.",
    "",
    "This letter comes with the daily cron (07:00 UTC) while it lasts — src/lib/build-watch.ts.",
  ].join("\n");
  const subject = p.kind === "build_failed" ? "REMPIRE — a Vercel build failed, the site did not update" : "REMPIRE — the nightly rebuild is not being sent";
  return { subject, text };
}

const devAlertTo = () => (process.env.DEV_ALERT_TO ?? "info@diipsolutions.eu").trim();

export async function runBuildWatch(
  now: number = Date.now(),
  opts: { builtAt?: string; env?: Record<string, string | undefined> } = {},
): Promise<{ sent: boolean; problem?: BuildProblem["kind"]; reason?: string }> {
  try {
    if (!rebuildEnabled(opts.env ?? process.env)) return { sent: false, reason: "disabled" };
    const rows = await query<{ value: RebuildState }>("select value from settings where key = 'rebuild'");
    const state = rows[0]?.value || {};
    const problem = buildProblem(state, opts.builtAt ?? process.env.BUILD_AT, now);
    if (!problem) return { sent: false };
    const { subject, text } = buildLetter(problem);
    const res = await sendMail({ to: devAlertTo(), subject, text, tags: { template: "build-watch" } });
    return { sent: !!res.ok, problem: problem.kind, reason: res.ok ? undefined : res.error };
  } catch (err) {
    console.error("[build-watch] could not check:", err);
    return { sent: false, reason: "error" };
  }
}

/**
 * «Скрыто N товаров в наличии» — the morning after a mass hide.
 *
 * 28.10.2026: the panel's «Показывать в магазине» switches fired at machine
 * speed (a held key or a touch glitch) and 75 products in stock left the shop
 * and Google; it took a day and a Merchant Center graph to notice. The panel
 * and the server now refuse such a burst (src/app/api/admin/overrides), and
 * this is the net under them: when HIDE_ALERT_MIN or more products that are
 * still hidden and still on the shelf were hidden in the last 24 hours, one
 * letter in Russian to the shop's mailbox and to Dim, with the names and the
 * way back (Журнал → «Вернуть»). A deliberate clear-out reads the letter and
 * ignores it.
 */
export const HIDE_ALERT_MIN = 8;

export async function runHideWatch(): Promise<{ sent: boolean; hidden: number; reason?: string }> {
  try {
    const rows = await query<{ id: string }>(
      `select distinct a.payload->>'id' as id
         from admin_audit a
         join product_overrides o on o.product_id = a.payload->>'id'
        where a.action = 'override.set' and a.at > now() - interval '24 hours'
          and a.payload->'patch'->>'hidden' = 'true' and o.hidden
          and exists (select 1 from stock_levels s where s.product_id = o.product_id and s.qty > 0)
        order by 1`,
    );
    if (rows.length < HIDE_ALERT_MIN) return { sent: false, hidden: rows.length };
    const names = rows.map((r) => "— " + r.id);
    const text = [
      `За последние сутки из магазина скрыто ${rows.length} товаров, которые есть на складе:`,
      "",
      ...names.slice(0, 120),
      ...(names.length > 120 ? [`…и ещё ${names.length - 120}`] : []),
      "",
      "Если вы скрыли их сами — ничего делать не нужно.",
      "Если нет: панель → Журнал → «Вернуть» у этих строк, или напишите Диме.",
      "Скрытые товары не видны покупателям и пропадают из Google Покупок.",
    ].join("\n");
    const to = [(process.env.RESEND_TO ?? "").trim(), devAlertTo()].filter(Boolean);
    const res = await sendMail({ to, subject: `REMPIRE — скрыто ${rows.length} товаров в наличии`, text, tags: { template: "hide-watch" } });
    return { sent: !!res.ok, hidden: rows.length, reason: res.ok ? undefined : res.error };
  } catch (err) {
    console.error("[hide-watch] could not check:", err);
    return { sent: false, hidden: 0, reason: "error" };
  }
}

/**
 * «No database backup since …» — the backup that silently does not exist.
 *
 * .github/workflows/backup.yml copies the database twice a day and stamps
 * settings.backup_last after a run whose restore test passed. GitHub drops
 * scheduled runs when it is busy (30.10.2026: the night's run never started,
 * and a run that never starts mails nobody), so the daily cron checks the
 * stamp: none, or older than BACKUP_STALE_MS, is one letter to Dim. Only on
 * the live shop (rebuildEnabled()).
 */
export const BACKUP_STALE_MS = 36 * 3600_000;

export async function runBackupWatch(
  now: number = Date.now(),
  env: Record<string, string | undefined> = process.env,
): Promise<{ sent: boolean; lastAt?: string; reason?: string }> {
  try {
    if (!rebuildEnabled(env)) return { sent: false, reason: "disabled" };
    const rows = await query<{ value: unknown }>("select value from settings where key = 'backup_last'");
    const lastAt = typeof rows[0]?.value === "string" ? (rows[0].value as string) : undefined;
    const last = lastAt ? Date.parse(lastAt) : NaN;
    if (Number.isFinite(last) && now - last <= BACKUP_STALE_MS) return { sent: false, lastAt };
    const text = [
      `The last database backup that passed its restore test: ${utc(lastAt)}.`,
      "",
      "Run one now: GitHub → rempireshop/rempire-web → Actions → «Database backup» → Run workflow.",
      "If it fails, its log says why (the BACKUP_DATABASE_URL secret, Railway, or GitHub itself).",
      "",
      "This letter comes with the daily cron (07:00 UTC) until a backup succeeds — src/lib/build-watch.ts.",
    ].join("\n");
    const res = await sendMail({ to: devAlertTo(), subject: "REMPIRE — no database backup in 36 hours", text, tags: { template: "backup-watch" } });
    return { sent: !!res.ok, lastAt, reason: res.ok ? undefined : res.error };
  } catch (err) {
    console.error("[backup-watch] could not check:", err);
    return { sent: false, reason: "error" };
  }
}

/**
 * The drill (POST /api/admin/alert-drill/): one letter down the same road a
 * real alert takes — same sender, same DEV_ALERT_TO — saying what the watch
 * sees on the live build right now. Dim, 29.10.2026: «make sure we set up
 * something we can control and everything is correct».
 */
export async function runAlertDrill(now: number = Date.now()): Promise<{
  sent: boolean;
  to: string;
  enabled: boolean;
  builtAt?: string;
  lastAt?: string;
  problem: BuildProblem["kind"] | "none";
  reason?: string;
}> {
  const rows = await query<{ value: RebuildState }>("select value from settings where key = 'rebuild'");
  const state = rows[0]?.value || {};
  const builtAt = process.env.BUILD_AT;
  const enabled = rebuildEnabled();
  const problem = buildProblem(state, builtAt, now)?.kind ?? "none";
  const to = devAlertTo();
  const text = [
    "A test, sent on request from the shop's admin. Real alerts come to this address the same way.",
    "",
    `Watch on: ${enabled ? "yes" : "no (not the live shop, or no deploy hook)"}`,
    `This build: ${utc(builtAt)}`,
    `Last deploy-hook call: ${utc(state.lastAt)}${state.reason ? ` (${state.reason})` : ""}`,
    `What the watch sees now: ${problem === "none" ? "nothing wrong" : problem}`,
  ].join("\n");
  const res = await sendMail({ to, subject: "REMPIRE — alert test", text, tags: { template: "alert-drill" } });
  return { sent: !!res.ok, to, enabled, builtAt, lastAt: state.lastAt, problem, reason: res.ok ? undefined : res.error };
}
