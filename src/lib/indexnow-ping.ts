/**
 * submitIndexNow() — the admin routes' «this page just changed» to Bing,
 * Yandex, Seznam and the rest (src/lib/indexnow.mjs says what IndexNow is).
 *
 * Called when the owner publishes, edits or hides a product, an article or a
 * set. Fire-and-forget, and never anything more: the row is already saved
 * when this runs, and a search engine being unreachable is no reason to tell
 * the owner his save failed — so nothing here throws, nothing is awaited by
 * the caller, and a refusal is one warning line in the function's log.
 *
 * Inside a request the POST rides `after()` (next/server — the pattern of
 * src/lib/letter-hold.ts and src/lib/owner-alerts.ts): the answer goes to
 * the panel first and the function stays alive until the POST is done.
 * Outside one — a test calling a route directly, a script — `after()` throws
 * and the POST runs as a detached promise instead; indexNowSettled() is what
 * a test awaits.
 *
 * Only the production shop announces anything (indexNowEnabled()): staging,
 * previews and localhost answer exactly as before and send nothing.
 *
 * The panel autosaves (admin redesign 1a), so one product can be saved many
 * times a minute while the owner types. An engine asked about the same URL
 * over and over throttles the site (429), and its crawler comes once anyway —
 * after the burst, reading the last version. So an address told about in the
 * last REPEAT_MS is not told again by this instance.
 */
import { after } from "next/server";
import { indexNowEnabled, postIndexNow } from "@/lib/indexnow.mjs";

const REPEAT_MS = 10 * 60_000;
const lastSent = new Map<string, number>();
const pending = new Set<Promise<void>>();

/** Tell the engines about these addresses, if this is the live shop. Never throws, never waits. */
export function submitIndexNow(urls: readonly string[]): void {
  try {
    /* NODE_ENV spelled out: Next compiles `process.env.NODE_ENV` into the
       bundle ("production" in a build), whatever the runtime's env holds. */
    if (!urls.length || !indexNowEnabled({ ...process.env, NODE_ENV: process.env.NODE_ENV })) return;
    const now = Date.now();
    const fresh = [...new Set(urls)].filter((u) => !(now - (lastSent.get(u) ?? -Infinity) < REPEAT_MS));
    if (!fresh.length) return;
    for (const u of fresh) lastSent.set(u, now);
    if (lastSent.size > 5000) {
      for (const [u, at] of lastSent) if (now - at >= REPEAT_MS) lastSent.delete(u);
    }
    const task = async (): Promise<void> => {
      try {
        const results = await postIndexNow(fresh);
        for (const r of results) {
          if (r.status >= 300) console.warn(`[indexnow] ${r.status} for ${r.count} address(es)`);
        }
      } catch (err) {
        /* Not told this time: forget the stamp, so the next save tries again. */
        for (const u of fresh) lastSent.delete(u);
        console.warn("[indexnow] not sent:", err instanceof Error ? err.message : err);
      }
    };
    const run = (): Promise<void> => {
      const p = task();
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
    console.warn("[indexnow] skipped:", err instanceof Error ? err.message : err);
  }
}

/** Resolves once every POST started so far has finished — for tests. */
export async function indexNowSettled(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.all([...pending]);
}

/** Forget which addresses were told about — for tests. */
export function resetIndexNowMemory(): void {
  lastSent.clear();
}
