import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ADMIN_COOKIE,
  hashPassword,
  isAdmin,
  makeSessionToken,
  requireAdmin,
  resetRateLimits,
  verifyPassword,
  verifySessionToken,
} from "@/lib/auth";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

const PASSWORD = "correct horse battery staple";

function req(cookie?: string, url = "https://rempireshop.com/api/admin/me/"): Request {
  return new Request(url, { headers: cookie ? { cookie } : {} });
}

describe("admin session", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword(PASSWORD);
    await setupDb();
  });
  afterAll(teardownDb);

  it("checks the password against the scrypt digest", () => {
    expect(verifyPassword(PASSWORD)).toBe(true);
    expect(verifyPassword("wrong")).toBe(false);
    expect(verifyPassword("")).toBe(false);
    expect(verifyPassword(PASSWORD, "")).toBe(false); // no hash configured
    expect(verifyPassword(PASSWORD, "not-a-hash")).toBe(false);
    expect(verifyPassword(PASSWORD, hashPassword("something else"))).toBe(false);
  });

  it("signs a session that verifies and expires", () => {
    const token = makeSessionToken();
    expect(verifySessionToken(token)).toBe(true);
    // 31 days on, the same token is stale
    expect(verifySessionToken(token, Date.now() + 31 * 24 * 3600_000)).toBe(false);
    expect(verifySessionToken(null)).toBe(false);
    expect(verifySessionToken("")).toBe(false);
  });

  it("rejects forged cookies", async () => {
    const token = makeSessionToken();
    const [v, exp, sig] = token.split(".");

    const forged = [
      `${v}.${exp}.${sig.slice(0, -1)}${sig.slice(-1) === "a" ? "b" : "a"}`, // signature tampered
      `${v}.${Number(exp) + 86_400_000}.${sig}`, // expiry stretched, old signature
      `${v}.${exp}.`, // signature stripped
      "v1.9999999999999.deadbeef",
      "not-a-token",
    ];
    for (const bad of forged) {
      expect(verifySessionToken(bad)).toBe(false);
      expect(await requireAdmin(req(`${ADMIN_COOKIE}=${bad}`))).not.toBeNull();
    }

    // a valid signature made with somebody else's secret is still a forgery
    const real = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "another-secret-of-decent-length";
    const elsewhere = makeSessionToken();
    process.env.SESSION_SECRET = real;
    expect(verifySessionToken(elsewhere)).toBe(false);
  });

  it("requireAdmin lets a signed cookie through and 401s everything else", async () => {
    const good = req(`${ADMIN_COOKIE}=${makeSessionToken()}`);
    expect(await requireAdmin(good)).toBeNull();
    expect(isAdmin(good)).toBe(true);

    const denied = await requireAdmin(req());
    expect(denied?.status).toBe(401);
    expect(await denied?.json()).toEqual({ ok: false, error: "unauthorized" });
  });

  it("logs in, stays in, logs out", async () => {
    resetRateLimits();
    const { POST: login } = await import("@/app/api/admin/login/route");
    const { POST: logout } = await import("@/app/api/admin/logout/route");
    const { GET: me } = await import("@/app/api/admin/me/route");

    const post = (body: unknown) =>
      new Request("https://rempireshop.com/api/admin/login/", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
        body: JSON.stringify(body),
      });

    const bad = await login(post({ password: "nope" }));
    expect(bad.status).toBe(401);
    expect(bad.headers.get("set-cookie")).toBeNull();

    const ok = await login(post({ password: PASSWORD }));
    expect(ok.status).toBe(200);
    const setCookie = ok.headers.get("set-cookie") || "";
    expect(setCookie).toContain(`${ADMIN_COOKIE}=v1.`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain(`Max-Age=${30 * 24 * 3600}`);

    const value = setCookie.split(";")[0];
    expect((await me(req(value))).status).toBe(200);
    expect((await me(req())).status).toBe(401);

    const out = await logout(new Request("https://rempireshop.com/api/admin/logout/", { method: "POST" }));
    const cleared = out.headers.get("set-cookie") || "";
    expect(cleared).toContain("Max-Age=0");
    expect((await me(req(cleared.split(";")[0]))).status).toBe(401);
  });

  it("stops after five wrong passwords a minute", async () => {
    resetRateLimits();
    const { POST: login } = await import("@/app/api/admin/login/route");
    const attempt = () =>
      login(
        new Request("https://rempireshop.com/api/admin/login/", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" },
          body: JSON.stringify({ password: "nope" }),
        }),
      );

    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await attempt()).status);
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes.slice(5)).toEqual([429, 429]);
    resetRateLimits();
  });

  it("keeps the cookie unsecured only on plain-http localhost", async () => {
    const { POST: login } = await import("@/app/api/admin/login/route");
    resetRateLimits();
    const local = await login(
      new Request("http://localhost:3300/api/admin/login/", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
        body: JSON.stringify({ password: PASSWORD }),
      }),
    );
    expect(local.headers.get("set-cookie")).not.toContain("Secure");
    resetRateLimits();
  });
});
