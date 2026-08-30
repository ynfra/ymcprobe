#!/usr/bin/env bun
// End-to-end check with no UI: boot opencode, register every MCP server, send
// one prompt, and assert a tool call actually showed up on the event stream.
//
// This exists because the trace hangs on `message.part.updated`, and that
// event silently stopped being delivered in opencode 1.14.42-1.15.1. Run it
// after any opencode bump.
//
//   bun run fixture &
//   bun run smoke

import { BUILTIN_TOOLS, OpencodeClient, startServer } from "./opencode.ts"
import { listTools } from "./mcp.ts"
import { resolve } from "./models.ts"
import { systemPrompt } from "./prompt.ts"
import { initialState, reduce, type Server } from "./session.ts"

const URLS = (Bun.env.MCP_URLS ?? "http://127.0.0.1:8080/mcp").split(",")
const PROMPT = Bun.env.MCP_PROMPT ?? "Call the echo tool with the text 'smoke'. Nothing else."

const server = await startServer(4188)
const client = new OpencodeClient(server.url)
console.log(`opencode: ${server.url}`)

try {
  const servers: Server[] = []
  for (const [i, url] of URLS.entries()) {
    const name = `probe${i === 0 ? "" : i + 1}`
    const { tools } = await listTools(url.trim())
    const status = await client.addMcp(name, url.trim(), {})
    if (status[name]?.status !== "connected") throw new Error(`${name} did not connect`)
    console.log(`${name}: ${tools.length} tools — ${tools.map((t) => t.name).join(", ")}`)
    servers.push({ name, url: url.trim(), status: "connected", tools })
  }

  const { providerID, modelID } = resolve(await client.providers(), Bun.env.MCP_MODEL)
  console.log(`model: ${providerID}/${modelID}`)

  const session = await client.createSession("ymcprobe smoke")
  const abort = new AbortController()
  let state = initialState()

  const done = (async () => {
    for await (const evt of client.events(session.id, abort.signal)) {
      if (evt.type === "permission.asked") {
        void client.replyPermission(evt.properties.id).catch(() => {})
      }
      const before = state.settled.length
      state = reduce(state, evt, servers)
      if (state.settled.length > before) {
        const last = state.entries.filter((e) => e.kind === "tool").at(-1)
        if (last?.kind === "tool") {
          console.log(`  ${last.call.server ?? "builtin"}/${last.call.tool} ${last.call.state.status}` +
            `  ${JSON.stringify(last.call.state.input)}`)
        }
      }
      if (evt.type === "session.idle") return
    }
  })()

  const tools: Record<string, boolean> = {}
  for (const tool of BUILTIN_TOOLS) tools[tool] = false
  await client.prompt(session.id, PROMPT, {
    providerID, modelID, tools, system: systemPrompt(servers),
  })

  await Promise.race([
    done,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timed out after 90s")), 90_000)),
  ])
  abort.abort()

  if (state.stats.calls === 0) throw new Error("no completed tool calls on the event stream")
  console.log(`\nOK — ${state.stats.calls} call(s), ${state.stats.errors} error(s)`)
} finally {
  server.proc.kill()
}
