// Browser entry point. Bundled at serve() time so it can import the same
// reducer the TUI uses — the two front-ends must never drift.

import {
  addError, addUser, elapsed, initialState, reduce, toolKey,
  type Entry, type Server, type State, type Stats, type ToolState,
} from "./session.ts"

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const transcript = $<HTMLElement>("transcript")
const side = $<HTMLElement>("side")
const input = $<HTMLInputElement>("input")
const composer = $<HTMLFormElement>("composer")
const sendBtn = $<HTMLButtonElement>("send")
const stopBtn = $<HTMLButtonElement>("stop")

let servers: Server[] = []
let state: State = initialState()

const fmtMs = (ms: number) => (ms <= 0 ? "—" : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`)
const fmtCount = (n: number) =>
  n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k` : `${(n / 1e6).toFixed(1)}M`
const fmtCost = (c: number) => (c === 0 ? "$0" : c < 0.01 ? `$${c.toFixed(4)}` : `$${c.toFixed(2)}`)

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function row(key: string, value: string, valueClass?: string): HTMLElement {
  const node = el("div", "row")
  node.append(el("span", "k", key), el("span", valueClass, value))
  return node
}

/** Tool output can be tens of kilobytes; clamp it and let the reader expand.
 *  The open ids are kept outside the entry list so a re-render preserves them. */
const expanded = new Set<string>()
let clampSeq = 0

function clampable(text: string, extra?: string): HTMLElement {
  const id = `c${clampSeq++}`
  const pre = el("pre", extra)
  pre.textContent = text
  const wrap = el("div")
  wrap.append(pre)

  // Only offer the toggle once we know it actually overflows.
  queueMicrotask(() => {
    if (pre.scrollHeight <= pre.clientHeight + 2 && !expanded.has(id)) return
    const button = el("button", "more") as HTMLButtonElement
    const sync = () => {
      const open = expanded.has(id)
      pre.classList.toggle("open", open)
      pre.classList.toggle("clamped", !open)
      button.textContent = open ? "show less" : "show more"
    }
    button.addEventListener("click", () => {
      if (expanded.has(id)) expanded.delete(id)
      else expanded.add(id)
      sync()
    })
    wrap.append(button)
    sync()
  })

  return wrap
}

function renderEntry(entry: Entry): HTMLElement {
  if (entry.kind === "tool") {
    const { call } = entry
    const st = call.state as ToolState
    const node = el("div", `call ${st.status}`)

    const head = el("div", "head")
    head.append(
      el("span", "name", call.server ? `${call.server} · ${call.tool}` : `${call.tool} (built-in)`),
      el("span", "label", st.status),
    )
    const ms = elapsed(st)
    if (ms) head.append(el("span", "label", fmtMs(ms)))
    node.append(head)

    node.append(clampable(`in  ${JSON.stringify(st.input)}`))
    if (st.status === "completed") node.append(clampable(`out ${st.output}`))
    if (st.status === "error") node.append(clampable(`err ${st.error}`, "err"))
    return node
  }

  return el("div", `msg ${entry.kind}`, entry.kind === "user" ? `› ${entry.text}` : entry.text)
}

function renderSide() {
  side.replaceChildren()
  const { stats } = state

  for (const server of servers) {
    const ok = server.status === "connected"
    const panel = el("div", `panel${ok ? "" : " down"}`)
    const title = el("h2")
    title.append(el("span", undefined, server.name))
    title.append(el("span", "dim", ok ? `${server.tools.length} tool${server.tools.length === 1 ? "" : "s"}` : server.status))
    panel.append(title)

    if (!ok) panel.append(el("div", "msg error", server.error ?? "not connected"))
    if (ok && server.tools.length === 0) panel.append(el("div", "dim", "none advertised"))

    for (const tool of server.tools) {
      const stat = stats.perTool[toolKey(server.name, tool.name)]
      const calls = stat?.calls ?? 0
      const failed = (stat?.errors ?? 0) > 0
      const line = el("div", "row")
      const name = el("span", `name tool ${calls === 0 ? "unused" : failed ? "failed" : "used"}`,
        `${calls === 0 ? "○" : failed ? "✖" : "●"} ${tool.name}`)
      name.title = tool.description ?? tool.name
      line.append(name, el("span", "k num", calls > 0 ? `${calls} ${fmtMs(stat!.totalMs / calls)}` : "—"))
      panel.append(line)
    }
    side.append(panel)
  }

  const total = Object.values(stats.perTool).reduce((a, t) => a + t.totalMs, 0)
  const panel = el("div", "panel")
  panel.append(el("h2", undefined, "stats"))
  panel.append(row("turns", String(stats.turns)))
  panel.append(row("calls", stats.errors > 0 ? `${stats.calls}  ${stats.errors} err` : String(stats.calls),
    stats.errors > 0 ? "tool failed" : undefined))
  panel.append(row("avg call", fmtMs(stats.calls > 0 ? total / stats.calls : 0)))
  panel.append(row("last turn", fmtMs(stats.turnMs)))
  panel.append(row("tokens", `${fmtCount(stats.tokensIn)}↑ ${fmtCount(stats.tokensOut)}↓`))
  panel.append(row("cost", fmtCost(stats.cost)))
  side.append(panel)
}

function render() {
  const atBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 40
  transcript.replaceChildren(...state.entries.map(renderEntry))
  if (atBottom) transcript.scrollTop = transcript.scrollHeight

  sendBtn.disabled = state.busy
  input.disabled = state.busy
  stopBtn.hidden = !state.busy
  renderSide()
}

composer.addEventListener("submit", async (event) => {
  event.preventDefault()
  const text = input.value.trim()
  if (!text || state.busy) return

  input.value = ""
  state = addUser(state, text)
  render()

  const res = await fetch("/api/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  }).catch((err) => ({ ok: false, json: async () => ({ error: String(err) }) }) as Response)

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "prompt failed" }))
    state = addError(state, String((body as { error?: string }).error ?? "prompt failed"))
    render()
  }
  input.focus()
})

stopBtn.addEventListener("click", () => { void fetch("/api/abort", { method: "POST" }) })

async function main() {
  const boot = await (await fetch("/api/bootstrap")).json()
  servers = boot.servers

  const down = servers.filter((s: Server) => s.status !== "connected")
  const label = $<HTMLElement>("servers")
  label.textContent = down.length === 0
    ? `● ${servers.length} server${servers.length === 1 ? "" : "s"} connected`
    : `✖ ${down.map((s: Server) => s.name).join(", ")} down`
  label.style.color = down.length === 0 ? "var(--ok)" : "var(--err)"

  $<HTMLElement>("model").textContent =
    `${boot.providerID}/${boot.modelID}${boot.toolcall ? "" : "  ! model cannot call tools"}`

  render()

  const events = new EventSource("/api/events")
  events.onmessage = (event) => {
    state = reduce(state, JSON.parse(event.data), servers)
    render()
  }
  events.onerror = () => {
    state = addError(state, "event stream disconnected — is ymcprobe still running?")
    render()
    events.close()
  }
}

void main()
