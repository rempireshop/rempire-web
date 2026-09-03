/**
 * The one deliberate leak in the account-login route: with both
 * E2E_EXPOSE_LOGIN_CODE=1 and a non-production NODE_ENV, POST /api/account/code
 * echoes the raw login code so the Playwright suite can sign in without a
 * mailbox (docs/testing.md). This file is the guarantee that every other
 * combination — either gate missing, and in particular NODE_ENV=production
 * even with the flag left on by mistake — never leaks it.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/auth";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const ORIGIN = "https://rempireshop.com";
let n = 0;

function post(body: unknown, ip = `203.0.113.${(n++ % 200) + 1}`) {
  return new Request(`${ORIGIN}/api/account/code/`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

/** Distinct address per case — the route also rate-limits per address. */
let mail = 0;
const email = () => `shopper-${mail++}@example.com`;

describe("POST /api/account/code — E2E_EXPOSE_LOGIN_CODE hook", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    resetRateLimits();
    await truncateAll();
  });
  // vi.stubEnv (not a direct process.env.NODE_ENV assignment, which
  // @types/node marks read-only) — vi.unstubAllEnvs() restores the real
  // environment after every single test, not just at the end of the file.
  afterEach(() => vi.unstubAllEnvs());

  it("leaks the code when both gates are set (flag=1, NODE_ENV=test)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("E2E_EXPOSE_LOGIN_CODE", "1");
    const { POST } = await import("@/app/api/account/code/route");
    const res = await POST(post({ email: email() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.code).toMatch(/^\d{6}$/);
  });

  it("never leaks in production, even with the flag on", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_EXPOSE_LOGIN_CODE", "1");
    const { POST } = await import("@/app/api/account/code/route");
    const res = await POST(post({ email: email() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.code).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(body, "code")).toBe(false);
  });

  it("does not leak when the flag is unset, even outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("E2E_EXPOSE_LOGIN_CODE", undefined as unknown as string);
    const { POST } = await import("@/app/api/account/code/route");
    const res = await POST(post({ email: email() }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.code).toBeUndefined();
  });

  it("does not leak when the flag is set to anything but the literal '1'", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("E2E_EXPOSE_LOGIN_CODE", "true");
    const { POST } = await import("@/app/api/account/code/route");
    const res = await POST(post({ email: email() }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.code).toBeUndefined();
  });

  it("does not leak in a development-like NODE_ENV without the flag", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("E2E_EXPOSE_LOGIN_CODE", undefined as unknown as string);
    const { POST } = await import("@/app/api/account/code/route");
    const res = await POST(post({ email: email() }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.code).toBeUndefined();
  });
});
