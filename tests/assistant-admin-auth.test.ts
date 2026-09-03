/**
 * POST /api/assistant — mode:"admin" must require the admin cookie (audit
 * H1). This file exists as the fast, isolated backstop for that check
 * because the e2e suite cannot exercise it end-to-end: the route checks
 * OPENAI_API_KEY before it checks the cookie (route.ts line ~197), and the
 * Playwright suite deliberately runs with no key at all — the chatbot spec
 * needs that to see the assistant's own graceful "disabled" state (see
 * docs/testing.md, "what could not be automated"). With no key, every call —
 * admin or not, cookied or not — answers 503 {enabled:false} before auth is
 * even considered, so a real 401 for this route only shows up when a key is
 * configured, which is exactly what this file sets up (with fetch stubbed,
 * so no real call to OpenAI ever happens).
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const HOST = "rempireshop.com";

/** The route is typed to take NextRequest (it reads .headers the same way a
 *  plain Request does — this is just satisfying the type, not different
 *  behavior from the plain-Request helper other test files in this repo use
 *  for routes typed as `Request`). */
function req(body: unknown, opts: { cookie?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host: HOST,
  };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.cookie) headers.cookie = opts.cookie;
  return new NextRequest(`${ORIGIN}/api/assistant/`, { method: "POST", headers, body: JSON.stringify(body) });
}

const adminBody = { mode: "admin", messages: [{ role: "user", content: "привет" }] };

/** A minimal-but-well-formed OpenAI chat-completions response. */
function fakeCompletion() {
  return new Response(
    JSON.stringify({
      model: "gpt-4.1-mini",
      choices: [{ message: { content: JSON.stringify({ reply: "ок" }) } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("POST /api/assistant — admin mode auth", () => {
  let adminCookie = "";
  const savedKey = process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    adminCookie = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(async () => {
    await teardownDb();
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  });
  beforeEach(() => resetRateLimits());
  afterEach(() => vi.unstubAllGlobals());

  it("401s admin mode with no cookie, once a key is configured", async () => {
    process.env.OPENAI_API_KEY = "sk-test-dummy";
    vi.stubGlobal("fetch", () => {
      throw new Error("must not call OpenAI before the admin check");
    });
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req(adminBody, { origin: ORIGIN }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("unauthorized");
  });

  it("succeeds admin mode with a valid cookie and a configured key", async () => {
    process.env.OPENAI_API_KEY = "sk-test-dummy";
    vi.stubGlobal("fetch", vi.fn(async () => fakeCompletion()));
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req(adminBody, { origin: ORIGIN, cookie: adminCookie }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toBe("ок");
  });

  it("403s admin mode with no Origin header at all, cookie or not", async () => {
    process.env.OPENAI_API_KEY = "sk-test-dummy";
    vi.stubGlobal("fetch", () => {
      throw new Error("must not call OpenAI without an Origin");
    });
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req(adminBody, { origin: null, cookie: adminCookie }));
    expect(res.status).toBe(403);
  });

  it("503s every call — admin, cookied, anything — when no key is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    vi.stubGlobal("fetch", () => {
      throw new Error("must not call OpenAI with no key");
    });
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req(adminBody, { origin: ORIGIN, cookie: adminCookie }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.enabled).toBe(false);
  });
});
