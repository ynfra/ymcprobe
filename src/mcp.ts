// Direct streamable-HTTP MCP client.
//
// ymcprobe talks to the target server itself, not only through opencode, so
// the tool inventory is real inspector data: it shows what the server
// advertises even when the model never decides to call anything.

export type McpTool = {
  name: string
  description?: string
  inputSchema?: unknown
}

const PROTOCOL_VERSION = "2025-06-18"

async function rpc(
  url: string,
  headers: Record<string, string>,
  sessionID: string | undefined,
  body: unknown,
): Promise<{ json: any; sessionID?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessionID ? { "mcp-session-id": sessionID } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`)

  const nextSession = res.headers.get("mcp-session-id") ?? sessionID
  if (res.status === 202) return { json: null, sessionID: nextSession }

  const text = await res.text()
  // A server may answer a single request as one SSE frame instead of JSON.
  const payload = text.startsWith("event:") || text.startsWith("data:")
    ? text.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim() ?? "{}"
    : text

  return { json: JSON.parse(payload), sessionID: nextSession }
}

/** Handshake + tools/list. Throws with the transport error if unreachable. */
export async function listTools(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ serverInfo: { name?: string; version?: string }; tools: McpTool[] }> {
  const init = await rpc(url, headers, undefined, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "ymcprobe", version: "0.1.0" },
    },
  })
  if (init.json?.error) throw new Error(`initialize failed: ${init.json.error.message}`)

  const session = init.sessionID
  await rpc(url, headers, session, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  })

  const list = await rpc(url, headers, session, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  })
  if (list.json?.error) throw new Error(`tools/list failed: ${list.json.error.message}`)

  return {
    serverInfo: init.json?.result?.serverInfo ?? {},
    tools: list.json?.result?.tools ?? [],
  }
}
