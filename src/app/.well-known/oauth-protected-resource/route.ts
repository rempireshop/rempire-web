/**
 * GET /.well-known/oauth-protected-resource — RFC 9728: what /api/mcp is and
 * which authorization server signs Claude in to it. The 401 /api/mcp answers
 * points here (src/lib/mcp/oauth.ts, docs/claude-connector.md).
 */
import { protectedResourceMetadata, requestOrigin } from "@/lib/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return Response.json(protectedResourceMetadata(requestOrigin(req)), {
    headers: { "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
}
