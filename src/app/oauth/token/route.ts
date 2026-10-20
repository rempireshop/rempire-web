/**
 * POST /oauth/token — a code for tokens, and a refresh token for new ones
 * (RFC 6749 §4.1.3, §6; form-encoded, as Claude sends it).
 *
 * authorization_code: the code is this shop's, unexpired, unspent, for this
 *   client and this redirect URI, its PKCE verifier matches the challenge,
 *   and the admin password has not changed since it was issued.
 * refresh_token: the same three — signed, this origin, this password — and
 *   a new pair back, the refresh token rotated (src/lib/mcp/oauth.ts).
 * Every refusal is an RFC 6749 code: invalid_grant for a code or refresh
 * token that is no good, which is what makes Claude ask the owner to sign in
 * again rather than retry.
 */
import { clientIp, rateLimit, sessionSecretOk } from "@/lib/auth";
import { clientKey, passwordMark, pkceOk, requestOrigin, spendCode, tokenPair, verify } from "@/lib/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers: NO_STORE });

async function readForm(req: Request): Promise<URLSearchParams | null> {
  const raw = await req.text().catch(() => null);
  if (raw == null || raw.length > 8000) return null;
  const type = req.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      return new URLSearchParams(Object.entries(o).filter(([, v]) => typeof v === "string") as Array<[string, string]>);
    } catch {
      return null;
    }
  }
  return new URLSearchParams(raw);
}

export async function POST(req: Request): Promise<Response> {
  if (!sessionSecretOk()) return fail("server_error", 503);
  if (rateLimit("oauth-token", clientIp(req), 60, 15 * 60_000)) return fail("slow_down", 429);
  const f = await readForm(req);
  if (!f) return fail("invalid_request");
  const origin = requestOrigin(req);
  const pw = passwordMark();
  if (!pw) return fail("server_error", 500);
  const clientId = f.get("client_id") || "";
  if (!verify("client", clientId)) return fail("invalid_client", 401);

  if (f.get("grant_type") === "authorization_code") {
    const code = f.get("code") || "";
    const c = verify("code", code);
    if (!c || c.aud !== origin || c.pw !== pw || c.cid !== clientKey(clientId) || c.ru !== f.get("redirect_uri")) return fail("invalid_grant");
    if (!pkceOk(f.get("code_verifier"), c.ch)) return fail("invalid_grant");
    if (!spendCode(code)) return fail("invalid_grant");
    return Response.json(tokenPair(origin, clientKey(clientId)), { headers: NO_STORE });
  }

  if (f.get("grant_type") === "refresh_token") {
    const r = verify("refresh", f.get("refresh_token"));
    if (!r || r.aud !== origin || r.pw !== pw || r.cid !== clientKey(clientId)) return fail("invalid_grant");
    return Response.json(tokenPair(origin, clientKey(clientId)), { headers: NO_STORE });
  }

  return fail("unsupported_grant_type");
}
