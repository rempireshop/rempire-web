/**
 * Signing in Renat's Claude to the shop — OAuth 2.1 the way Claude's custom
 * connectors ask for it (claude.com/docs/connectors/building/authentication):
 * protected-resource metadata behind a 401, authorization-server metadata,
 * Dynamic Client Registration, PKCE S256, a form-encoded token endpoint and
 * refresh tokens that rotate. The person signing in is the shop's admin, with
 * the admin password — the same one door the panel has, and its delay ladder
 * and its two journal lines (src/app/oauth/authorize/route.ts).
 *
 * Stateless, on purpose: a serverless function keeps nothing between calls,
 * and a new table would be a migration for one user. Every artefact — the
 * registered client, the code, the access and the refresh token — is a small
 * JSON payload signed with HMAC-SHA256 under a key derived from
 * SESSION_SECRET, the secret the admin cookie is already signed with. Two
 * things make that safe enough for what the tokens open (drafts, nothing
 * published, nothing about money or customers):
 *   · every code and token carries a fingerprint of ADMIN_PASSWORD_HASH, so
 *     changing the admin password signs Claude out — that is the revocation;
 *   · every one carries the origin it was issued for, so a token from a
 *     staging alias is not a token for rempireshop.com.
 * What statelessness gives up: a code is single-use only per instance (an
 * in-memory set), and a rotated refresh token stays valid until it expires.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const CODE_TTL_S = 300;
export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_S = 90 * 24 * 3600;
export const SCOPE = "blog";

/** Claude's hosted apps send the owner back here (claude.ai, Desktop, mobile); claude.com is the announced future spelling. */
export const CLAUDE_CALLBACKS = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"];

type Kind = "client" | "code" | "access" | "refresh";

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function key(): Buffer | null {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) return null;
  return createHmac("sha256", s).update("rempire-mcp-oauth-v1").digest();
}

/** A short fingerprint of the admin password's hash: a new password, every token void. */
export function passwordMark(): string {
  const h = process.env.ADMIN_PASSWORD_HASH || "";
  return h ? createHash("sha256").update(h).digest("base64url").slice(0, 16) : "";
}

export function sign(kind: Kind, payload: Record<string, unknown>, ttlS: number | null, now = Date.now()): string {
  const k = key();
  if (!k) throw new Error("SESSION_SECRET is not set");
  const body = b64u(JSON.stringify({ ...payload, k: kind, ...(ttlS ? { exp: Math.floor(now / 1000) + ttlS } : {}) }));
  return `${body}.${createHmac("sha256", k).update(body).digest("base64url")}`;
}

export function verify(kind: Kind, token: unknown, now = Date.now()): Record<string, unknown> | null {
  const k = key();
  if (!k || typeof token !== "string" || token.length > 4096) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || token.indexOf(".", dot + 1) >= 0) return null;
  const body = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1), "base64url");
  const want = createHmac("sha256", k).update(body).digest();
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null;
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!p || typeof p !== "object" || p.k !== kind) return null;
  if (typeof p.exp === "number" && p.exp * 1000 <= now) return null;
  return p;
}

/**
 * A redirect URI the shop will send a code to: Claude's own callback, or —
 * for Claude Code on the owner's computer — a loopback address on any port
 * (RFC 8252 §7.3; Claude Code declares both spellings).
 */
export function allowedRedirect(uri: unknown): boolean {
  if (typeof uri !== "string" || uri.length > 300) return false;
  if (CLAUDE_CALLBACKS.includes(uri)) return true;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1") && !u.username && !u.password;
}

/** RFC 7636 S256: BASE64URL(SHA256(verifier)) — the verifier 43–128 unreserved characters. */
export function pkceOk(verifier: unknown, challenge: unknown): boolean {
  if (typeof verifier !== "string" || typeof challenge !== "string") return false;
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const got = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const want = Buffer.from(challenge);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** The origin a request was made to — what the metadata, the resource and every token are about. */
export function requestOrigin(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") || h.get("host") || new URL(req.url).host;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = h.get("x-forwarded-proto") || (local ? "http" : "https");
  return `${proto}://${host}`;
}

export const mcpUrl = (origin: string) => `${origin}/api/mcp`;
export const resourceMetadataUrl = (origin: string) => `${origin}/.well-known/oauth-protected-resource`;

export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Rempire",
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE, "offline_access"],
  };
}

/** A short, stable key for a client_id — what a code remembers it by. */
export const clientKey = (clientId: string) => createHash("sha256").update(clientId).digest("base64url").slice(0, 22);

export type AuthRequest = { clientId: string; clientName: string; redirectUri: string; challenge: string; state: string; resource: string };

/**
 * An authorization request, checked before anything is shown or sent: a
 * client this shop registered, one of ITS redirect URIs (and an allowed one),
 * response_type code, a PKCE S256 challenge, and — when Claude names the
 * resource (RFC 8707) — this shop's MCP address. The reason it fails is in
 * Russian: the owner reads it on the page, it is never sent anywhere.
 */
export function checkAuthRequest(p: URLSearchParams, origin: string): AuthRequest | { error: string } {
  const clientId = p.get("client_id") || "";
  const client = verify("client", clientId);
  if (!client) return { error: "Неизвестное приложение — подключите коннектор в Claude заново." };
  const redirectUri = p.get("redirect_uri") || "";
  const registered = Array.isArray(client.ru) ? (client.ru as unknown[]) : [];
  if (!allowedRedirect(redirectUri) || !registered.includes(redirectUri)) return { error: "Адрес возврата не тот, что был зарегистрирован." };
  if (p.get("response_type") !== "code") return { error: "Неподдерживаемый запрос (response_type)." };
  const challenge = p.get("code_challenge") || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || p.get("code_challenge_method") !== "S256") return { error: "Нет защиты PKCE (S256)." };
  const resource = p.get("resource") || "";
  if (resource && resource !== mcpUrl(origin) && resource !== origin) return { error: "Запрос не к этому магазину." };
  return {
    clientId,
    clientName: typeof client.n === "string" ? client.n.slice(0, 80) : "Claude",
    redirectUri,
    challenge,
    state: (p.get("state") || "").slice(0, 500),
    resource: resource || mcpUrl(origin),
  };
}

/* A code is good once. Per instance only — see the header. */
const usedCodes = new Map<string, number>();
export function spendCode(code: string, now = Date.now()): boolean {
  for (const [c, at] of usedCodes) if (at < now - CODE_TTL_S * 1000) usedCodes.delete(c);
  if (usedCodes.has(code)) return false;
  usedCodes.set(code, now);
  return true;
}
/** Tests only. */
export function resetUsedCodes(): void {
  usedCodes.clear();
}

/** The access token a call to /api/mcp carries, checked: signed, unexpired, this origin, this admin password. */
export function bearerOk(req: Request, now = Date.now()): boolean {
  const auth = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!m) return false;
  const p = verify("access", m[1], now);
  return !!p && p.aud === requestOrigin(req) && p.pw === passwordMark() && !!p.pw;
}

/** The access and refresh pair the token endpoint answers with — no-store, as RFC 6749 §5.1 asks. */
export function tokenPair(origin: string, clientId: string, now = Date.now()) {
  const pw = passwordMark();
  return {
    access_token: sign("access", { aud: origin, pw, scope: SCOPE }, ACCESS_TTL_S, now),
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    refresh_token: sign("refresh", { aud: origin, pw, cid: clientId }, REFRESH_TTL_S, now),
    scope: SCOPE,
  };
}
