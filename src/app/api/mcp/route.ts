/**
 * /api/mcp — the «Rempire» connector Renat adds in Claude (Customize →
 * Connectors → this address). docs/claude-connector.md is the whole story.
 *
 *   POST — JSON-RPC from Claude (src/lib/mcp/protocol.ts), answered as JSON;
 *          the tools are src/lib/mcp/tools.ts
 *   GET/DELETE — 405: no event stream and no session to end (stateless)
 *
 * Signed in or nothing: a call without a good access token is a 401 whose
 * WWW-Authenticate names the protected-resource metadata — the handshake
 * that makes Claude open the shop's sign-in page (src/app/oauth/authorize).
 * The token is good only for this origin and only until the admin password
 * changes (src/lib/mcp/oauth.ts).
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { bearerOk, requestOrigin, resourceMetadataUrl } from "@/lib/mcp/oauth";
import { handleMessage, RPC, type JsonRpcResponse } from "@/lib/mcp/protocol";
import { INSTRUCTIONS, runTool, TOOLS } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INFO = { name: "rempire", title: "Rempire", version: "1.0.0", instructions: INSTRUCTIONS };
const MAX_BYTES = 256_000;

function unauthorized(req: Request): Response {
  const meta = resourceMetadataUrl(requestOrigin(req));
  const had = /^Bearer\s/i.test(req.headers.get("authorization") || "");
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: "sign in to the shop first" } },
    {
      status: 401,
      headers: {
        "www-authenticate": `Bearer resource_metadata="${meta}", scope="blog"${had ? ', error="invalid_token"' : ""}`,
        "cache-control": "no-store",
      },
    },
  );
}

export async function POST(req: Request): Promise<Response> {
  if (!bearerOk(req)) return unauthorized(req);
  if (rateLimit("mcp", clientIp(req), 240, 60_000)) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: RPC.INTERNAL, message: "too many requests" } }, { status: 429 });
  }
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BYTES) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: RPC.INVALID, message: "request too large" } }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: RPC.PARSE, message: "parse error" } }, { status: 400 });
  }
  const batch = Array.isArray(body);
  const messages = batch ? (body as unknown[]).slice(0, 20) : [body];
  const answers: JsonRpcResponse[] = [];
  for (const m of messages) {
    const a = await handleMessage(m, TOOLS, runTool, INFO);
    if (a) answers.push(a);
  }
  // notifications and responses only: accepted, nothing to say
  if (!answers.length) return new Response(null, { status: 202 });
  return Response.json(batch ? answers : answers[0], { headers: { "cache-control": "no-store" } });
}

const notAllowed = () => new Response(null, { status: 405, headers: { allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
