# 0001: A Headless opencode as the Harness Engine

**Status:** accepted

## Context

ymcprobe asks one question: handed this remote MCP server, does an LLM call its
tools, and with what arguments? Filling that slot needs an engine that connects
to a remote MCP server the way a real client would, accepts an MCP URL at
runtime, emits tool calls incrementally as a stream, and spans providers rather
than one vendor.

Nine agent harnesses were surveyed on 2026-08-30
([harnesses.md](../research/harnesses.md)). Requirement two decided it: taking
a URL at runtime. Every other engine wants a config file written before boot,
or a trust gate approved by hand, which inverts a CLI whose entire surface is a
list of URLs. Writing our own MCP-to-model bridge was the other option, and it
fails requirement one: a green run would prove the bridge works, not the
server.

## Decision

Spawn `opencode serve` as a child process and drive it over HTTP plus its
`/event` SSE stream. Register each server under test at runtime with
`POST /mcp`. ymcprobe owns no model plumbing of its own and reuses the user's
existing opencode auth, so there is no separate API key and no account.

## Consequences

- Fidelity: the model reaches the server through a real client, not our code.
- Multi-provider model choice comes free, as does auth.
- A 3-5 s boot on every run, plus a spawn, a port, a readiness parse and a
  child process to kill on the way out.
- ymcprobe inherits opencode's bugs. One of them, the SSE event the whole trace
  depends on, has already broken once
  ([opencode-server.md](../research/opencode-server.md)).
- The compiled binary needs `opencode` on PATH; it embeds ymcprobe, not the
  agent it drives.

## Review Triggers

Revisit when `fx` leaves experimental status and grows a trust-bypass flag for
scripted runs, which would remove the boot cost. If opencode's event stream
breaks again, the fallback order is `fx`, then `codex exec --json`, and not
`pi`. Read Codex's `http_headers` / `env_http_headers` and OAuth handling
before building header or OAuth support here.
