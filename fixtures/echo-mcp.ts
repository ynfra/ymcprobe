#!/usr/bin/env bun
// Minimal streamable-HTTP MCP server used to smoke-test ymcprobe itself.
// Four tools with deliberately distinct shapes, one per branch the trace has
// to render: a plain echo, one that takes numbers, one that always fails, and
// one that returns far more text than fits on screen.
//
//   bun run fixtures/echo-mcp.ts            # http://127.0.0.1:8080/mcp

const PORT = Number(Bun.env.PORT ?? 8080)

const TOOLS = [
  {
    name: "echo",
    description: "Echo back the given text.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Text to echo" } },
      required: ["text"],
    },
  },
  {
    name: "add",
    description: "Add two numbers and return the sum.",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
  {
    name: "boom",
    description: "Always fails. Use it to check error rendering.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "lorem",
    description: "Return a long block of filler text. Use it to check how the UI handles output that does not fit on screen.",
    inputSchema: {
      type: "object",
      properties: {
        paragraphs: { type: "number", description: "How many paragraphs (default 6)" },
      },
    },
  },
]

const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod " +
  "tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim " +
  "veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea " +
  "commodo consequat. Duis aute irure dolor in reprehenderit in voluptate " +
  "velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint " +
  "occaecat cupidatat non proident, sunt in culpa qui officia deserunt " +
  "mollit anim id est laborum."

function call(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "echo":
      return `echo: ${String(args["text"] ?? "")}`
    case "add":
      return String(Number(args["a"] ?? 0) + Number(args["b"] ?? 0))
    case "boom":
      throw new Error("boom: this tool always fails")
    case "lorem": {
      const count = Math.max(1, Math.min(20, Number(args["paragraphs"] ?? 6)))
      return Array.from({ length: count }, (_, i) => `${i + 1}. ${LOREM}`).join("\n\n")
    }
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}

function result(id: unknown, res: unknown) {
  return { jsonrpc: "2.0", id, result: res }
}

function handle(msg: any) {
  switch (msg.method) {
    case "initialize":
      return result(msg.id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "echo-mcp", version: "0.1.0" },
      })
    case "tools/list":
      return result(msg.id, { tools: TOOLS })
    case "tools/call":
      try {
        const text = call(msg.params?.name, msg.params?.arguments ?? {})
        return result(msg.id, { content: [{ type: "text", text }] })
      } catch (err) {
        return result(msg.id, {
          content: [{ type: "text", text: String(err) }],
          isError: true,
        })
      }
    case "ping":
      return result(msg.id, {})
    default:
      // Notifications carry no id and expect no response.
      if (msg.id === undefined) return null
      return {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `method not found: ${msg.method}` },
      }
  }
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname !== "/mcp") return new Response("not found", { status: 404 })

    // The spec lets a server refuse the optional server->client GET stream.
    if (req.method === "GET") return new Response("no sse stream", { status: 405 })
    if (req.method === "DELETE") return new Response(null, { status: 204 })
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 })

    const body = await req.json()
    const batch = Array.isArray(body) ? body : [body]
    const out = batch.map(handle).filter((r) => r !== null)

    console.log(batch.map((m: any) => m.method).join(", "))

    if (out.length === 0) return new Response(null, { status: 202 })
    return Response.json(Array.isArray(body) ? out : out[0], {
      headers: { "Mcp-Session-Id": "echo-mcp-session" },
    })
  },
})

console.log(`echo-mcp listening on http://127.0.0.1:${PORT}/mcp`)
