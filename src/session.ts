// The transcript + stats state machine, shared by the TUI and the web UI.
//
// Pure on purpose: it takes opencode events in and returns new state, so both
// front-ends render the same trace and neither owns the logic.

import type { McpTool } from "./mcp.ts"

export type Server = {
  name: string
  url: string
  status: string
  error?: string
  tools: McpTool[]
}

export type ToolState =
  | { status: "pending"; input: Record<string, unknown>; time?: { start: number } }
  | { status: "running"; input: Record<string, unknown>; time?: { start: number } }
  | { status: "completed"; input: Record<string, unknown>; output: string; time?: { start: number; end: number } }
  | { status: "error"; input: Record<string, unknown>; error: string; time?: { start: number; end: number } }

export type Call = {
  /** Server the tool came from, or undefined for an opencode built-in. */
  server?: string
  tool: string
  state: ToolState
}

export type Entry =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; call: Call }
  | { kind: "error"; id: string; text: string }

export type ToolStat = { calls: number; errors: number; totalMs: number }

export type Stats = {
  turns: number
  calls: number
  errors: number
  tokensIn: number
  tokensOut: number
  cost: number
  /** Keyed `server/tool`, or just `tool` for built-ins. */
  perTool: Record<string, ToolStat>
  turnMs: number
}

export type State = {
  entries: Entry[]
  stats: Stats
  busy: boolean
  /** callIDs already folded into stats, so a re-render cannot double-count. */
  settled: string[]
  roles: Record<string, string>
  turnStart: number
}

export const toolKey = (server: string | undefined, tool: string) =>
  server ? `${server}/${tool}` : tool

export const emptyStats = (): Stats => ({
  turns: 0, calls: 0, errors: 0, tokensIn: 0, tokensOut: 0, cost: 0,
  perTool: {}, turnMs: 0,
})

export const initialState = (): State => ({
  entries: [], stats: emptyStats(), busy: false,
  settled: [], roles: {}, turnStart: 0,
})

export function elapsed(state: ToolState): number {
  const time = state.time
  // start can legitimately be 0, so test for undefined rather than falsiness.
  if (time?.start === undefined || (time as { end?: number }).end === undefined) return 0
  return (time as { end: number }).end - time.start
}

/** opencode namespaces MCP tools as `<server>_<tool>`. */
export function splitTool(qualified: string, servers: Server[]): { server?: string; tool: string } {
  for (const server of servers) {
    const prefix = server.name + "_"
    if (qualified.startsWith(prefix)) {
      return { server: server.name, tool: qualified.slice(prefix.length) }
    }
  }
  return { tool: qualified }
}

function upsert(entries: Entry[], entry: Entry): Entry[] {
  const at = entries.findIndex((e) => e.kind === entry.kind && e.id === entry.id)
  if (at === -1) return [...entries, entry]
  const copy = [...entries]
  copy[at] = entry
  return copy
}

export function addUser(state: State, text: string): State {
  return {
    ...state,
    entries: [...state.entries, { kind: "user", id: crypto.randomUUID(), text }],
    stats: { ...state.stats, turns: state.stats.turns + 1 },
    busy: true,
    turnStart: Date.now(),
  }
}

export function addError(state: State, text: string): State {
  return {
    ...state,
    entries: [...state.entries, { kind: "error", id: crypto.randomUUID(), text }],
    busy: false,
  }
}

/** Fold one opencode event into the state. Unknown events are a no-op. */
export function reduce(state: State, evt: { type: string; properties: any }, servers: Server[]): State {
  switch (evt.type) {
    case "message.updated": {
      const info = evt.properties?.info
      if (!info?.id || !info?.role) return state
      const roles = { ...state.roles, [info.id]: info.role }
      if (info.role !== "assistant" || !info.time?.completed) return { ...state, roles }
      return {
        ...state,
        roles,
        stats: {
          ...state.stats,
          tokensIn: state.stats.tokensIn + (info.tokens?.input ?? 0),
          tokensOut: state.stats.tokensOut + (info.tokens?.output ?? 0),
          cost: state.stats.cost + (info.cost ?? 0),
        },
      }
    }

    case "session.idle": {
      const turnMs = state.turnStart > 0 ? Date.now() - state.turnStart : state.stats.turnMs
      return { ...state, busy: false, stats: { ...state.stats, turnMs } }
    }

    case "session.error":
      return addError(state, String(evt.properties?.error?.message ?? evt.properties?.error ?? "unknown error"))

    case "message.part.updated": {
      const part = evt.properties?.part
      if (!part) return state

      if (part.type === "tool") {
        const { server, tool } = splitTool(part.tool, servers)
        const call: Call = { server, tool, state: part.state }
        let next: State = { ...state, entries: upsert(state.entries, { kind: "tool", id: part.id, call }) }

        const done = part.state.status === "completed" || part.state.status === "error"
        if (done && !state.settled.includes(part.callID)) {
          const key = toolKey(server, tool)
          const prev = state.stats.perTool[key] ?? { calls: 0, errors: 0, totalMs: 0 }
          const failed = part.state.status === "error"
          next = {
            ...next,
            settled: [...state.settled, part.callID],
            stats: {
              ...next.stats,
              calls: next.stats.calls + 1,
              errors: next.stats.errors + (failed ? 1 : 0),
              perTool: {
                ...next.stats.perTool,
                [key]: {
                  calls: prev.calls + 1,
                  errors: prev.errors + (failed ? 1 : 0),
                  totalMs: prev.totalMs + elapsed(part.state),
                },
              },
            },
          }
        }
        return next
      }

      if (part.type === "text" && state.roles[part.messageID] === "assistant") {
        return {
          ...state,
          entries: upsert(state.entries, { kind: "assistant", id: part.id, text: part.text ?? "" }),
        }
      }
      return state
    }

    default:
      return state
  }
}
