/* The path-suffixed spelling of the same document (RFC 9728 §3.1) — what a
   client probes when a 401 carries no resource_metadata pointer. */
import { protectedResourceMetadata, requestOrigin } from "@/lib/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return Response.json(protectedResourceMetadata(requestOrigin(req)), {
    headers: { "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
}
