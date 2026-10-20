/**
 * GET /.well-known/oauth-authorization-server — RFC 8414: where Claude
 * registers, sends the owner to sign in, and trades a code for tokens
 * (src/lib/mcp/oauth.ts).
 */
import { authorizationServerMetadata, requestOrigin } from "@/lib/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return Response.json(authorizationServerMetadata(requestOrigin(req)), {
    headers: { "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
}
