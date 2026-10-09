/**
 * The shop asking Vercel for a fresh build (src/lib/rebuild.ts): only the live
 * shop with a real deploy hook, at most one build per MIN_GAP_MS, a request
 * inside the gap remembered, the night always sending. Every POST goes to a
 * mocked fetch; nothing leaves the machine.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { deployHookUrl, MIN_GAP_MS, rebuildEnabled, runRebuild } from "@/lib/rebuild";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const HOOK = "https://api.vercel.com/v1/integrations/deploy/prj_test123/hook456";
const LIVE_ENV = {
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  PUBLIC_BASE_URL: "https://rempireshop.com",
  DEPLOY_HOOK_URL: HOOK,
};

function mockHook(status = 201): string[] {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(url)}`);
    return new Response("{}", { status });
  });
  return calls;
}

async function state(): Promise<Record<string, unknown>> {
  const rows = await query<{ value: Record<string, unknown> }>("select value from settings where key = 'rebuild'");
  return rows[0]?.value ?? {};
}

beforeAll(async () => {
  await setupDb();
});
afterAll(async () => {
  await teardownDb();
});
beforeEach(async () => {
  await truncateAll();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("when the shop may ask", () => {
  it("only the live shop with a Vercel deploy hook", () => {
    expect(rebuildEnabled(LIVE_ENV)).toBe(true);
    expect(rebuildEnabled({ ...LIVE_ENV, DEPLOY_HOOK_URL: "" })).toBe(false);
    expect(rebuildEnabled({ ...LIVE_ENV, VERCEL_ENV: "preview" })).toBe(false);
    expect(rebuildEnabled({ ...LIVE_ENV, PUBLIC_BASE_URL: "https://rempireshop.diipsolutions.eu" })).toBe(false);
    expect(rebuildEnabled({ ...LIVE_ENV, NODE_ENV: "development" })).toBe(false);
  });

  it("refuses anything that is not a Vercel deploy hook over https", () => {
    expect(deployHookUrl({ DEPLOY_HOOK_URL: HOOK })).toBe(HOOK);
    expect(deployHookUrl({ DEPLOY_HOOK_URL: " " + HOOK + " " })).toBe(HOOK);
    expect(deployHookUrl({ DEPLOY_HOOK_URL: "http://api.vercel.com/v1/integrations/deploy/x/y" })).toBeNull();
    expect(deployHookUrl({ DEPLOY_HOOK_URL: "https://evil.example/v1/integrations/deploy/x/y" })).toBeNull();
    expect(deployHookUrl({ DEPLOY_HOOK_URL: "https://api.vercel.com/v9/projects" })).toBeNull();
    expect(deployHookUrl({ DEPLOY_HOOK_URL: "not a url" })).toBeNull();
    expect(deployHookUrl({})).toBeNull();
  });

  it("does nothing off the live shop, and calls nothing", async () => {
    const calls = mockHook();
    expect(await runRebuild("blog-edit", { env: { ...LIVE_ENV, VERCEL_ENV: "preview" } })).toBe("disabled");
    expect(calls).toEqual([]);
  });
});

describe("one build per gap", () => {
  it("sends the first request and records it", async () => {
    const calls = mockHook();
    const now = Date.parse("2026-10-09T10:00:00Z");
    expect(await runRebuild("blog-publish", { env: LIVE_ENV, now })).toBe("sent");
    expect(calls).toEqual([`POST ${HOOK}`]);
    expect(await state()).toMatchObject({ lastAt: "2026-10-09T10:00:00.000Z", pending: false, reason: "blog-publish" });
  });

  it("remembers a request inside the gap and sends the next one after it", async () => {
    const calls = mockHook();
    const t0 = Date.parse("2026-10-09T10:00:00Z");
    await runRebuild("blog-edit", { env: LIVE_ENV, now: t0 });
    expect(await runRebuild("blog-edit", { env: LIVE_ENV, now: t0 + 60_000 })).toBe("pending");
    expect(await runRebuild("blog-edit", { env: LIVE_ENV, now: t0 + 2 * 60_000 })).toBe("pending");
    expect(calls).toHaveLength(1);
    expect(await state()).toMatchObject({ pending: true });
    expect(await runRebuild("blog-edit", { env: LIVE_ENV, now: t0 + MIN_GAP_MS })).toBe("sent");
    expect(calls).toHaveLength(2);
    expect(await state()).toMatchObject({ pending: false });
  });

  it("the night sends even inside the gap, but not twice within a minute", async () => {
    const calls = mockHook();
    const t0 = Date.parse("2026-10-09T03:29:30Z");
    await runRebuild("blog-edit", { env: LIVE_ENV, now: t0 });
    expect(await runRebuild("nightly", { env: LIVE_ENV, now: t0 + 30_000, force: true })).toBe("pending");
    expect(await runRebuild("nightly", { env: LIVE_ENV, now: t0 + 90_000, force: true })).toBe("sent");
    expect(calls).toHaveLength(2);
  });

  it("a refused hook leaves the request pending for the next try", async () => {
    mockHook(500);
    expect(await runRebuild("blog-publish", { env: LIVE_ENV, now: Date.parse("2026-10-09T10:00:00Z") })).toBe("failed");
    expect(await state()).toMatchObject({ pending: true });
    expect((await state()).lastAt).toBeUndefined();
  });
});
