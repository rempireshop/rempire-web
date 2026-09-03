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
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
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
