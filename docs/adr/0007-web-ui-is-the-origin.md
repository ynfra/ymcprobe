# 0007: The Web UI Serves From Its Own Origin and Proxies Everything

**Status:** accepted

## Context

The browser UI looks like it could be a static page talking straight to
`opencode serve --cors` and to the MCP servers under test. It cannot, for two
independent reasons:

- Nothing in a page can spawn `opencode serve`.
- A target MCP server almost never sends CORS headers, so the direct
  `tools/list` probe cannot happen from the browser either.

## Decision

`src/web.ts` is a Bun server and the page's own origin. It serves the page,
bundles the browser client, proxies prompts to opencode, and relays the SSE
stream filtered to our session. It runs on the opencode port plus one, so
`--port 4179` puts the UI on 4180.

Permission auto-approval happens there, never in the browser
([ADR 0006](0006-auto-approve-permissions.md)).

Binding failures are reported as a sentence rather than a Bun stack trace,
because leaving a `--web` instance running is the normal way to hit
`EADDRINUSE`. The spawned opencode child is killed on the way out rather than
orphaned.

## Consequences

- The browser client needs no dependencies and no CORS cooperation from
  anything.
- Two ports are in play per run, and the second one is implicit.
- Every event the browser sees has passed through our relay, so a bug there
  looks like a model or server bug. The TUI, which reads the stream directly,
  is the control.

## Review Triggers

Revisit if the relay grows logic beyond forwarding, which would put it in
conflict with [ADR 0003](0003-one-reducer-computes-the-trace.md), or if the
implicit second port becomes a problem worth its own flag.
