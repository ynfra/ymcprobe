// Browser front-end.
//
// ymcprobe has to be the origin: nothing in a page can spawn `opencode serve`,
// and a target MCP server almost never sends CORS headers. So this serves the
// UI and proxies both the prompt calls and the SSE stream.
//
// The transcript logic is NOT reimplemented here — src/session.ts is bundled
// for the browser so the web UI and the TUI fold events identically.

import { clientBundle } from "./bundle-client.ts" with { type: "macro" }
import type { OpencodeClient } from "./opencode.ts"
import type { Server } from "./session.ts"

export type WebContext = {
  client: OpencodeClient
  sessionID: string
  servers: Server[]
  providerID: string
  modelID: string
  toolcall: boolean
  toolFilter: Record<string, boolean>
  system?: string
  port?: number
}

const HTML = (script: string, css: string) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ymcprobe</title>
<style>${css}</style>
</head><body>
<header>
  <strong>ymcprobe</strong>
  <span id="servers"></span>
  <span id="model" class="dim"></span>
</header>
<main>
  <section id="transcript" aria-live="polite"></section>
  <aside id="side"></aside>
</main>
<form id="composer">
  <input id="input" autocomplete="off" placeholder="ask it to use a tool…" autofocus>
  <button id="send" type="submit">send</button>
  <button id="stop" type="button" hidden>stop</button>
</form>
<script type="module">${script}</script>
</body></html>`

const CSS = `
:root {
  --bg: #fbfbfa; --fg: #1c1b1a; --dim: #6b6a67; --line: #e2e0dc;
  --panel: #ffffff; --ok: #1a7f4b; --err: #b3261e; --warn: #8a6100;
  --accent: #2f5eea;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16161a; --fg: #e8e6e3; --dim: #918e89; --line: #2c2c33;
    --panel: #1d1d22; --ok: #4ec98a; --err: #ff8b80; --warn: #e0b355;
    --accent: #7ea2ff;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; height: 100vh; display: flex; flex-direction: column;
  background: var(--bg); color: var(--fg);
  font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
}
header {
  display: flex; gap: 12px; align-items: baseline;
  padding: 10px 14px; border-bottom: 1px solid var(--line);
}
.dim { color: var(--dim); }
main { flex: 1; display: flex; min-height: 0; }
#transcript {
  flex: 1; overflow-y: auto; padding: 14px; display: flex;
  flex-direction: column; gap: 14px;
}
#side {
  width: 300px; flex: none; overflow-y: auto; padding: 14px;
  border-left: 1px solid var(--line); display: flex;
  flex-direction: column; gap: 12px;
}
.panel {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: 8px; padding: 10px 12px;
}
.panel.down { border-color: var(--err); }
.panel h2 {
  margin: 0 0 6px; font-size: 13px; display: flex;
  justify-content: space-between; align-items: baseline; gap: 8px;
}
.row { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
.row .k { color: var(--dim); }
/* A long tool name must ellipsize, never wrap — wrapping desyncs the name
   from its count and the whole column stops being scannable. */
.row .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.row .num { flex: none; font-variant-numeric: tabular-nums; }
.tool.used { color: var(--ok); }
.tool.failed { color: var(--err); }
.tool.unused { color: var(--dim); }
.msg { white-space: pre-wrap; overflow-wrap: anywhere; }
.msg.user { color: var(--accent); }
.msg.error { color: var(--err); }
.call {
  border-left: 3px solid var(--line); padding-left: 10px;
  display: flex; flex-direction: column; gap: 2px;
}
.call.completed { border-color: var(--ok); }
.call.error { border-color: var(--err); }
.call.running, .call.pending { border-color: var(--warn); }
.call .head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.call .name { font-weight: 600; }
/* One chatty tool can otherwise push the whole trace off screen. */
.call pre {
  margin: 0; white-space: pre-wrap; overflow-wrap: anywhere;
  color: var(--dim); font-size: 13px;
  max-height: 11em; overflow: hidden; position: relative;
}
.call pre.clamped { cursor: pointer; }
.call pre.clamped::after {
  content: ""; position: absolute; inset: auto 0 0 0; height: 3em;
  background: linear-gradient(transparent, var(--panel));
}
.call pre.open { max-height: none; }
.call pre.open::after { content: none; }
.call .more {
  background: none; border: 0; padding: 2px 0; font-size: 12px;
  color: var(--accent); cursor: pointer; text-align: left;
}
.call pre.err { color: var(--err); }
.label { color: var(--dim); }
#composer {
  display: flex; gap: 8px; padding: 10px 14px;
  border-top: 1px solid var(--line);
}
#input {
  flex: 1; font: inherit; padding: 8px 10px; border-radius: 6px;
  border: 1px solid var(--line); background: var(--panel); color: var(--fg);
}
#input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
button {
  font: inherit; padding: 8px 14px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--line); background: var(--panel); color: var(--fg);
}
button[disabled] { opacity: .5; cursor: default; }
@media (max-width: 720px) {
  main { flex-direction: column; }
  #side { width: auto; border-left: 0; border-top: 1px solid var(--line); }
}
`

export async function serve(ctx: WebContext): Promise<string> {
  const script = clientBundle()
  const page = HTML(script, CSS)

  let server: ReturnType<typeof Bun.serve>
  try {
    server = Bun.serve({
    port: ctx.port ?? 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url)

      if (url.pathname === "/") {
        return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } })
      }

      if (url.pathname === "/api/bootstrap") {
        return Response.json({
          servers: ctx.servers,
          providerID: ctx.providerID,
          modelID: ctx.modelID,
          toolcall: ctx.toolcall,
        })
      }

      if (url.pathname === "/api/prompt" && req.method === "POST") {
        const { text } = (await req.json()) as { text: string }
        try {
          await ctx.client.prompt(ctx.sessionID, text, {
            providerID: ctx.providerID,
            modelID: ctx.modelID,
            tools: ctx.toolFilter,
            system: ctx.system,
          })
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 502 })
        }
      }

      if (url.pathname === "/api/abort" && req.method === "POST") {
        await ctx.client.abort(ctx.sessionID).catch(() => {})
        return Response.json({ ok: true })
      }

      if (url.pathname === "/api/events") {
        const abort = new AbortController()
        req.signal.addEventListener("abort", () => abort.abort())

        const stream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder()
            try {
              for await (const evt of ctx.client.events(ctx.sessionID, abort.signal)) {
                // Auto-approve here, not in the browser: a test harness must
                // never stall, and the page has no business holding that key.
                if (evt.type === "permission.asked") {
                  void ctx.client.replyPermission(evt.properties.id).catch(() => {})
                }
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`))
              }
            } catch {
              // Client went away or the upstream stream ended.
            } finally {
              try { controller.close() } catch { /* already closed */ }
            }
          },
          cancel() { abort.abort() },
        })

        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        })
      }

      return new Response("not found", { status: 404 })
    },
    })
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === "EADDRINUSE") {
      throw new Error(
        `port ${ctx.port} is already in use — another ymcprobe --web is probably ` +
        `still running. Pass a different --port, or stop the other one.`,
      )
    }
    throw err
  }

  return `http://127.0.0.1:${server.port}`
}
