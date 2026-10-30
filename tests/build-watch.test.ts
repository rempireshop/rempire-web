/**
 * «The site did not update» (src/lib/build-watch.ts): a deploy-hook build that
 * never went live, or a hook nobody calls any more, mails Dim — and a build
 * that is current, or still building, says nothing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { BUILD_GRACE_MS, buildLetter, buildProblem, HOOK_SILENT_MS, runBuildWatch } from "@/lib/build-watch";
import { setupDb, teardownDb } from "./helpers";

const sent: Array<{ to: string | string[]; subject: string; text?: string }> = [];
vi.mock("@/lib/mail", () => ({
  sendMail: async (m: { to: string | string[]; subject: string; text?: string }) => {
    sent.push(m);
    return { ok: true };
  },
}));

const LIVE_ENV = {
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  PUBLIC_BASE_URL: "https://rempireshop.com",
  DEPLOY_HOOK_URL: "https://api.vercel.com/v1/integrations/deploy/prj_test123/hook456",
};
const NOW = Date.UTC(2026, 9, 30, 7, 0);
const iso = (ms: number) => new Date(ms).toISOString();

describe("buildProblem()", () => {
  const night = NOW - 3.5 * 3600_000; // 03:30, the nightly hook call

  it("is quiet when the running build came after the last call", () => {
    expect(buildProblem({ lastAt: iso(night) }, iso(night + 6 * 60_000), NOW)).toBeNull();
  });

  it("is quiet while a build may still be running", () => {
    const asked = NOW - BUILD_GRACE_MS + 60_000;
    expect(buildProblem({ lastAt: iso(asked) }, iso(night), NOW)).toBeNull();
  });

  it("names a hook build that never went live", () => {
    expect(buildProblem({ lastAt: iso(night), reason: "product-rename" }, iso(night - 3600_000), NOW)).toEqual({
      kind: "build_failed",
      askedAt: iso(night),
      reason: "product-rename",
      builtAt: iso(night - 3600_000),
    });
  });

  it("names a hook that stopped being called", () => {
    const old = NOW - HOOK_SILENT_MS - 60_000;
    expect(buildProblem({ lastAt: iso(old) }, iso(old + 60_000), NOW)).toMatchObject({ kind: "hook_silent" });
    expect(buildProblem({}, iso(night), NOW)).toMatchObject({ kind: "hook_silent" });
  });

  it("cannot tell without the build's own stamp", () => {
    expect(buildProblem({ lastAt: iso(night) }, undefined, NOW)).toBeNull();
  });
});

describe("buildLetter()", () => {
  it("says when, what and where to look", () => {
    const { subject, text } = buildLetter({
      kind: "build_failed",
      askedAt: "2026-10-30T03:30:00.000Z",
      reason: "nightly",
      builtAt: "2026-10-29T06:50:00.000Z",
    });
    expect(subject).toBe("REMPIRE — a Vercel build failed, the site did not update");
    expect(text).toContain("at 2026-10-30 03:30 UTC (nightly)");
    expect(text).toContain("the build from 2026-10-29 06:50 UTC");
    expect(text).toContain("Vercel → rempire-web → Deployments");
  });
});

describe("runBuildWatch()", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    sent.length = 0;
    delete process.env.DEV_ALERT_TO;
    await query("delete from settings where key = 'rebuild'");
  });

  const setState = (v: object) =>
    query(
      `insert into settings (key, value, updated_at) values ('rebuild', $1::jsonb, now())
       on conflict (key) do update set value = excluded.value`,
      [JSON.stringify(v)],
    );

  it("mails Dim when the night's build never went live", async () => {
    await setState({ lastAt: iso(NOW - 3.5 * 3600_000), reason: "nightly", pending: false });
    const out = await runBuildWatch(NOW, { env: LIVE_ENV, builtAt: iso(NOW - 26 * 3600_000 + 3600_000) });
    expect(out).toEqual({ sent: true, problem: "build_failed" });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("info@diipsolutions.eu");
  });

  it("says nothing when the build is current, and does nothing off the live shop", async () => {
    await setState({ lastAt: iso(NOW - 3.5 * 3600_000), reason: "nightly" });
    expect(await runBuildWatch(NOW, { env: LIVE_ENV, builtAt: iso(NOW - 3.4 * 3600_000) })).toEqual({ sent: false });
    expect(await runBuildWatch(NOW, { env: { ...LIVE_ENV, VERCEL_ENV: "preview" }, builtAt: "2020-01-01T00:00:00Z" })).toEqual({
      sent: false,
      reason: "disabled",
    });
    expect(sent).toEqual([]);
  });
});

describe("runAlertDrill()", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);

  it("sends one test letter to Dim with what the watch sees", async () => {
    sent.length = 0;
    delete process.env.DEV_ALERT_TO;
    await query("delete from settings where key = 'rebuild'");
    const { runAlertDrill } = await import("@/lib/build-watch");
    const out = await runAlertDrill(NOW);
    expect(out).toMatchObject({ sent: true, to: "info@diipsolutions.eu", enabled: false });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("REMPIRE — alert test");
    expect(sent[0].text).toContain("Last deploy-hook call: never");
  });
});

describe("runBackupWatch()", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);

  const stamp = (iso: string | null) =>
    iso === null
      ? query("delete from settings where key = 'backup_last'")
      : query(
          `insert into settings (key, value, updated_at) values ('backup_last', to_jsonb($1::text), now())
           on conflict (key) do update set value = excluded.value`,
          [iso],
        );

  it("says nothing while the last backup is fresh, and nothing off the live shop", async () => {
    sent.length = 0;
    const { runBackupWatch } = await import("@/lib/build-watch");
    await stamp(iso(NOW - 20 * 3600_000));
    expect(await runBackupWatch(NOW, LIVE_ENV)).toMatchObject({ sent: false });
    await stamp(null);
    expect(await runBackupWatch(NOW, { ...LIVE_ENV, VERCEL_ENV: "preview" })).toEqual({ sent: false, reason: "disabled" });
    expect(sent).toEqual([]);
  });

  it("mails Dim when the last backup is older than 36 hours, or there is none", async () => {
    sent.length = 0;
    delete process.env.DEV_ALERT_TO;
    const { runBackupWatch } = await import("@/lib/build-watch");
    await stamp(iso(NOW - 40 * 3600_000));
    expect(await runBackupWatch(NOW, LIVE_ENV)).toMatchObject({ sent: true });
    await stamp(null);
    expect(await runBackupWatch(NOW, LIVE_ENV)).toMatchObject({ sent: true });
    expect(sent).toHaveLength(2);
    expect(sent[0].to).toBe("info@diipsolutions.eu");
    expect(sent[0].subject).toBe("REMPIRE — no database backup in 36 hours");
    expect(sent[1].text).toContain("backup that passed its restore test: never");
  });
});
