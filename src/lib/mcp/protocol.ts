/**
 * The Model Context Protocol, as much of it as Renat's Claude needs to talk
 * to the shop (the «Rempire» custom connector — docs/claude-connector.md).
 *
 * Streamable HTTP, stateless: every POST carries one JSON-RPC message (or,
 * from an older client, a batch), and every answer is plain JSON — no
 * session, no server-sent stream, nothing kept between two calls, which is
 * what a serverless function on Vercel can promise. Hand-written rather than
 * the SDK for the same reason src/lib/blog-html.mjs hand-writes its
 * markdown: five methods are the whole of it, and a dependency would be the
 * largest part of the code to audit.
 *
 *   initialize                → the version both sides speak, the tools capability, the instructions
 *   notifications/initialized → nothing (202)
 *   ping                      → {}
 *   tools/list                → the tools (src/lib/mcp/tools.ts)
 *   tools/call                → one tool's answer, as text content
 *
 * Pure: the route (src/app/api/mcp/route.ts) does the HTTP, the signing-in
 * and the database; this file turns one parsed body into one answer.
 */

export const MCP_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const MCP_VERSION_DEFAULT = "2025-06-18";

export type JsonRpcId = string | number | null;
export type JsonRpcRequest = { jsonrpc: "2.0"; id?: JsonRpcId; method: string; params?: Record<string, unknown> };
export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string } };

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};
export type ToolResult = { text: string; isError?: boolean };
export type ToolRunner = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;

export const RPC = { PARSE: -32700, INVALID: -32600, NO_METHOD: -32601, BAD_PARAMS: -32602, INTERNAL: -32603 } as const;

const err = (id: JsonRpcId, code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

function isRequest(m: unknown): m is JsonRpcRequest {
  return !!m && typeof m === "object" && !Array.isArray(m) && (m as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
    typeof (m as { method?: unknown }).method === "string";
}

export type ServerInfo = { name: string; title: string; version: string; instructions: string };

/**
 * One message in, one answer out — or null for a notification, which gets no
 * answer at all. A tool that throws is an error RESULT (`isError`), not a
 * protocol error: Claude reads the words and can tell the owner what went
 * wrong, where a JSON-RPC error would only say the call failed.
 */
export async function handleMessage(
  msg: unknown,
  tools: ToolDef[],
  run: ToolRunner,
  info: ServerInfo,
): Promise<JsonRpcResponse | null> {
  if (!isRequest(msg)) {
    const id = msg && typeof msg === "object" && "id" in msg ? ((msg as { id: JsonRpcId }).id ?? null) : null;
    return err(id, RPC.INVALID, "invalid request");
  }
  // a notification (no id) — or a response the client sent back — is taken and not answered
  if (msg.id === undefined) return null;
  const id = msg.id;
  const params = msg.params && typeof msg.params === "object" ? msg.params : {};
  switch (msg.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (MCP_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_VERSION_DEFAULT;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: info.name, title: info.title, version: info.version },
          instructions: info.instructions,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools } };
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (!tools.some((t) => t.name === name)) return err(id, RPC.BAD_PARAMS, `unknown tool: ${name}`);
      const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : {};
      let out: ToolResult;
      try {
        out = await run(name, args);
      } catch (e) {
        console.error("[mcp] tool failed", name, e);
        out = { text: "Не получилось — ошибка на стороне магазина. Попробуйте ещё раз чуть позже.", isError: true };
      }
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: out.text }], ...(out.isError ? { isError: true } : {}) },
      };
    }
    default:
      return err(id, RPC.NO_METHOD, `method not found: ${msg.method}`);
  }
}
