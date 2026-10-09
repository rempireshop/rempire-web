/**
 * requestRebuild() — «build the shop again from today's data».
 *
 * Every page a crawler reads first is written at build time
 * (tools/prerender-shop2.mjs): the product's offer with its price and stock,
 * a brand's or a section's list, an article. The shop's own screens read the
 * live data after they load, but the static copy only changes with the next
 * deploy. While the shop was being built that was several times a day; once
 * the code goes quiet it would freeze — an unpublished article staying
 * online, a sold-out product still «in stock» in the data Merchant Center
 * compares its feed with (Codex audit 09.10.2026, T4).
 *
 * So the shop asks Vercel for a fresh build itself, through a Deploy Hook
 * (Vercel → Settings → Git → Deploy Hooks; its secret URL lives in the
 * DEPLOY_HOOK_URL environment variable, never in this repository):
 *
 *   - every night, from the daily cron (src/app/api/cron/events-retention),
 *     `force` — whatever changed during the day;
 *   - when the owner publishes, unpublishes, deletes or edits a published
 *     article (src/app/api/admin/blog) — so a withdrawn article leaves the
 *     static pages within minutes, not at the next code change.
 *
 * A build takes a few minutes and every one is a full copy on the Hobby
 * plan's storage, while the panel autosaves an article many times a minute.
 * So one build per MIN_GAP_MS at most, counted across server instances in
 * the `settings` row «rebuild»; a request inside the gap is remembered as
 * `pending` and the next request after it — or the night — sends it.
 *
 * Only the live shop asks (indexNowEnabled(): production build, production
 * deployment, rempireshop.com) and only when DEPLOY_HOOK_URL is a Vercel
 * hook; everywhere else this does nothing. Never throws, never makes the
 * caller wait: the request rides `after()` as src/lib/indexnow-ping.ts does.
 */
import { after } from "next/server";
import { query } from "@/lib/db";
import { indexNowEnabled } from "@/lib/indexnow.mjs";

export const MIN_GAP_MS = 5 * 60_000;
const ROW = "rebuild";

type RebuildState = { lastAt?: string; pending?: boolean; reason?: string };

const pending = new Set<Promise<void>>();

/** The hook to call, or null — only a Vercel deploy hook over https. */
export function deployHookUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = (env.DEPLOY_HOOK_URL ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.hostname !== "api.vercel.com" || !u.pathname.startsWith("/v1/integrations/deploy/")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Is this the live shop with a hook configured? */
export function rebuildEnabled(env: Record<string, string | undefined> = process.env): boolean {
  /* NODE_ENV spelled out, as in indexnow-ping.ts: Next inlines it at build time. */
  return indexNowEnabled({ ...env, NODE_ENV: env.NODE_ENV ?? process.env.NODE_ENV }) && deployHookUrl(env) !== null;
}

async function readState(): Promise<RebuildState> {
  const rows = await query<{ value: RebuildState }>("select value from settings where key = $1", [ROW]);
  return (rows[0]?.value as RebuildState) || {};
}

async function writeState(state: RebuildState): Promise<void> {
  await query(
    `insert into settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [ROW, JSON.stringify(state)],
  );
}

/**
 * The decision and the call, awaited — what requestRebuild() runs in the
 * background, and what the nightly cron awaits so its log says what happened.
 * Returns "sent", "pending" (inside the gap, remembered), "disabled" or "failed".
 */
export async function runRebuild(
  reason: string,
  opts: { force?: boolean; now?: number; env?: Record<string, string | undefined> } = {},
): Promise<"sent" | "pending" | "disabled" | "failed"> {
  const env = opts.env ?? process.env;
  if (!rebuildEnabled(env)) return "disabled";
  const hook = deployHookUrl(env) as string;
  const now = opts.now ?? Date.now();
  try {
    const state = await readState();
    const last = state.lastAt ? Date.parse(state.lastAt) : NaN;
    const recent = Number.isFinite(last) && now - last < MIN_GAP_MS;
    /* The night sends even inside the gap only if something waits or it is
       forced; a forced call right after another build would just repeat it. */
    if (recent && !(opts.force && now - last >= 60_000)) {
      if (!state.pending) await writeState({ ...state, pending: true });
      return "pending";
    }
    const res = await fetch(hook, { method: "POST", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`[rebuild] deploy hook answered ${res.status} (${reason})`);
      await writeState({ ...state, pending: true });
      return "failed";
    }
    await writeState({ lastAt: new Date(now).toISOString(), pending: false, reason });
    return "sent";
  } catch (err) {
    console.warn("[rebuild] not sent:", err instanceof Error ? err.message : err);
    return "failed";
  }
}

/** Ask for a rebuild in the background. Never throws, never waits. */
export function requestRebuild(reason: string, opts: { force?: boolean } = {}): void {
  try {
    if (!rebuildEnabled()) return;
    const run = (): Promise<void> => {
      const p = runRebuild(reason, opts).then(() => undefined);
      pending.add(p);
      void p.finally(() => pending.delete(p));
      return p;
    };
    try {
      after(run);
    } catch {
      void run();
    }
  } catch (err) {
    console.warn("[rebuild] skipped:", err instanceof Error ? err.message : err);
  }
}

/** Resolves once every background request started so far has finished — for tests. */
export async function rebuildSettled(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.all([...pending]);
}
