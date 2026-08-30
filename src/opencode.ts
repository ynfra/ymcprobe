// Thin client for the headless opencode server.
//
// Deliberately plain fetch rather than @opencode-ai/sdk: every endpoint here
// was pinned against the server's own /doc (OpenAPI), and dropping the SDK
// keeps ymcprobe working across opencode versions that reshuffle the wrapper.

import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import type { Providers } from "./models.ts"

/** Built-in tools, from GET /experimental/tool/ids. Suppressed by default so
 *  the trace only shows what the MCP server contributed. */
export const BUILTIN_TOOLS = [
  "question", "bash", "read", "glob", "grep", "edit", "write",
  "task", "webfetch", "todowrite", "websearch", "skill", "apply_patch",
] as const

export type McpStatus = Record<string, { status: string; error?: string }>

export type ToolState =
  | { status: "pending"; input: Record<string, unknown>; raw: string }
  | { status: "running"; input: Record<string, unknown>; title?: string }
  | { status: "completed"; input: Record<string, unknown>; output: string; title?: string }
  | { status: "error"; input: Record<string, unknown>; error: string }

export type ToolPart = {
  type: "tool"
  id: string
  callID: string
  tool: string
  state: ToolState
}

export type TextPart = { type: "text"; id: string; text: string }

export type ServerHandle = { url: string; proc: ChildProcess }

/** Spawn `opencode serve` and wait for it to announce its URL on stdout.
 *  The port is read back rather than assumed — passing --port 0 does not
 *  actually allocate a random port, it falls back to 4096. */
export function startServer(port: number, timeoutMs = 30_000): Promise<ServerHandle> {
  const proc = spawn("opencode", ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    stdio: ["ignore", "pipe", "pipe"],
  })

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill()
      reject(new Error(`opencode serve did not start within ${timeoutMs}ms`))
    }, timeoutMs)

    let buf = ""
    proc.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString()
      const match = buf.match(/listening on (http:\/\/\S+)/)
      if (!match?.[1]) return
      clearTimeout(timer)
      resolve({ url: match[1].trim(), proc })
    })

    proc.on("error", (err) => {
      clearTimeout(timer)
      reject(new Error(`could not spawn opencode: ${err.message}`))
    })
    proc.on("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`opencode serve exited with code ${code}`))
    })
  })
}

export class OpencodeClient {
  constructor(private readonly base: string) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`)
    return (await res.json()) as T
  }

  /** Register an MCP server on the running instance. No restart needed. */
  addMcp(name: string, url: string, headers: Record<string, string>) {
    return this.req<McpStatus>("POST", "/mcp", {
      name,
      config: { type: "remote", url, enabled: true, oauth: false, headers },
    })
  }

  mcpStatus() {
    return this.req<McpStatus>("GET", "/mcp")
  }

  reconnect(name: string) {
    return this.req<unknown>("POST", `/mcp/${encodeURIComponent(name)}/connect`)
  }

  providers() {
    return this.req<Providers>("GET", "/config/providers")
  }

  createSession(title: string) {
    return this.req<{ id: string }>("POST", "/session", { title })
  }

  /** Fire and forget — the reply arrives over the event stream. */
  prompt(sessionID: string, text: string, opts: {
    providerID: string
    modelID: string
    tools: Record<string, boolean>
    system?: string
  }) {
    return this.req<unknown>("POST", `/session/${sessionID}/prompt_async`, {
      model: { providerID: opts.providerID, modelID: opts.modelID },
      tools: opts.tools,
      ...(opts.system ? { system: opts.system } : {}),
      parts: [{ type: "text", text }],
    })
  }

  abort(sessionID: string) {
    return this.req<unknown>("POST", `/session/${sessionID}/abort`)
  }

  /** A test harness must never stall on a permission prompt. */
  replyPermission(requestID: string, reply: "once" | "always" | "reject" = "always") {
    return this.req<unknown>("POST", `/permission/${requestID}/reply`, { reply })
  }

  /** SSE event stream, filtered to one session. */
  async *events(sessionID: string, signal: AbortSignal) {
    const res = await fetch(this.base + "/event", { signal })
    if (!res.body) throw new Error("event stream has no body")

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      buf += decoder.decode(value, { stream: true })

      // SSE frames are separated by a blank line; we only emit `data:` payloads.
      let sep: number
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, sep)
        buf = buf.slice(sep + 2)
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue
          try {
            const evt = JSON.parse(line.slice(5).trim())
            if (evt?.properties?.sessionID && evt.properties.sessionID !== sessionID) continue
            yield evt as { type: string; properties: any }
          } catch {
            // Half-written frame or a keepalive; skipping is correct.
          }
        }
      }
    }
  }
}
