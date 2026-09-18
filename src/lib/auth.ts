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
/* The failed-login ladder counts rows in admin_audit — see «failed-login
   backoff» below. src/lib/db.ts only imports `pg` as a type and loads the
   driver on first use, so nothing here is pulled into a bundle that does not
   already ask a question of the database. */
import { query, type Querier } from "@/lib/db";

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
 * WHAT «three guesses a minute» ACTUALLY BOUNDS, corrected 19.09.2026 (audit
 * F45): one connection, not one attacker. The delay is read BEFORE the
 * password is checked and the failure row is written AFTER it, and there is
 * deliberately no 429 — so *k* requests sent in parallel each read the same
 * count, each wait the same ≤ 20 s, and each is one guess: *k* × 3 a minute.
 * What actually caps a parallel attacker is scrypt's ~100 ms of CPU per guess
 * and the platform's concurrency, not this ladder. The ladder buys time
 * against a sequential guesser and keeps the owner out of a lockout; the real
 * protection is a password long enough not to be guessed. `tests/auth.test.ts`
 * measures sequential attempts only, which is why this went unnoticed.
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
 * WHERE THE COUNTER LIVES, and why that changed on 17.09.2026. It was a Map
 * in one serverless instance, and this paragraph used to say so and stop
 * there: a cold start emptied it, a second instance ran its own, and a
 * guesser therefore got a fresh ladder for free — the exact weakness the
 * delay was built to close. A shared counter in Postgres had been turned down
 * on the grounds that it meant a database write on every login. That was
 * simply wrong, and checking it is what settled the question: every refused
 * password ALREADY writes a row, `writeAuditSafe(…, "admin.login.failed")` in
 * the login route, and every accepted one writes "admin.login" beside it. The
 * ladder was in the table the whole time and nothing was reading it, so the
 * durable version costs one SELECT and no write at all (192_login_ladder_index.sql
 * adds the two partial indexes that make the SELECT cheap, and is honest
 * there about the one b-tree entry a login row now maintains).
 *
 * So there are two counters, and they are not rivals:
 *
 *   the DATABASE is the truth — failures since the later of the last accepted
 *   password and an hour ago, shared by every instance, unmoved by a cold
 *   start or a redeploy;
 *
 *   the MAP is the fallback — the same ladder this file has always kept,
 *   still written on every miss, and what the shop falls back on when the
 *   read fails or is slow.
 *
 * The delay is taken from whichever is HIGHER, so the read can only ever add
 * rungs, never quietly remove one. See loginDelayFor() below for the failure
 * decision and the argument for it.
 *
 * WHAT IT STILL IS NOT. It is not a lockout and it is not a fortress: a
 * guesser who is willing to spend twenty seconds a try still gets three tries
 * a minute, forever. What it now is, which it was not yesterday, is a ladder
 * that keeps climbing across cold starts, instances and deploys — so the
 * twenty seconds actually arrive and stay.
 *
 * AND WHAT IT COSTS THE OWNER, said plainly rather than discovered at 3 a.m.
 * A ladder shared by every instance is a ladder an attacker can hold at the
 * ceiling, and the owner is on the same one. So while somebody is hammering
 * the shop, Renat's own first sign-in waits up to twenty seconds too. That is
 * the price of the thing being fixed, and it was half-true before — a warm
 * instance with a climbed Map did the same, only unreliably. It is still not
 * a lockout: the wait ends, the right password is taken, and taking it puts
 * the ladder back on the floor for everyone. If that twenty seconds is ever
 * judged too much, the lever is the ORDER in the login route — verifying
 * before waiting, so that only a refusal is ever made to wait — not a lower
 * ceiling, which would help the attacker and the owner equally.
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

/* The in-instance ladder. `n`/`at` are the consecutive misses and when the
   last one was; `okAt` is when THIS instance last saw the right password, and
   it is kept after the ladder is cleared — see loginFailuresSince(). */
const loginFailures = new Map<string, { n: number; at: number; okAt: number }>();

function currentFailures(account: string, now: number): number {
  const rec = loginFailures.get(account);
  if (!rec || now - rec.at >= LOGIN_FORGET_MS) return 0;
  return rec.n;
}

/**
 * What this attempt must wait according to THIS INSTANCE alone.
 *
 * The fallback, not the answer: loginDelayFor() is what the route asks. Kept
 * synchronous and exported because the ladder's arithmetic is tested through
 * it without a database in the way.
 */
export function pendingLoginDelayMs(account: string, now: number = Date.now()): number {
  return loginDelayMs(currentFailures(account, now));
}

/** A wrong password: one more rung on the ladder. */
export function noteLoginFailure(account: string, now: number = Date.now()): void {
  const okAt = loginFailures.get(account)?.okAt ?? 0;
  loginFailures.set(account, { n: currentFailures(account, now) + 1, at: now, okAt });
}

/**
 * The right password: back to the bottom, so the owner is never made to pay
 * twice.
 *
 * The instant is REMEMBERED rather than merely forgotten, because the durable
 * ladder is reset by the "admin.login" audit row and that row is written by
 * writeAuditSafe(), which swallows its own failures. A database that takes
 * writes badly and reads fine would otherwise leave the owner paying a wait
 * he had already cleared: the right password let him in, and nothing the next
 * instance could read said so. What this instance watched happen is allowed
 * to say so instead — loginFailuresSince() hands the timestamp to the query
 * as a floor on the window.
 */
export function clearLoginFailures(account: string, now: number = Date.now()): void {
  loginFailures.set(account, { n: 0, at: now, okAt: now });
}

/* ---------- the durable ladder ------------------------------------------- */

/**
 * How long to wait for the count before giving up on it. Small against the
 * route's 60 s budget and generous against a cold connection pool: a login
 * during a database outage is slower by this much ONCE, and then answered
 * from the Map. Anything larger would let a sick database, rather than a
 * guesser, decide how long the owner stands at his own door.
 */
export const LOGIN_READ_TIMEOUT_MS = 1_500;

/**
 * Failures on this account since the ladder was last put back on the floor —
 * counted in Postgres, where a cold start cannot forget them.
 *
 * WHAT IS BEING COUNTED. admin_audit rows, which the login route already
 * writes and which nothing else produces: one "admin.login.failed" per
 * refused password, one "admin.login" per accepted one. The window opens at
 * the LATEST of three instants and every one of them is load-bearing:
 *
 *   an hour ago            — the quiet hour, so this morning's typos are not
 *                            still being charged for tonight;
 *   the last "admin.login" — a correct password clears the ladder, durably
 *                            and for every instance at once;
 *   `sinceMs`              — a success this instance saw, for the case where
 *                            that row failed to be written (clearLoginFailures).
 *
 * KEYED ON THE ACCOUNT, and `actor` is deliberately not in the query. The
 * audit row records `ip:<address>` as the actor, because that is the
 * interesting thing to have later — but the address is a line the attacker
 * picks and the owner cannot, so it must not be what the ladder counts by.
 * The action name is what identifies the account here, and it can, because
 * this shop has exactly ONE (ADMIN_ACCOUNT, and the file header above). A
 * second admin would need the account in the row, not a filter added here.
 *
 * Null, never a number, when the read fails or runs out of time — the caller
 * decides what that means, and loginDelayFor() is where that decision is
 * written down.
 *
 * THE CLOCK is the database's for everything the database decides: `at`
 * defaults to now() and the hour is measured from now(), so the window and the
 * rows it is comparing come from one clock. The single exception is `sinceMs`,
 * which is by nature this instance's own — it is what this instance WATCHED
 * happen, so it can only be timed by the clock that watched it. It is compared
 * against database timestamps and so carries the machines' skew, which is why
 * it is the third floor and not the only one: when the success row was written
 * the database's own copy of that instant sits beside it in the greatest() and
 * a skewed one changes nothing. It decides alone only in the case it exists
 * for — the success whose row was lost.
 *
 * An elapsed hour, not a calendar day, so src/lib/day.ts and Tallinn do not
 * come into it (see 192_login_ladder_index.sql).
 */
export async function loginFailuresSince(
  account: string,
  opts: { q?: Querier; sinceMs?: number; timeoutMs?: number } = {},
): Promise<number | null> {
  if (account !== ADMIN_ACCOUNT) return null;
  const run = opts.q ?? query;
  const since = opts.sinceMs && opts.sinceMs > 0 ? new Date(opts.sinceMs).toISOString() : null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const rows = await Promise.race([
      run<{ n: number | string }>(
        `select count(*) as n
           from admin_audit
          where action = 'admin.login.failed'
            and at > greatest(
                  now() - interval '1 millisecond' * $1::double precision,
                  coalesce((select max(at) from admin_audit where action = 'admin.login'), '-infinity'::timestamptz),
                  coalesce($2::timestamptz, '-infinity'::timestamptz)
                )`,
        [LOGIN_FORGET_MS, since],
      ),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), opts.timeoutMs ?? LOGIN_READ_TIMEOUT_MS);
      }),
    ]);
    if (!rows) return null; // the timer won
    const n = Number(rows[0]?.n ?? 0);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  } catch (err) {
    console.error("[auth] the failed-login counter could not be read:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What this attempt must wait. The one the route asks.
 *
 * WHEN THE READ FAILS OR IS SLOW: fall back on the Map — NOT on zero, and NOT
 * on the ceiling. Both of the obvious answers are worse than the thing this
 * change replaced:
 *
 *   FAILING OPEN hands an attacker a lever. The protection would switch
 *   itself off during any database wobble, and a wobble is not something they
 *   have to cause — waiting for one is enough, and the login route keeps
 *   working without the database (the password is an env var and the cookie
 *   is signed with another), so an outage is precisely when the shop is both
 *   guessable and unwatched.
 *
 *   FAILING CLOSED — twenty seconds for everybody — punishes the owner on the
 *   one day the shop is already having a bad one, and it punishes his CORRECT
 *   password, which is the single thing this design promised never to do. A
 *   wait he cannot clear by getting it right is a lockout with better manners.
 *
 * The Map is neither. It is the ladder the shop ran on until today and the
 * owner already accepted, it is keyed on the same account, and it is kept up
 * to date on every miss whether the database answers or not. So a failed read
 * degrades to yesterday's protection rather than to none of it, and a correct
 * password still clears it instantly. The cost is stated plainly: while the
 * database is unreadable the ladder is per-instance again, which is to say a
 * cold start forgets it.
 *
 * Whichever counter is higher wins, so the read can only ever add rungs. The
 * two agree in the ordinary case; they part after a cold start (the database
 * remembers, the Map does not) and during an outage (the Map remembers, the
 * database cannot be asked).
 */
export async function loginDelayFor(
  account: string,
  opts: { q?: Querier; timeoutMs?: number; now?: number } = {},
): Promise<number> {
  const now = opts.now ?? Date.now();
  const local = currentFailures(account, now);
  const durable = await loginFailuresSince(account, {
    q: opts.q,
    timeoutMs: opts.timeoutMs,
    sinceMs: loginFailures.get(account)?.okAt,
  });
  return loginDelayMs(durable === null ? local : Math.max(durable, local));
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
