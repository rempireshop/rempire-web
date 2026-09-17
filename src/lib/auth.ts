/**
 * Admin session. One password, one cookie, no user table — the shop has
 * exactly one administrator.
 *
 * Cookie `rmp_admin` holds `v1.<expiry-ms>.<hmac>`, signed with SESSION_SECRET
 * (HMAC-SHA256). Nothing secret lives in it: it is a bearer token whose only
 * claim is "this browser knew the password before <expiry>". httpOnly, so
 * script on the page cannot read it; sameSite=lax, so it does not ride along
 * on cross-site POSTs; secure everywhere except plain-http localhost, where a
 * secure cookie would simply be dropped by the browser.
 *
 * The password itself is never stored — ADMIN_PASSWORD_HASH holds a scrypt
 * digest produced by tools/hash-password.mjs.
 *
 * Route usage:
 *   const denied = await requireAdmin(req);
 *   if (denied) return denied;
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "rmp_admin";
export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

/* ---------- session token ------------------------------------------------ */

function secret(): string | null {
  const s = process.env.SESSION_SECRET;
  return s && s.length >= 16 ? s : null;
}

/**
 * True when SESSION_SECRET is long enough to sign a session with.
 *
 * The only rule about the secret lives in secret() above — sixteen characters
 * — and everything that asks "can this deployment sign anybody in?" has to ask
 * the SAME question. /api/admin/login/ used to test `process.env.SESSION_SECRET`
 * for mere presence: a ten-character secret walked through that gate, the
 * password was verified, and then makeSessionToken() threw — a bare 500 with no
 * `error` in it, which the login card reads as «Сервер не отвечает» while
 * /api/admin/me/ went on answering `configured: true`. Nothing on screen
 * pointed at the secret (audit). One predicate, one answer.
 */
export function sessionSecretOk(): boolean {
  return secret() !== null;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** `v1.<expiry>.<signature>` — the value that goes into the cookie. */
export function makeSessionToken(now: number = Date.now()): string {
  const key = secret();
  if (!key) throw new Error("SESSION_SECRET is not set (needs at least 16 characters) — see docs/backend.md");
  const payload = `v1.${now + SESSION_MS}`;
  return `${payload}.${sign(payload, key)}`;
}

/** Signature valid and not expired. Constant-time compare, no exceptions. */
export function verifySessionToken(token: string | null | undefined, now: number = Date.now()): boolean {
  const key = secret();
  if (!key || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp <= now) return false;
  const want = Buffer.from(sign(`v1.${parts[1]}`, key));
  const got = Buffer.from(parts[2]);
  if (want.length !== got.length) return false;
  return timingSafeEqual(want, got);
}

/* ---------- cookies ------------------------------------------------------ */

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      /* `rmp_admin=%` is a URIError, and an unhandled one turns every admin
         route — including /api/admin/me/, which the storefront calls on boot —
         into a 500. A cookie that cannot be decoded is a cookie we do not
         have: show the login card (audit L1). */
      return null;
    }
  }
  return null;
}

/* A Secure cookie is thrown away by the browser over plain http, which would
   make local development impossible; everywhere else it is on. */
function isLocal(req: Request): boolean {
  try {
    const u = new URL(req.url);
    return u.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  } catch {
    return false;
  }
}

function cookie(req: Request, value: string, maxAge: number): string {
  const bits = [
    `${ADMIN_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (!isLocal(req)) bits.push("Secure");
  return bits.join("; ");
}

/** Set-Cookie value that logs the browser in for SESSION_DAYS. */
export function adminCookie(req: Request, token: string = makeSessionToken()): string {
  return cookie(req, token, SESSION_DAYS * 24 * 60 * 60);
}

/** Set-Cookie value that logs the browser out. */
export function clearAdminCookie(req: Request): string {
  return cookie(req, "", 0);
}

/* ---------- guards ------------------------------------------------------- */

export function isAdmin(req: Request): boolean {
  return verifySessionToken(readCookie(req, ADMIN_COOKIE));
}

/**
 * null when the request carries a valid admin cookie, otherwise the 401 the
 * route should return unchanged.
 */
export async function requireAdmin(req: Request): Promise<Response | null> {
  if (isAdmin(req)) return null;
  const code = secret() ? "unauthorized" : "not_configured";
  return Response.json({ ok: false, error: code }, { status: 401 });
}

/* ---------- password ----------------------------------------------------- */

/** `scrypt$N$r$p$salt$key`, all base64. Mirrors tools/hash-password.mjs. */
export function hashPassword(password: string, salt: Buffer = randomBytes(16)): string {
  const key = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$");
}

/** Checks a password against ADMIN_PASSWORD_HASH. False if unset or malformed. */
export function verifyPassword(password: string, stored: string | undefined = process.env.ADMIN_PASSWORD_HASH): boolean {
  if (!stored || typeof password !== "string" || !password) return false;
  const parts = stored.trim().split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!N || !r || !p) return false;
  try {
    const salt = Buffer.from(parts[4], "base64");
    const want = Buffer.from(parts[5], "base64");
    /* The key has to be the whole 32 bytes hashPassword() writes. A clipped
       or mangled ADMIN_PASSWORD_HASH decodes to an empty Buffer, scryptSync()
       with keylen 0 answers an empty Buffer too, and timingSafeEqual() of two
       empty Buffers is TRUE — the login then let every password in, while
       /api/admin/me/ went on reporting the password as configured (audit). */
    if (want.length !== SCRYPT.keylen) return false;
    const got = scryptSync(password, salt, want.length, { N, r, p, maxmem: SCRYPT.maxmem });
    return want.length === got.length && timingSafeEqual(want, got);
  } catch {
    return false;
  }
}

/* ---------- request helpers ---------------------------------------------- */

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "0.0.0.0";
}

/*
 * Best-effort per-IP limiter: one Map per serverless instance, reset on a cold
 * start. Not a fortress — it stops casual hammering of the login and the order
 * endpoint without another moving part to run.
 */
const buckets = new Map<string, { n: number; until: number }>();

/** True when the caller is over the limit. */
export function rateLimit(bucket: string, ip: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const key = `${bucket}:${ip}`;
  const rec = buckets.get(key);
  if (!rec || rec.until <= now) {
    buckets.set(key, { n: 1, until: now + windowMs });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.until <= now) buckets.delete(k);
    return false;
  }
  rec.n += 1;
  return rec.n > max;
}

/** Tests only — forget every counter. */
export function resetRateLimits(): void {
  buckets.clear();
}

/* ---------- failed-login backoff ----------------------------------------
 *
 * The admin password used to be guarded by rateLimit() above — five tries a
 * minute per IP — and both the route's own docstring and the panel told the
 * owner that was the rule. It was not. The Map lives in one serverless
 * instance and dies with it, so every cold start, and every instance the
 * platform happens to spin up alongside, handed out a fresh budget of five;
 * and the 429 it answered with was instant and free, which is the worst
 * possible reply to give a guesser. Subtract the claim and what actually slowed
 * anybody down was scrypt: about 100 ms a try.
 *
 * What replaces it is a delay that GROWS, keyed on the account rather than on
 * the address — because the account is the thing being guessed at, and an
 * address is a line the attacker picks and the owner cannot.
 *
 * WHY A DELAY AND NOT A LOCKOUT. A lockout keyed on the one account this shop
 * has is a denial-of-service anybody can trigger from anywhere: type rubbish
 * five times and Renat cannot get into his own panel. A delay has no such
 * lever — the right password always works, it is only ever made to wait.
 *
 * THE SHAPE, and why it is shaped like this. The first two misses cost
 * nothing: the owner runs this shop from a phone, on a soft keyboard, and a
 * typo is not an attack. From the third the wait doubles, so a PERSON who
 * mistypes three times has spent half a second in total, while a MACHINE
 * reaches the ceiling within a dozen tries and is then held to about three
 * guesses a minute for as long as it keeps going. That asymmetry is the whole
 * mechanism; the exact constants matter much less than the fact that one side
 * is flat and the other is exponential.
 *
 * THE CEILING IS A HARD REQUIREMENT, not a preference. The wait happens inside
 * the request, so a delay longer than the platform's function budget does not
 * throttle anybody — it just kills the function and answers 500. LOGIN_DELAY_MAX_MS
 * is 20 s against the `maxDuration = 60` the login route declares, leaving
 * room for scrypt, the audit write and a slow cold start on top.
 *
 * AN HOUR OF QUIET FORGETS THE LADDER. Without that, three fat-fingered
 * attempts in the morning would still be charging the owner a full wait that
 * evening, for no security anybody could name.
 *
 * ONLY A WRONG PASSWORD COSTS ANYTHING, and a right one puts the ladder back
 * on the floor. That is not a convenience, it is what makes an account-keyed
 * delay safe to key on an account that EVERYTHING shares — one owner, one
 * password, and an e2e suite in which several dozen tests sign in as him,
 * often at the same time. All of those sign-ins are correct ones, so they cost
 * zero and each of them clears whatever a wrong-password test had just built
 * up. Compare the per-IP limiter this replaces, which counted SUCCESSES too:
 * fifteen valid sign-ins from one address tripped it, and e2e/admin-back.spec.ts
 * and e2e/admin-blog-pictures.spec.ts both carry hand-allocated address blocks
 * that exist for no other reason than to dodge it.
 *
 * The suite therefore does not need the delay switched off, and must not
 * switch it off: setLoginSleeper() below is for OBSERVING the wait — a test
 * records the milliseconds the route asked for and asserts on them — not for
 * removing it. The one thing a test must not do is spend twenty real seconds
 * proving arithmetic.
 *
 * WHAT THIS HONESTLY IS NOT. The counter is still a Map in one instance, so a
 * cold start still resets the ladder and a caller with real concurrency gets
 * one ladder per instance — a shared counter in Postgres was considered and
 * rejected, as this shop is not under attack and that is a database write on
 * every login. It is written down here rather than glossed over, because
 * claiming more than that is exactly what went wrong the last time. What it
 * does buy, which the 429 did not: every wrong guess now costs the attacker
 * wall-clock time on the instance that served it, and a held-open function is
 * a concurrency slot they do not get back.
 */

/** The one account this shop has (src/lib/auth.ts header: one password, no user table). */
export const ADMIN_ACCOUNT = "admin";

/** Misses that cost nothing — a person's typos. */
const LOGIN_FREE_TRIES = 2;
const LOGIN_DELAY_BASE_MS = 500;
/** Must stay well under the route's `maxDuration` (60 s) — see the note above. */
export const LOGIN_DELAY_MAX_MS = 20_000;
/** A quiet hour and the ladder is back to the bottom. */
const LOGIN_FORGET_MS = 60 * 60 * 1000;

/**
 * How long the NEXT attempt waits after `failures` consecutive misses. Pure,
 * so the curve can be read off in a test without anything actually sleeping.
 */
export function loginDelayMs(failures: number): number {
  const n = Math.floor(Number(failures) || 0);
  if (n <= LOGIN_FREE_TRIES) return 0;
  const steps = Math.min(n - LOGIN_FREE_TRIES - 1, 40); // 2^40 ms already dwarfs the cap
  return Math.min(LOGIN_DELAY_MAX_MS, LOGIN_DELAY_BASE_MS * 2 ** steps);
}

const loginFailures = new Map<string, { n: number; at: number }>();

function currentFailures(account: string, now: number): number {
  const rec = loginFailures.get(account);
  if (!rec || now - rec.at >= LOGIN_FORGET_MS) return 0;
  return rec.n;
}

/** What this attempt must wait before it is even looked at. */
export function pendingLoginDelayMs(account: string, now: number = Date.now()): number {
  return loginDelayMs(currentFailures(account, now));
}

/** A wrong password: one more rung on the ladder. */
export function noteLoginFailure(account: string, now: number = Date.now()): void {
  loginFailures.set(account, { n: currentFailures(account, now) + 1, at: now });
}

/** The right password: back to the bottom, so the owner is never made to pay twice. */
export function clearLoginFailures(account: string): void {
  loginFailures.delete(account);
}

/* The wait itself, behind a seam. The real one is setTimeout; a test replaces
   it with a RECORDER, so the suite can read back the exact millisecond figures
   the route asked for and assert on them — proving the ladder without spending
   half a minute climbing it. A replacement that silently swallows the wait and
   checks nothing is the protection turned off, not a test of it. */
type Sleeper = (ms: number) => Promise<void>;
const realSleep: Sleeper = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let sleeper: Sleeper = realSleep;

export function sleepForLogin(ms: number): Promise<void> {
  return ms > 0 ? sleeper(ms) : Promise.resolve();
}

/** Tests only — swap the timer out, or pass null to put the real one back. */
export function setLoginSleeper(fn: Sleeper | null): void {
  sleeper = fn ?? realSleep;
}

/** Tests only — forget every ladder. */
export function resetLoginDelays(): void {
  loginFailures.clear();
}
