import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ADMIN_ACCOUNT,
  ADMIN_COOKIE,
  clearLoginFailures,
  hashPassword,
  isAdmin,
  LOGIN_DELAY_MAX_MS,
  LOGIN_READ_TIMEOUT_MS,
  loginDelayFor,
  loginDelayMs,
  makeSessionToken,
  noteLoginFailure,
  pendingLoginDelayMs,
  requireAdmin,
  resetLoginDelays,
  resetRateLimits,
  setLoginSleeper,
  verifyPassword,
  verifySessionToken,
} from "@/lib/auth";
import { exec, query, type Querier } from "@/lib/db";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

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

  /* A hash that lost its key — clipped by a copy-paste, truncated by an env
     editor, or mangled to something base64 decodes to nothing — used to let
     EVERY password in: Buffer.from("", "base64") is empty, scryptSync() with
     keylen 0 answers an empty Buffer, and timingSafeEqual(empty, empty) is
     true. The key must be the whole 32 bytes or the hash is not a hash. */
  it("refuses a hash whose key is missing, short or not base64", () => {
    const good = hashPassword(PASSWORD);
    const [, n, r, p, salt, key] = good.split("$");

    const clipped = `scrypt$${n}$${r}$${p}$${salt}$`;
    expect(verifyPassword(PASSWORD, clipped)).toBe(false);
    expect(verifyPassword("literally anything", clipped)).toBe(false);

    // base64 skips characters it does not know, so this decodes to nothing
    expect(verifyPassword("literally anything", `scrypt$${n}$${r}$${p}$${salt}$!!!!`)).toBe(false);
    // …and a key that decodes to fewer than 32 bytes is not one either
    expect(verifyPassword("literally anything", `scrypt$${n}$${r}$${p}$${salt}$${key.slice(0, 8)}`)).toBe(false);

    // the whole one still opens the door
    expect(verifyPassword(PASSWORD, good)).toBe(true);
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

  /* ---------- the failed-login backoff -------------------------------------
   *
   * What was here until 17.09.2026: "stops after five wrong passwords a
   * minute", asserting [401 ×5, 429, 429] from rateLimit(). The assertion
   * passed and the behaviour it described did not exist — one Map in one
   * serverless instance, a fresh budget of five on every cold start and on
   * every instance the platform spun up beside it. The test proved the Map
   * worked, which was never the question. What follows tests the property the
   * shop actually needs: a guesser is slowed down more the longer it guesses,
   * and the owner is not. */

  it("the delay is nothing for a typo, then doubles, and stops below the function budget", () => {
    // the owner's first two misses are free — a soft keyboard is not an attack
    expect(loginDelayMs(0)).toBe(0);
    expect(loginDelayMs(1)).toBe(0);
    expect(loginDelayMs(2)).toBe(0);

    // from the third it doubles every time
    const ladder = [3, 4, 5, 6, 7, 8].map(loginDelayMs);
    expect(ladder).toEqual([500, 1000, 2000, 4000, 8000, 16000]);
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);

    // …and then flattens at the ceiling instead of running away
    expect(loginDelayMs(9)).toBe(LOGIN_DELAY_MAX_MS);
    expect(loginDelayMs(50)).toBe(LOGIN_DELAY_MAX_MS);
    expect(loginDelayMs(100_000)).toBe(LOGIN_DELAY_MAX_MS);

    /* The whole wait happens INSIDE the request, so a ceiling above the
       platform's budget would not throttle anybody — it would kill the
       function and answer 500. `maxDuration` tops out at 60 in this repo and
       the login route declares it. The counter read is inside the same
       request, so it is the SUM that has to fit — with scrypt, the audit
       write and a cold start still to pay for out of what is left. */
    expect(LOGIN_DELAY_MAX_MS).toBeLessThan(60_000);
    expect(LOGIN_DELAY_MAX_MS + LOGIN_READ_TIMEOUT_MS).toBeLessThan(30_000);
  });

  it("makes each wrong password wait longer than the last, and lets the right one straight in", async () => {
    resetLoginDelays();
    const { POST: login } = await import("@/app/api/admin/login/route");

    // the seam from src/lib/auth.ts: record what the route asked to wait for,
    // instead of actually spending half a minute climbing the ladder
    const waited: number[] = [];
    setLoginSleeper(async (ms) => { waited.push(ms); });

    const attempt = (password: string) =>
      login(
        new Request("https://rempireshop.com/api/admin/login/", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" },
          body: JSON.stringify({ password }),
        }),
      );

    try {
      for (let i = 0; i < 6; i++) expect((await attempt("nope")).status).toBe(401);

      /* Six wrong passwords, and only three waits: a zero delay is not a
         zero-length sleep, it is no sleep at all (sleepForLogin short-circuits
         it), so the owner's first two typos never touch a timer. */
      expect(waited).toEqual([500, 1000, 2000]);
      for (let i = 1; i < waited.length; i++) expect(waited[i]).toBeGreaterThan(waited[i - 1]);

      // no 429 anywhere: the panel can no longer be told about a limit that
      // is not the one being enforced (admLogin() in public/shop2/app.js
      // renders «Слишком много попыток — подождите минуту.» on 429 alone)
      const refused = await attempt("nope");
      expect(refused.status).toBe(401);
      expect(await refused.json()).toEqual({ ok: false, error: "bad_password" });

      /* THE POINT: the owner mistypes his own password repeatedly and then
         gets it right. He is made to wait; he is never locked out. */
      const ok = await attempt(PASSWORD);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("set-cookie") || "").toContain(`${ADMIN_COOKIE}=v1.`);

      // and the ladder is back at the bottom, so his next visit is free
      expect(pendingLoginDelayMs(ADMIN_ACCOUNT)).toBe(0);
      const spent = waited.length;
      expect((await attempt("nope")).status).toBe(401);
      expect(waited.length, "the attempt after a success must not wait at all").toBe(spent);
    } finally {
      setLoginSleeper(null);
      resetLoginDelays();
    }
  });

  it("forgets the ladder after an hour of quiet", () => {
    resetLoginDelays();
    const t0 = Date.parse("2026-09-17T10:00:00.000Z");
    for (let i = 0; i < 9; i++) noteLoginFailure(ADMIN_ACCOUNT, t0);
    expect(pendingLoginDelayMs(ADMIN_ACCOUNT, t0)).toBe(LOGIN_DELAY_MAX_MS);

    // 59 minutes later the shop still remembers
    expect(pendingLoginDelayMs(ADMIN_ACCOUNT, t0 + 59 * 60_000)).toBe(LOGIN_DELAY_MAX_MS);
    // an hour later it does not — otherwise this morning's typos would still
    // be charging the owner tonight, for no security anybody could name
    expect(pendingLoginDelayMs(ADMIN_ACCOUNT, t0 + 61 * 60_000)).toBe(0);
    resetLoginDelays();
  });

  /* ---------- the ladder that survives a cold start -------------------------
   *
   * The delay above was built on a Map inside one serverless instance, which
   * meant a cold start handed a guesser a fresh ladder — the exact weakness it
   * was meant to close. Since 17.09.2026 the count comes out of admin_audit:
   * the rows the login route was already writing, read back instead of merely
   * filed. What follows is the property that buys, and the price.
   *
   * None of these tests spend the delay. The route's sleeper is the recorder
   * from src/lib/auth.ts, and loginDelayFor() is asked what it would charge. */

  /** The whole route, with a recorder in place of the timer. */
  async function loginRig() {
    const { POST: login } = await import("@/app/api/admin/login/route");
    const waited: number[] = [];
    setLoginSleeper(async (ms) => { waited.push(ms); });
    // A fresh address for every attempt, counted rather than random so a
    // failure is reproducible: the ladder must not notice either way.
    let nth = 0;
    return {
      waited,
      attempt: (password: string) =>
        login(
          new Request("https://rempireshop.com/api/admin/login/", {
            method: "POST",
            headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${++nth}` },
            body: JSON.stringify({ password }),
          }),
        ),
    };
  }

  it("keeps the ladder across a cold start — and across a change of address", async () => {
    await truncateAll();
    resetLoginDelays();
    const { waited, attempt } = await loginRig();
    try {
      /* Five misses, every one of them from a DIFFERENT address, because the
         ladder is keyed on the account and moving house must buy a guesser
         nothing. The first two are free, then it doubles. */
      for (let i = 0; i < 5; i++) expect((await attempt("nope")).status).toBe(401);
      expect(waited).toEqual([500, 1000]);

      /* THE COLD START. The instance that served those five dies and the
         platform starts an empty one — which is all resetLoginDelays() is
         here: the Map, gone. Until today that was a fresh ladder, free. */
      resetLoginDelays();
      expect(pendingLoginDelayMs(ADMIN_ACCOUNT), "the Map really is empty").toBe(0);

      // …and the shop remembers anyway, because the count was never in the Map
      expect(await loginDelayFor(ADMIN_ACCOUNT)).toBe(2000);

      // the route charges it, on the new instance, from a sixth address
      expect((await attempt("nope")).status).toBe(401);
      expect(waited).toEqual([500, 1000, 2000]);
    } finally {
      setLoginSleeper(null);
      resetLoginDelays();
    }
  });

  it("puts the ladder back on the floor for every instance when the password is right", async () => {
    await truncateAll();
    resetLoginDelays();
    const { attempt } = await loginRig();
    try {
      for (let i = 0; i < 5; i++) expect((await attempt("nope")).status).toBe(401);
      expect(await loginDelayFor(ADMIN_ACCOUNT)).toBe(2000);

      /* NEVER A LOCKOUT: the right password is made to wait and is then let
         in, however far the ladder has climbed. */
      expect((await attempt(PASSWORD)).status).toBe(200);

      // a cold start after that must not resurrect the misses it cleared
      resetLoginDelays();
      expect(await loginDelayFor(ADMIN_ACCOUNT)).toBe(0);
    } finally {
      setLoginSleeper(null);
      resetLoginDelays();
    }
  });

  it("forgets the durable ladder after an hour of quiet", async () => {
    await truncateAll();
    resetLoginDelays();

    const misses = (ago: string, n: number) =>
      exec(
        `insert into admin_audit (at, actor, action)
         select now() - interval '${ago}', 'ip:203.0.113.9', 'admin.login.failed'
           from generate_series(1, ${n})`,
      );

    // nine misses two hours ago: enough for the ceiling, and long past caring
    await misses("2 hours", 9);
    expect(await loginDelayFor(ADMIN_ACCOUNT)).toBe(0);

    // still inside the window at fifty-nine minutes
    await truncateAll();
    await misses("59 minutes", 9);
    expect(await loginDelayFor(ADMIN_ACCOUNT)).toBe(LOGIN_DELAY_MAX_MS);
  });

  /* THE PRICE OF A DURABLE COUNTER: a database read now sits on the login
     path, and it can fail or drag. The decision and the argument for it are
     written out at loginDelayFor() in src/lib/auth.ts; this is that decision
     held to. */
  it("falls back on this instance's ladder when the counter cannot be read", async () => {
    await truncateAll();
    resetLoginDelays();
    const broken: Querier = async () => { throw new Error("database unavailable"); };

    // NOT failing closed: an unreadable database is not a reason to make the
    // owner — who has mistyped nothing — stand at his own door for twenty
    // seconds on the one day the shop is already having a bad one
    expect(await loginDelayFor(ADMIN_ACCOUNT, { q: broken })).toBe(0);

    /* NOT failing open either. The Map is still written on every miss whether
       the database answers or not, so an outage degrades the ladder to the
       per-instance one the shop ran on yesterday — not to none of it. */
    for (let i = 0; i < 5; i++) noteLoginFailure(ADMIN_ACCOUNT);
    expect(await loginDelayFor(ADMIN_ACCOUNT, { q: broken })).toBe(2000);
    expect(await loginDelayFor(ADMIN_ACCOUNT, { q: broken })).toBeLessThan(LOGIN_DELAY_MAX_MS);

    // and the right password still clears it instantly, outage or no outage
    clearLoginFailures(ADMIN_ACCOUNT);
    expect(await loginDelayFor(ADMIN_ACCOUNT, { q: broken })).toBe(0);
    resetLoginDelays();
  });

  it("does not let a slow counter hold the login open", async () => {
    resetLoginDelays();
    for (let i = 0; i < 5; i++) noteLoginFailure(ADMIN_ACCOUNT);

    const hangs: Querier = () => new Promise(() => {}); // never answers at all
    const t0 = Date.now();
    const ms = await loginDelayFor(ADMIN_ACCOUNT, { q: hangs, timeoutMs: 50 });
    const spent = Date.now() - t0;

    expect(ms, "the Map answered instead").toBe(2000);
    expect(spent, "a sick database must not decide how long the owner waits").toBeLessThan(2_000);
    resetLoginDelays();
  });

  /* A read that succeeds may only ever ADD rungs. The two counters agree in
     the ordinary case and part in two: after a cold start the database
     remembers more than the Map, and during an outage the Map remembers more
     than the database can be asked. Neither may be rounded down to the other. */
  it("takes whichever counter is higher", async () => {
    await truncateAll();
    resetLoginDelays();
    await exec(
      `insert into admin_audit (at, actor, action)
       select now(), 'ip:203.0.113.9', 'admin.login.failed' from generate_series(1, 4)`,
    );

    // database 4, Map 0 — the cold start case
    expect(pendingLoginDelayMs(ADMIN_ACCOUNT)).toBe(0);
    expect(await loginDelayFor(ADMIN_ACCOUNT)).toBe(loginDelayMs(4));

    // database 4, Map 6 — an instance that saw misses the database did not
    for (let i = 0; i < 6; i++) noteLoginFailure(ADMIN_ACCOUNT);
    expect(await loginDelayFor(ADMIN_ACCOUNT)).toBe(loginDelayMs(6));
    resetLoginDelays();
  });

  /* writeAuditSafe() swallows its own failures, so the "admin.login" row that
     clears the ladder for everybody can silently fail to be written — a
     database taking writes badly and reads fine. The owner would then keep
     paying a wait he had already cleared by getting the password RIGHT, which
     is the one thing this design promised never to charge for. What this
     instance watched happen says so instead (clearLoginFailures). */
  it("honours a success this instance saw even when its audit row was lost", async () => {
    await truncateAll();
    resetLoginDelays();
    await exec(
      `insert into admin_audit (at, actor, action)
       select now(), 'ip:203.0.113.9', 'admin.login.failed' from generate_series(1, 9)`,
    );
    expect(await loginDelayFor(ADMIN_ACCOUNT)).toBe(LOGIN_DELAY_MAX_MS);

    /* The right password, and no "admin.login" row to show for it. The instant
       comes from the DATABASE, not from Date.now(): every failure row above and
       below is stamped by the database's clock, and nothing orders the two
       clocks against each other. Taken from the JS side, the four rows below
       can land on the floor's wrong side and the ladder reads zero — which is
       how this test failed in a full parallel run on 18.09.2026 while passing
       alone. One clock throughout, and it is deterministic. (The product is
       right either way: a success clears what came before it, and the only real
       cost is that a miss in the same millisecond as a success is forgiven.) */
    const [{ t }] = await query<{ t: string }>("select now() as t");
    clearLoginFailures(ADMIN_ACCOUNT, new Date(t).getTime());
    expect(await loginDelayFor(ADMIN_ACCOUNT)).toBe(0);

    // …and the ladder starts climbing again from the floor, not from nine
    await exec(
      `insert into admin_audit (at, actor, action)
       select now(), 'ip:203.0.113.9', 'admin.login.failed' from generate_series(1, 4)`,
    );
    expect(await loginDelayFor(ADMIN_ACCOUNT)).toBe(loginDelayMs(4));
    resetLoginDelays();
  });

  /* A SESSION_SECRET of ten characters is not a secret this shop can sign with
     — secret() in src/lib/auth.ts wants sixteen — but /api/admin/login/ used to
     test the env var for mere PRESENCE. The password was verified, then
     adminCookie() → makeSessionToken() threw: a bare 500 with no `error` in the
     body, which admLogin() in app.js reads as «Сервер не отвечает», while
     /api/admin/me/ went on answering `configured: true`. Nothing anywhere
     pointed at the secret (audit). Both must ask the one question. */
  it("calls a SESSION_SECRET under 16 characters not_configured, in both routes", async () => {
    resetRateLimits();
    const { POST: login } = await import("@/app/api/admin/login/route");
    const { GET: me } = await import("@/app/api/admin/me/route");
    const kept = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "short-one"; // nine characters: present, unusable
    try {
      const r = await login(
        new Request("https://rempireshop.com/api/admin/login/", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.44" },
          body: JSON.stringify({ password: PASSWORD }),
        }),
      );
      expect(r.status).toBe(500);
      expect(await r.json()).toEqual({ ok: false, error: "not_configured" });
      expect(r.headers.get("set-cookie")).toBeNull();

      const probe = await me(req());
      expect(probe.status).toBe(401);
      expect((await probe.json()).configured).toBe(false);
    } finally {
      process.env.SESSION_SECRET = kept;
      resetRateLimits();
    }
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
