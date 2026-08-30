#!/usr/bin/env bun
import { render } from "ink"
import { parse, type Options } from "./args.ts"
import { listTools } from "./mcp.ts"
import { BUILTIN_TOOLS, OpencodeClient, startServer, type ServerHandle } from "./opencode.ts"
import { list as listModels, ModelError, resolve } from "./models.ts"
import { systemPrompt } from "./prompt.ts"
import type { Server } from "./session.ts"
import { App } from "./ui.tsx"

function fail(message: string): never {
  console.error(`ymcprobe: ${message}`)
  process.exit(1)
}

const parsed = (() => {
  try {
    return parse(process.argv.slice(2))
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  }
})()

if ("help" in parsed) {
  console.log(parsed.help)
  process.exit(0)
}
const opts: Options = parsed

if (opts.listModels) {
  const probe = await startServer(opts.port).catch((err: Error) => fail(err.message))
  const providers = await new OpencodeClient(probe.url).providers()
  probe.proc.kill()
  console.log(listModels(providers))
  process.exit(0)
}

// Talk to each MCP server directly first. A dead URL should fail here, in
// milliseconds, rather than after paying for an opencode boot.
const inventories = await Promise.all(
  opts.servers.map(async (spec) => {
    try {
      const { tools } = await listTools(spec.url, opts.headers)
      return { ...spec, tools, reachable: true as const }
    } catch (err) {
      return {
        ...spec,
        tools: [],
        reachable: false as const,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }),
)

if (opts.json) {
  console.log(JSON.stringify(inventories, null, 2))
  process.exit(0)
}

const unreachable = inventories.filter((s) => !s.reachable)
if (unreachable.length === inventories.length) {
  fail(`no MCP server reachable\n${unreachable.map((s) => `  ${s.url}\n    ${s.error}`).join("\n")}`)
}
for (const server of unreachable) {
  console.error(`ymcprobe: warning: ${server.name} (${server.url}) is unreachable — ${server.error}`)
}

if (!process.stdin.isTTY && !opts.web) {
  fail("the TUI needs a terminal — use --json when piping, or --web")
}

const handle: ServerHandle = await startServer(opts.port).catch((err: Error) => fail(err.message))
const client = new OpencodeClient(handle.url)

const shutdown = () => { handle.proc.kill(); process.exit(0) }
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
process.on("exit", () => handle.proc.kill())

const providers = await client.providers()
const choice = (() => {
  try {
    return resolve(providers, opts.model)
  } catch (err) {
    if (err instanceof ModelError) fail(err.message)
    throw err
  }
})()

// Register every server, then read the status opencode itself sees — that is
// what the model will be working against, not our direct probe.
for (const spec of opts.servers) {
  await client.addMcp(spec.name, spec.url, opts.headers).catch(() => {})
}
const status = await client.mcpStatus()

const servers: Server[] = inventories.map((entry) => ({
  name: entry.name,
  url: entry.url,
  status: status[entry.name]?.status ?? (entry.reachable ? "unknown" : "failed"),
  error: status[entry.name]?.error ?? (entry.reachable ? undefined : entry.error),
  tools: entry.tools,
}))

const session = await client.createSession(`ymcprobe ${servers.map((s) => s.name).join(" ")}`)

// Built-in tools are muted by default so anything in the trace came from an
// MCP server under test. --all-tools puts them back.
const toolFilter: Record<string, boolean> = {}
if (!opts.allTools) for (const tool of BUILTIN_TOOLS) toolFilter[tool] = false

const system = opts.noSystem ? undefined : (opts.system ?? systemPrompt(servers))

if (opts.web) {
  const { serve } = await import("./web.ts")
  const url = await serve({
    client, sessionID: session.id, servers,
    providerID: choice.providerID, modelID: choice.modelID,
    toolcall: choice.toolcall, toolFilter, system,
    port: opts.port + 1,
  }).catch((err: Error) => fail(err.message))
  console.log(`ymcprobe: ${url}`)
} else {
  render(
    <App
      client={client}
      sessionID={session.id}
      servers={servers}
      providerID={choice.providerID}
      modelID={choice.modelID}
      toolcall={choice.toolcall}
      toolFilter={toolFilter}
      system={system}
    />,
  )
}
