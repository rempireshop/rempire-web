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
