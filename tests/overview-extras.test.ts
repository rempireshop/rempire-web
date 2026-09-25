/**
 * src/lib/overview-extras.ts — the two counts GET /api/admin/overview carries
 * for the phone's «Ещё» list (admin redesign 1a; Dim, 25.09.2026, q13):
 * articles under «Блог», problems under «Подключения».
 *
 * What they promise: real rows, not guesses — a deleted article is neither
 * live nor a draft; a problem is counted only where «Подключения» itself
 * would draw a red row the server can decide; «не знаем» is `null`, never 0.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { exec, query } from "@/lib/db";
import { montonioReadinessRows } from "@/lib/montonio-problems";
import { getOverviewExtras } from "@/lib/overview-extras";
import { setSetting } from "@/lib/orders";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

const post = (slug: string, status: "draft" | "published", deleted = false) =>
  query(
    `insert into posts (slug, status, title, deleted_at) values ($1, $2, '{"RU":"x"}'::jsonb, ${deleted ? "now()" : "null"})`,
    [slug, status],
  );

/** An environment with only the variables a test names — nothing leaks in from the shell. */
const envOf = (vars: Record<string, string>) => ({ ...vars }) as unknown as NodeJS.ProcessEnv;
const ALL_MAIL_AND_GSC = {
  RESEND_API_KEY: "re_x", RESEND_TO: "shop@example.com",
  GSC_SITE_URL: "sc-domain:example.com",
  GSC_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "a@b.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n" }),
};
const MONTONIO_KEYS = { MONTONIO_ACCESS_KEY: "ak", MONTONIO_SECRET_KEY: "sk" };

/** ownerMailConfig() and gscConfigured() read process.env itself — set it for one call. */
async function withEnv<T>(vars: Record<string, string>, run: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const KEYS = ["RESEND_API_KEY", "RESEND_TO", "GSC_SITE_URL", "GSC_SERVICE_ACCOUNT_JSON", "MONTONIO_ACCESS_KEY", "MONTONIO_SECRET_KEY"];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  try {
    return await run(envOf(vars));
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

describe("getOverviewExtras", () => {
  beforeAll(async () => { await setupDb(); });
  afterAll(teardownDb);
  beforeEach(async () => { await exec("truncate posts, settings restart identity cascade"); });

  it("counts live articles and drafts; a deleted one is neither", async () => {
    await post("a", "published");
    await post("b", "published");
    await post("c", "draft");
    await post("d", "draft", true);
    const x = await withEnv(ALL_MAIL_AND_GSC, (env) => getOverviewExtras(env));
    expect(x.blog).toEqual({ published: 2, drafts: 1 });
  });

  it("an empty blog is zeros, not «не знаем»", async () => {
    const x = await withEnv(ALL_MAIL_AND_GSC, (env) => getOverviewExtras(env));
    expect(x.blog).toEqual({ published: 0, drafts: 0 });
  });

  it("no Montonio keys: the very red rows «Подключения» draws for that, plus mail and Search Console when missing", async () => {
    const noKeys = montonioReadinessRows({
      configured: false, env: null, keys: null, bankPayments: null, refundableBankPayments: null,
      refundSampleMethod: null, carriers: null, webhook: null, pendingRefunds: 0, overdueRefunds: 0,
    }).filter((r) => !r.ok).length;
    expect(noKeys).toBeGreaterThan(0);
    expect((await withEnv(ALL_MAIL_AND_GSC, (env) => getOverviewExtras(env))).integrations).toEqual({ problems: noKeys });
    expect((await withEnv({}, (env) => getOverviewExtras(env))).integrations).toEqual({ problems: noKeys + 2 });
  });

  it("keys set and «Подключения» visited: the red rows of its last visit", async () => {
    await setSetting("montonio_readiness", { checkedAt: "2026-09-25T08:00:00Z", problems: 2 });
    const x = await withEnv({ ...ALL_MAIL_AND_GSC, ...MONTONIO_KEYS }, (env) => getOverviewExtras(env));
    expect(x.integrations).toEqual({ problems: 2 });
    await setSetting("montonio_readiness", { checkedAt: "2026-09-25T09:00:00Z", problems: 0 });
    expect((await withEnv({ ...ALL_MAIL_AND_GSC, ...MONTONIO_KEYS }, (env) => getOverviewExtras(env))).integrations)
      .toEqual({ problems: 0 });
  });

  it("keys set, never visited: «не знаем» — unless something it CAN see is already wrong", async () => {
    expect((await withEnv({ ...ALL_MAIL_AND_GSC, ...MONTONIO_KEYS }, (env) => getOverviewExtras(env))).integrations).toBeNull();
    // a snapshot from before the count existed says nothing either
    await setSetting("montonio_readiness", { checkedAt: "2026-09-20T08:00:00Z" });
    expect((await withEnv({ ...ALL_MAIL_AND_GSC, ...MONTONIO_KEYS }, (env) => getOverviewExtras(env))).integrations).toBeNull();
    // no RESEND_TO: at least that one is known
    const { RESEND_TO: _to, ...noTo } = ALL_MAIL_AND_GSC;
    expect((await withEnv({ ...noTo, ...MONTONIO_KEYS }, (env) => getOverviewExtras(env))).integrations).toEqual({ problems: 1 });
  });
});

describe("GET /api/admin/overview carries them", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    resetRateLimits();
    await exec("truncate posts, settings restart identity cascade");
  });

  it("beside the summary it always had", async () => {
    await post("a", "published");
    const { GET } = await import("@/app/api/admin/overview/route");
    const res = await GET(new Request("https://rempireshop.com/api/admin/overview/", {
      headers: { cookie: `${ADMIN_COOKIE}=${makeSessionToken()}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.attention).toBeDefined();
    expect(body.blog).toEqual({ published: 1, drafts: 0 });
    expect(body).toHaveProperty("integrations");
  });
});

describe("GET /api/admin/montonio keeps the count in its snapshot", () => {
  it("the dated record carries how many of its rows are red", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/app/api/admin/montonio/route.ts", import.meta.url), "utf8");
    expect(src).toContain("problems: rows.filter((r) => !r.ok).length,");
  });
});
