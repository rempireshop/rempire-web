/**
 * POST /oauth/register — RFC 7591 Dynamic Client Registration, the way
 * Claude introduces itself before the owner signs in.
 *
 * Nothing is stored: the client_id IS the registration, signed
 * (src/lib/mcp/oauth.ts) — the redirect URIs it may use ride inside it. Only
 * Claude's own callback and a loopback address are accepted, so a code can
 * only ever travel back to Claude, never to a page somebody else registered.
 * Public client: no secret, the token endpoint authenticates with PKCE.
 */
import { clientIp, rateLimit, sessionSecretOk } from "@/lib/auth";
import { allowedRedirect, sign } from "@/lib/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (error: string, description: string, status = 400) =>
  Response.json({ error, error_description: description }, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request): Promise<Response> {
  // the client_id is signed with the key SESSION_SECRET gives — a deployment without it signs nobody in
  if (!sessionSecretOk()) return fail("server_error", "sign-in is not configured on this server", 503);
  if (rateLimit("oauth-register", clientIp(req), 30, 3_600_000)) return fail("too_many_requests", "try again later", 429);
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 8000) return fail("invalid_client_metadata", "too large");
    body = JSON.parse(raw);
  } catch {
    return fail("invalid_client_metadata", "body is not JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("invalid_client_metadata", "body is not an object");
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length || uris.length > 5) return fail("invalid_redirect_uri", "one to five redirect_uris");
  if (!uris.every(allowedRedirect)) return fail("invalid_redirect_uri", "only Claude's callback or a loopback address");
  const auth = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "none";
  if (auth !== "none") return fail("invalid_client_metadata", "public clients only: token_endpoint_auth_method none");
  const name = typeof body.client_name === "string" ? body.client_name.slice(0, 80) : "Claude";
  const clientId = sign("client", { ru: uris, n: name }, null);
  return Response.json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}
