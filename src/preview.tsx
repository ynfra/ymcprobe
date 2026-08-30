#!/usr/bin/env bun
// Renders the TUI against a scripted event stream — no opencode, no MCP
// server, no LLM spend. Use it when changing the layout.
//
//   bun run preview

import { render } from "ink"
import { PassThrough } from "node:stream"
import { App } from "./ui.tsx"

const EVENTS = [
  { type: "message.updated", properties: { info: { id: "m1", role: "assistant" } } },
  { type: "message.part.updated", properties: { part: { type: "tool", id: "p1", callID: "c1", tool: "probe_echo", state: { status: "running", input: { text: "hi" }, time: { start: 0 } } } } },
  { type: "message.part.updated", properties: { part: { type: "tool", id: "p1", callID: "c1", tool: "probe_echo", state: { status: "completed", input: { text: "hi" }, output: "echo: hi", time: { start: 0, end: 142 } } } } },
  { type: "message.part.updated", properties: { part: { type: "tool", id: "p2", callID: "c2", tool: "probe_boom", state: { status: "error", input: {}, error: "boom: this tool always fails", time: { start: 0, end: 11 } } } } },
  { type: "message.part.updated", properties: { part: { type: "tool", id: "p3", callID: "c3", tool: "docs_search", state: { status: "completed", input: { q: "mcp" }, output: "3 results", time: { start: 0, end: 830 } } } } },
  { type: "message.part.updated", properties: { part: { type: "text", id: "t1", messageID: "m1", text: "I called echo and it came back with 'echo: hi'. boom failed, as advertised." } } },
  { type: "message.updated", properties: { info: { id: "m1", role: "assistant", time: { created: 0, completed: 1 }, tokens: { input: 1240, output: 340 }, cost: 0.0031 } } },
  { type: "session.idle", properties: {} },
]

// Ink wants a raw-mode-capable TTY; a PassThrough wearing the two methods
// it actually calls is enough.
const stdin = Object.assign(new PassThrough(), {
  isTTY: true,
  setRawMode() { return stdin },
  ref() {},
  unref() {},
}) as unknown as NodeJS.ReadStream

const client = {
  async *events() {
    for (const event of EVENTS) {
      await new Promise((r) => setTimeout(r, 150))
      yield event
    }
  },
  prompt: async () => {},
  abort: async () => {},
  replyPermission: async () => {},
} as unknown as Parameters<typeof App>[0]["client"]

render(
  <App
    client={client}
    sessionID="ses_preview"
    servers={[
      {
        name: "probe",
        url: "http://localhost:8080/mcp",
        status: "connected",
        tools: [
          { name: "echo", description: "Echo back the given text." },
          { name: "add", description: "Add two numbers." },
          { name: "boom", description: "Always fails." },
        ],
      },
      {
        name: "docs",
        url: "https://docs.example.com/mcp",
        status: "connected",
        tools: [{ name: "search", description: "Search the docs." }],
      },
      {
        name: "dead",
        url: "http://127.0.0.1:9999/mcp",
        status: "failed",
        error: "Unable to connect. Is the computer able to access the url?",
        tools: [],
      },
    ]}
    providerID="github-copilot"
    modelID="claude-sonnet-4.6"
    toolcall={true}
    toolFilter={{}}
  />,
  { stdin },
)
