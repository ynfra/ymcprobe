import { useEffect, useMemo, useReducer, useRef, useState } from "react"
import { Box, measureElement, Text, useApp, useInput, useStdout, type DOMElement } from "ink"
import { Input } from "./input.tsx"
import type { OpencodeClient } from "./opencode.ts"
import {
  addError, addUser, elapsed, initialState, reduce, toolKey,
  type Entry, type Server, type State, type Stats, type ToolState,
} from "./session.ts"

export type UiProps = {
  client: OpencodeClient
  sessionID: string
  servers: Server[]
  providerID: string
  modelID: string
  toolcall: boolean
  toolFilter: Record<string, boolean>
  system?: string
}

const SIDEBAR = 32
const CHROME = 8   // header, borders and the input row
const BOX = 4      // a bordered, x-padded box costs 4 columns of content

type Line = { text: string; color?: string; dim?: boolean }

const DOT: Record<string, string> = { pending: "◌", running: "◍", completed: "●", error: "✖" }
const COLOR: Record<string, string> = {
  pending: "gray", running: "yellow", completed: "green", error: "red",
}

function clip(value: unknown, limit: number): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? ""
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > limit ? flat.slice(0, limit - 1) + "…" : flat
}

function wrap(text: string, width: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split("\n")) {
    if (paragraph.length <= width) { out.push(paragraph); continue }
    let rest = paragraph
    while (rest.length > width) {
      const cut = rest.lastIndexOf(" ", width)
      const at = cut > width * 0.6 ? cut : width
      out.push(rest.slice(0, at))
      rest = rest.slice(at).trimStart()
    }
    out.push(rest)
  }
  return out
}

function formatCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

function formatMs(ms: number): string {
  if (ms <= 0) return "—"
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0"
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`
}

function toLines(entry: Entry, width: number): Line[] {
  switch (entry.kind) {
    case "user":
      return wrap(entry.text, width - 2).map((text, i) => ({
        text: (i === 0 ? "› " : "  ") + text, color: "cyan",
      }))
    case "assistant":
      return wrap(entry.text, width).map((text) => ({ text }))
    case "error":
      return wrap(entry.text, width - 2).map((text, i) => ({
        text: (i === 0 ? "! " : "  ") + text, color: "red",
      }))
    case "tool": {
      const { call } = entry
      const state = call.state as ToolState
      const ms = elapsed(state)
      const label = call.server ? `${call.server} · ${call.tool}` : `${call.tool} (built-in)`
      const head = `${DOT[state.status]} ${label}  ${state.status}${ms ? `  ${formatMs(ms)}` : ""}`

      const lines: Line[] = [{ text: head, color: COLOR[state.status] }]
      lines.push({ text: `  in  ${clip(state.input, width - 6)}`, dim: true })
      if (state.status === "completed") {
        lines.push({ text: `  out ${clip(state.output, width - 6)}`, dim: true })
      }
      if (state.status === "error") {
        lines.push({ text: `  err ${clip(state.error, width - 6)}`, color: "red" })
      }
      return lines
    }
  }
}

function ServerPanel({ server, stats }: { server: Server; stats: Stats }) {
  const ok = server.status === "connected"
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ok ? "gray" : "red"} paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color={ok ? undefined : "red"}>{server.name}</Text>
        <Text dimColor>{ok ? `${server.tools.length} tool${server.tools.length === 1 ? "" : "s"}` : server.status}</Text>
      </Box>
      {!ok && <Text color="red" wrap="truncate">{server.error ?? "not connected"}</Text>}
      {ok && server.tools.length === 0 && <Text dimColor>none advertised</Text>}
      {server.tools.map((tool) => {
        const stat = stats.perTool[toolKey(server.name, tool.name)]
        const calls = stat?.calls ?? 0
        const failed = (stat?.errors ?? 0) > 0
        return (
          <Box key={tool.name} justifyContent="space-between">
            <Text color={calls > 0 ? (failed ? "red" : "green") : undefined}>
              {calls > 0 ? (failed ? "✖ " : "● ") : "○ "}
              {tool.name.slice(0, SIDEBAR - 14)}
            </Text>
            <Text dimColor>{calls > 0 ? `${calls} ${formatMs(stat!.totalMs / calls)}` : "—"}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

function StatsPanel({ stats }: { stats: Stats }) {
  const total = Object.values(stats.perTool).reduce((a, t) => a + t.totalMs, 0)
  const avg = stats.calls > 0 ? total / stats.calls : 0
  const row = (label: string, value: React.ReactNode) => (
    <Box justifyContent="space-between">
      <Text dimColor>{label}</Text>{value}
    </Box>
  )
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>stats</Text>
      {row("turns", <Text>{stats.turns}</Text>)}
      {row("calls", (
        <Text>{stats.calls}{stats.errors > 0 && <Text color="red"> {stats.errors} err</Text>}</Text>
      ))}
      {row("avg call", <Text>{formatMs(avg)}</Text>)}
      {row("last turn", <Text>{formatMs(stats.turnMs)}</Text>)}
      {row("tokens", <Text>{formatCount(stats.tokensIn)}↑ {formatCount(stats.tokensOut)}↓</Text>)}
      {row("cost", <Text>{formatCost(stats.cost)}</Text>)}
    </Box>
  )
}

type Action =
  | { type: "event"; event: { type: string; properties: any }; servers: Server[] }
  | { type: "user"; text: string }
  | { type: "error"; text: string }

function appReducer(state: State, action: Action): State {
  switch (action.type) {
    case "event": return reduce(state, action.event, action.servers)
    case "user": return addUser(state, action.text)
    case "error": return addError(state, action.text)
  }
}

export function App(props: UiProps) {
  const { client, sessionID, servers } = props
  const { exit } = useApp()
  const { stdout } = useStdout()

  const [state, dispatch] = useReducer(appReducer, undefined, initialState)
  const [input, setInput] = useState("")
  const [size, setSize] = useState({
    columns: stdout?.columns ?? 100,
    rows: stdout?.rows ?? 30,
  })

  const bodyRef = useRef<DOMElement>(null)
  const [measured, setMeasured] = useState(0)

  useEffect(() => {
    if (!stdout) return
    const onResize = () => setSize({ columns: stdout.columns, rows: stdout.rows })
    stdout.on("resize", onResize)
    return () => { stdout.off("resize", onResize) }
  }, [stdout])

  useEffect(() => {
    if (!bodyRef.current) return
    const width = measureElement(bodyRef.current).width - BOX
    if (width > 0 && width !== measured) setMeasured(width)
  })

  useInput((_, key) => {
    if (key.escape && state.busy) void client.abort(sessionID)
  })

  useEffect(() => {
    const abort = new AbortController()
    void (async () => {
      try {
        for await (const evt of client.events(sessionID, abort.signal)) {
          if (evt.type === "permission.asked") {
            void client.replyPermission(evt.properties.id).catch(() => {})
            continue
          }
          dispatch({ type: "event", event: evt, servers })
        }
      } catch (err) {
        if (!abort.signal.aborted) dispatch({ type: "error", text: `event stream: ${String(err)}` })
      }
    })()
    return () => abort.abort()
  }, [client, sessionID, servers])

  async function submit(text: string) {
    const trimmed = text.trim()
    if (!trimmed || state.busy) return
    if (trimmed === "/quit" || trimmed === "/exit") { exit(); return }

    setInput("")
    dispatch({ type: "user", text: trimmed })
    try {
      await client.prompt(sessionID, trimmed, {
        providerID: props.providerID,
        modelID: props.modelID,
        tools: props.toolFilter,
        system: props.system,
      })
    } catch (err) {
      dispatch({ type: "error", text: String(err) })
    }
  }

  const bodyWidth = measured || Math.max(30, size.columns - SIDEBAR - BOX - 2)
  const bodyHeight = Math.max(6, size.rows - CHROME)

  const lines = useMemo(() => {
    const all = state.entries.flatMap((entry) => [...toLines(entry, bodyWidth), { text: " " }])
    return all.slice(-bodyHeight)
  }, [state.entries, bodyWidth, bodyHeight])

  const down = servers.filter((s) => s.status !== "connected")

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>ymcprobe </Text>
        <Text dimColor>{servers.length} server{servers.length === 1 ? "" : "s"} </Text>
        {down.length === 0
          ? <Text color="green">● all connected</Text>
          : <Text color="red">✖ {down.map((s) => s.name).join(", ")} down</Text>}
        <Text dimColor>  {props.providerID}/{props.modelID}</Text>
        {!props.toolcall && <Text color="yellow">  ! model cannot call tools</Text>}
      </Box>

      <Box>
        <Box
          ref={bodyRef}
          flexDirection="column"
          flexGrow={1}
          height={bodyHeight + 2}
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          justifyContent="flex-end"
        >
          {lines.length === 0 && <Text dimColor>ask it to use a tool…</Text>}
          {lines.map((line, i) => (
            <Text key={i} color={line.color} dimColor={line.dim}>{line.text}</Text>
          ))}
        </Box>

        <Box flexDirection="column" width={SIDEBAR} marginLeft={1}>
          {servers.map((server) => (
            <ServerPanel key={server.name} server={server} stats={state.stats} />
          ))}
          <StatsPanel stats={state.stats} />
        </Box>
      </Box>

      <Box>
        <Text color={state.busy ? "yellow" : "cyan"}>{state.busy ? "… " : "› "}</Text>
        <Input value={input} onChange={setInput} onSubmit={submit} disabled={state.busy} />
      </Box>
      <Text dimColor>
        {state.busy ? "esc interrupt" : "ctrl-u clear · ctrl-w rub out word · /quit exit"}
      </Text>
    </Box>
  )
}
