/**
 * «Продолжить с Google» — the second door into a customer's account, beside
 * the e-mailed six-digit code (src/lib/customers.ts), never instead of it.
 * Dim approved the design on 02.11.2026 (canvas-banner/project/Login.dc.html,
 * GoogleBtn.dc.html); the owner's setup steps are docs/google-login.md.
 *
 * ---- the flow ------------------------------------------------------------
 *
 * OpenID Connect, implicit flow, `response_type=id_token` +
 * `response_mode=form_post`. It needs NO client secret, and that is the point:
 * nobody has to paste a secret anywhere, and the client ID itself is public
 * (it is in every authorisation URL a browser sees).
 *
 *   1. GET  /api/account/google/start?return=/ru/checkout
 *      → a random `state` and `nonce`, kept with the return path in a signed,
 *        HttpOnly, ten-minute cookie (STATE_COOKIE), and a 302 to Google.
 *   2. Google shows its account chooser and POSTs the form back to
 *      /api/account/google/callback: `id_token` + `state`, or `error`.
 *   3. The callback checks the state against the cookie, verifies the token
 *      (RS256 against Google's published keys, issuer, audience, expiry,
 *      nonce, a verified address), and signs the customer in exactly the way
 *      a correct code does (src/lib/customer-signin.ts) — the same row, found
 *      by the lower-cased e-mail or created as a first code login creates it.
 *   4. 303 to the return path with `?google=ok` or `?google=cancel`, which
 *      public/shop2/app.js turns into «Вы вошли как …» or the alert.
 *
 * ---- why the state cookie is SameSite=None -------------------------------
 *
 * Step 2 is a cross-site POST (accounts.google.com → the shop). A Lax cookie
 * is not sent on one, so a Lax state cookie would make every callback look
 * like a forgery. SameSite=None requires Secure, which is why this cookie is
 * Secure even on http://localhost — Chrome and Firefox treat localhost as a
 * secure context and keep it. It is scoped to STATE_PATH, so it rides on the
 * two Google routes and nothing else, and it holds nothing but random values
 * and a path inside the shop.
 *
 * ---- off unless configured -----------------------------------------------
 *
 * GOOGLE_CLIENT_ID unset (or SESSION_SECRET too short to sign with) → both
 * routes answer 404 and /api/overrides says `google_signin: false`, so the
 * storefront draws no button anywhere. Nothing else changes.
 *
 * This module is a leaf on purpose: node:crypto, the secret rule of
 * src/lib/auth.ts and the e-mail rule of src/lib/customers.ts. No database.
 */
import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify, type KeyObject } from "node:crypto";
import { readCookie, sessionSecretOk } from "@/lib/auth";
import { isEmail, normalizeEmail } from "@/lib/customers";

/* ---------- configuration ------------------------------------------------- */

/** The OAuth client ID from the Google Cloud console, or null when unset. Public, not a secret. */
export function googleClientId(): string | null {
  const v = String(process.env.GOOGLE_CLIENT_ID ?? "").trim();
  return v ? v : null;
}

/**
 * Is «Продолжить с Google» on? A client ID AND a session secret: the state
 * cookie and the customer cookie are both signed with SESSION_SECRET, so
 * without one the button could only ever lead to an error page.
 */
export function googleSignInOn(): boolean {
  return googleClientId() !== null && sessionSecretOk();
}

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
/** Google signs with either spelling of its issuer (its OpenID discovery document says so). */
export const GOOGLE_ISSUERS: readonly string[] = ["accounts.google.com", "https://accounts.google.com"];
/** The only origin allowed to POST the callback — the account chooser's own page. */
export const GOOGLE_ORIGIN = "https://accounts.google.com";
/** How far apart two clocks may be before a token counts as expired or not yet issued. */
export const CLOCK_SKEW_S = 60;

/** The callback's path — the redirect URI registered in the console is the origin plus this. */
export const CALLBACK_PATH = "/api/account/google/callback";

/** `https://rempireshop.com` + CALLBACK_PATH, from the request's own origin (a preview deploy is its own). */
export function callbackUrl(origin: string): string {
  return String(origin).replace(/\/+$/, "") + CALLBACK_PATH;
}

/* ---------- where the shopper goes back to --------------------------------- */

/** Where a sign-in with no usable return path lands: the account screen (the edge picks its language). */
export const DEFAULT_RETURN = "/account";

/**
 * A return path the shop will redirect to, or null. Only a path inside the
 * shop: it starts with ONE "/", has no scheme, no host, no backslash (browsers
 * read `/\evil.com` as `//evil.com`), no whitespace or control character, and
 * does not lead back into the API. The fragment is dropped — the redirect
 * adds a query of its own (withGoogleFlag). This is the whole defence against
 * an open redirect, so it refuses anything it is not sure of.
 */
export function safeReturnPath(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.split("#")[0];
  if (!s || s.length > 512) return null;
  if (s[0] !== "/" || s[1] === "/" || s[1] === "\\") return null;
  if (/[\\\s\p{Cc}]/u.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s, "https://shop.invalid");
  } catch {
    return null;
  }
  if (u.origin !== "https://shop.invalid") return null;
  if (u.pathname === "/api" || u.pathname.startsWith("/api/")) return null;
  return s;
}

/**
 * The shop language a return path is in — `/ru/…` Russian, `/et/…` Estonian,
 * anything else English (unprefixed since 08.10.2026, src/lib/shop-paths.mjs).
 * It is what the code login sends as `lang` (the shop the shopper is looking
 * at), so recordLogin() files the same language whichever door was used.
 */
export function langOfReturn(path: string): "RU" | "ET" | "EN" {
  const m = /^\/(ru|et)(?:[/?]|$)/i.exec(String(path));
  return m ? (m[1].toUpperCase() as "RU" | "ET") : "EN";
}

/** The return path with `google=<flag>` in its query, replacing any `google=` it had. */
export function withGoogleFlag(path: string, flag: "ok" | "cancel"): string {
  const safe = safeReturnPath(path) ?? DEFAULT_RETURN;
  const q = safe.indexOf("?");
  const base = q < 0 ? safe : safe.slice(0, q);
  const params = new URLSearchParams(q < 0 ? "" : safe.slice(q + 1));
  params.delete("google");
  params.set("google", flag);
  return `${base}?${params.toString()}`;
}

/* ---------- the state cookie ---------------------------------------------- */

export const STATE_COOKIE = "rmp_gauth";
/** Scoped to the two Google routes — the cookie is never sent anywhere else. */
export const STATE_PATH = "/api/account/google";
export const STATE_TTL_MS = 10 * 60 * 1000;

/** What the start route leaves for the callback. */
export interface GooglePending {
  state: string;
  nonce: string;
  /** A path safeReturnPath() accepted. */
  ret: string;
}

function secret(): string | null {
  return sessionSecretOk() ? String(process.env.SESSION_SECRET) : null;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** 128 random bits, URL-safe — a state or a nonce. */
export function randomToken(): string {
  return randomBytes(16).toString("base64url");
}

/** Equal strings in constant time; a length difference is simply false. */
export function sameString(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * `v1.<expiry>.<base64url(json)>.<hmac>` — signed with SESSION_SECRET under
 * its own prefix ("gauth.v1."), so neither the admin cookie nor the customer
 * cookie can be replayed as this one, or this one as them.
 */
export function makeStateToken(p: GooglePending, now: number = Date.now()): string {
  const key = secret();
  if (!key) throw new Error("SESSION_SECRET is not set (needs at least 16 characters) — see docs/backend.md");
  const expiry = now + STATE_TTL_MS;
  const body = Buffer.from(JSON.stringify({ s: p.state, n: p.nonce, r: p.ret }), "utf8").toString("base64url");
  return `v1.${expiry}.${body}.${sign(`gauth.v1.${expiry}.${body}`, key)}`;
}

/** What a valid, unexpired state token carries, or null. Never throws. */
export function readStateToken(token: string | null | undefined, now: number = Date.now()): GooglePending | null {
  const key = secret();
  if (!key || !token) return null;
  const parts = String(token).split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const expiry = Number(parts[1]);
  if (!Number.isFinite(expiry) || expiry <= now) return null;
  if (!sameString(sign(`gauth.v1.${parts[1]}.${parts[2]}`, key), parts[3])) return null;
  try {
    const j = JSON.parse(Buffer.from(parts[2], "base64url").toString("utf8")) as Record<string, unknown>;
    const ret = safeReturnPath(j.r);
    if (typeof j.s !== "string" || typeof j.n !== "string" || !j.s || !j.n || !ret) return null;
    return { state: j.s, nonce: j.n, ret };
  } catch {
    return null;
  }
}

/** The pending sign-in the request's own cookie carries, or null. */
export function pendingOf(req: Request, now: number = Date.now()): GooglePending | null {
  return readStateToken(readCookie(req, STATE_COOKIE), now);
}

/** HttpOnly; Secure; SameSite=None — see "why the state cookie is SameSite=None" above. */
export function stateCookie(token: string): string {
  return `${STATE_COOKIE}=${token}; Path=${STATE_PATH}; HttpOnly; Secure; SameSite=None; Max-Age=${Math.round(STATE_TTL_MS / 1000)}`;
}

export function clearStateCookie(): string {
  return `${STATE_COOKIE}=; Path=${STATE_PATH}; HttpOnly; Secure; SameSite=None; Max-Age=0`;
}

/** Google's account chooser, asked for an ID token posted back to the callback. */
export function authorizeUrl(o: { clientId: string; redirectUri: string; state: string; nonce: string }): string {
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set("client_id", o.clientId);
  u.searchParams.set("redirect_uri", o.redirectUri);
  u.searchParams.set("response_type", "id_token");
  u.searchParams.set("response_mode", "form_post");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", o.state);
  u.searchParams.set("nonce", o.nonce);
  u.searchParams.set("prompt", "select_account");
  return u.toString();
}

/* ---------- Google's keys ------------------------------------------------- */

interface Jwk {
  kid?: unknown;
  kty?: unknown;
  n?: unknown;
  e?: unknown;
  alg?: unknown;
  use?: unknown;
}

/** One answer from the keys endpoint: the keys, and how long its Cache-Control says to keep them. */
export interface JwksAnswer {
  keys: unknown[];
  maxAgeS: number | null;
}
export type JwksFetcher = () => Promise<JwksAnswer>;

/** The real keys endpoint. Throws on a network error or a non-200. */
export async function fetchGoogleJwks(): Promise<JwksAnswer> {
  const res = await fetch(GOOGLE_JWKS_URL, { cache: "no-store", signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`Google keys answered ${res.status}`);
  const body = (await res.json()) as { keys?: unknown };
  const m = /max-age=(\d+)/i.exec(res.headers.get("cache-control") ?? "");
  return { keys: Array.isArray(body?.keys) ? body.keys : [], maxAgeS: m ? Number(m[1]) : null };
}

/** How long a set of keys is kept when the answer did not say (or said something absurd). */
const DEFAULT_KEYS_S = 3600;
const MAX_KEYS_S = 24 * 3600;
const MIN_KEYS_S = 60;

export interface JwksCache {
  /** The public key for `kid`, or null when Google does not publish one. Throws when the keys cannot be fetched. */
  key(kid: string, now?: number): Promise<KeyObject | null>;
}

/**
 * Keys in memory by `kid`. Fetched on first use and when they expire (by the
 * endpoint's own max-age, an hour if it gives none), and once more when a
 * token names a kid the set does not have — that is how a key rotation is
 * picked up. `minRefetchMs` keeps a run of tokens with made-up kids from
 * turning into a run of fetches; Google publishes a new key well before it
 * signs with it, so a genuine unknown kid right after a fetch does not occur.
 * Concurrent misses share one fetch. Verifying a token is then one RSA check —
 * the CPU this costs is a rounding error.
 */
export function createJwksCache(fetcher: JwksFetcher, opts: { minRefetchMs?: number } = {}): JwksCache {
  const minRefetchMs = opts.minRefetchMs ?? 30_000;
  let keys = new Map<string, KeyObject>();
  let until = 0;
  let fetchedAt = -Infinity;
  let inflight: Promise<void> | null = null;

  function refresh(now: number): Promise<void> {
    if (!inflight) {
      inflight = (async () => {
        const got = await fetcher();
        const next = new Map<string, KeyObject>();
        for (const raw of got.keys) {
          const k = raw as Jwk;
          if (!k || k.kty !== "RSA" || typeof k.kid !== "string" || typeof k.n !== "string" || typeof k.e !== "string") continue;
          if (k.use !== undefined && k.use !== "sig") continue;
          if (k.alg !== undefined && k.alg !== "RS256") continue;
          try {
            next.set(k.kid, createPublicKey({ key: { kty: "RSA", n: k.n, e: k.e }, format: "jwk" }));
          } catch {
            /* a key node:crypto cannot read is a key nothing can be verified with */
          }
        }
        const ttl = Math.min(Math.max(got.maxAgeS ?? DEFAULT_KEYS_S, MIN_KEYS_S), MAX_KEYS_S);
        keys = next;
        fetchedAt = now;
        until = now + ttl * 1000;
      })().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  }

  return {
    async key(kid: string, now: number = Date.now()): Promise<KeyObject | null> {
      if (now >= until) await refresh(now);
      else if (!keys.has(kid) && now - fetchedAt >= minRefetchMs) await refresh(now);
      return keys.get(kid) ?? null;
    },
  };
}

/** The process's own cache — one per serverless instance, gone on a cold start, which is fine. */
export const googleKeys: JwksCache = createJwksCache(fetchGoogleJwks);

/* ---------- the ID token -------------------------------------------------- */

export type IdTokenError =
  | "malformed"
  | "bad_alg"
  | "keys_unavailable"
  | "unknown_kid"
  | "bad_signature"
  | "bad_iss"
  | "bad_aud"
  | "expired"
  | "not_yet_valid"
  | "bad_nonce"
  | "email_unverified"
  | "bad_email";

/** What the shop takes from Google: the address (lower-cased) and a name for an empty profile. */
export interface GoogleIdentity {
  email: string;
  name: string;
}

export type IdTokenVerdict = { ok: true; identity: GoogleIdentity } | { ok: false; error: IdTokenError };

const B64URL = /^[A-Za-z0-9_-]+$/;

function part(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function nameOf(c: Record<string, unknown>): string {
  const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim() : "");
  const full = clean(c.name) || [clean(c.given_name), clean(c.family_name)].filter(Boolean).join(" ");
  return full.slice(0, 120).trim();
}

/**
 * Verifies a Google ID token the way Google's own guide says to: an RS256
 * signature by one of the published keys, `iss` one of the two spellings,
 * `aud` our client ID, `exp`/`iat` within CLOCK_SKEW_S, the `nonce` the
 * start route made — and, for this shop, `email_verified === true`, because
 * the address IS the account: an unverified one would hand somebody else's
 * orders to whoever typed it. Never throws; a refusal names its reason (for
 * the log — the shopper reads the same «отменён» either way).
 */
export async function verifyIdToken(
  token: unknown,
  o: { clientId: string; nonce: string; keys?: JwksCache; now?: number },
): Promise<IdTokenVerdict> {
  const now = o.now ?? Date.now();
  const keys = o.keys ?? googleKeys;
  if (typeof token !== "string" || token.length > 8192) return { ok: false, error: "malformed" };
  const bits = token.split(".");
  if (bits.length !== 3 || !bits.every((b) => B64URL.test(b))) return { ok: false, error: "malformed" };
  const header = part(bits[0]);
  const claims = part(bits[1]);
  if (!header || !claims) return { ok: false, error: "malformed" };
  if (header.alg !== "RS256") return { ok: false, error: "bad_alg" };
  if (typeof header.kid !== "string" || !header.kid) return { ok: false, error: "unknown_kid" };

  let key: KeyObject | null;
  try {
    key = await keys.key(header.kid, now);
  } catch (err) {
    console.error("[google-signin] keys unavailable:", err);
    return { ok: false, error: "keys_unavailable" };
  }
  if (!key) return { ok: false, error: "unknown_kid" };
  let signed = false;
  try {
    signed = verify("RSA-SHA256", Buffer.from(`${bits[0]}.${bits[1]}`), key, Buffer.from(bits[2], "base64url"));
  } catch {
    signed = false;
  }
  if (!signed) return { ok: false, error: "bad_signature" };

  if (typeof claims.iss !== "string" || !GOOGLE_ISSUERS.includes(claims.iss)) return { ok: false, error: "bad_iss" };
  const aud = claims.aud;
  const audOk =
    aud === o.clientId ||
    (Array.isArray(aud) && aud.includes(o.clientId) && (aud.length === 1 || claims.azp === o.clientId));
  if (!audOk) return { ok: false, error: "bad_aud" };
  const nowS = now / 1000;
  if (typeof claims.exp !== "number" || nowS > claims.exp + CLOCK_SKEW_S) return { ok: false, error: "expired" };
  if (typeof claims.iat !== "number" || claims.iat > nowS + CLOCK_SKEW_S) return { ok: false, error: "not_yet_valid" };
  if (!sameString(claims.nonce, o.nonce)) return { ok: false, error: "bad_nonce" };
  if (claims.email_verified !== true) return { ok: false, error: "email_unverified" };
  if (!isEmail(claims.email)) return { ok: false, error: "bad_email" };

  return { ok: true, identity: { email: normalizeEmail(claims.email), name: nameOf(claims) } };
}
