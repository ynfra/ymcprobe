# opencode serve

Observed behaviour of the HTTP server `opencode serve` exposes, which ymcprobe
spawns as a child process and drives over `fetch` plus one SSE stream. Every
endpoint used was pinned against the server's own OpenAPI document, `GET /doc`
on a running instance, which is the fastest way to re-check a contract after an
opencode bump. Probed while building ymcprobe, 2026-08-30 and 2026-08-31.

## Findings

### Measured live

- **MCP servers can be registered at runtime.** `POST /mcp` with
  `{name, config}` connects immediately: no restart, no config file, no trust
  prompt. This is the single capability that decided the harness choice
  ([harnesses.md](harnesses.md), [ADR 0001](../adr/0001-opencode-as-the-engine.md)).
- **`--port 0` does not allocate a random port**, it falls back to 4096. Pass a
  real port. The readiness signal is the `listening on <url>` line on stdout,
  parsed back off the child's output; startup is ~3-5 s.
- **`/experimental/tool` lists built-ins only.** MCP tools are injected at
  prompt time and never appear there, so an inventory of what a server
  advertises cannot come from opencode. ymcprobe makes its own `tools/list`
  call instead ([ADR 0002](../adr/0002-two-connections-per-server.md)).
- **MCP tools reach the model namespaced `<registered-name>_<tool>`**, e.g.
  `probe_echo`. Mapping a call back to its server means splitting on that
  prefix, which is why registered names must be terse and unique.
- **Built-ins are muted per request** via the `tools: {name: false}` map on the
  prompt body. The agent-config `tools` key is deprecated; the prompt-body map
  is not.
- **The prompt body also takes `system`.** Without a system prompt the model
  treats MCP tools as optional trivia and answers from memory
  ([ADR 0005](../adr/0005-harness-prompt-and-muted-builtins.md)).
- **Model selection has no global default.** `GET /config/providers` returns a
  `default` map of provider → model plus a full catalogue per provider. A bare
  `--model` therefore has to be resolved across every authenticated provider.
- **`capabilities.toolcall` is on every model entry.** Picking a model that
  cannot call tools is a silent dead end, so it is worth reading rather than
  assuming.
- **Token counts and cost ride on `message.updated`**, on the assistant message
  once `time.completed` is set. No part event carries them.
- Permission requests arrive as `permission.asked` on the event stream and are
  answered with `POST /permission/{requestID}/reply`
  ([ADR 0006](../adr/0006-auto-approve-permissions.md)).

### The regression to watch

The whole trace hangs on one event, `message.part.updated`. It silently stopped
being delivered on the `/event` SSE stream in opencode 1.14.42 through 1.15.1
([#27966](https://github.com/anomalyco/opencode/issues/27966)): the server
logged the publish, subscribers got nothing.

Nothing else fails when this happens. Sessions start, prompts complete, the
model answers, and the trace is simply empty — which is indistinguishable from
a server whose tools the model chose not to call, the exact finding ymcprobe
exists to report.

`make smoke` boots the stack against the bundled fixture and fails if no
completed tool call reaches the stream. **Run it after every opencode bump.**
It costs one real LLM call.

## Implications

- `src/opencode.ts` owns the spawn, the typed HTTP client and the SSE parser,
  and is the only file that needs touching when a contract moves.
- `src/models.ts` resolves a bare `--model` across every authenticated
  provider, breaking ties toward `github-copilot` and then each provider's own
  default, and erroring rather than guessing when still ambiguous. The header
  warns when the chosen model reports `toolcall: false`.
- `src/prompt.ts` lists tool *names* only. opencode already sends each tool's
  description and JSON schema, so repeating them costs thousands of tokens per
  turn on a real 16-tool server.
- The direct MCP probe runs first, so a dead URL fails in milliseconds rather
  than after paying for the 3-5 s boot.

## Limitations

- Behaviour was measured against the opencode versions current on 2026-08-30
  and 2026-08-31. Version numbers above the regression range were not
  re-verified after 1.15.1.
- Only the endpoints ymcprobe uses were probed: `/doc`, `/mcp`,
  `/config/providers`, `/session`, `/session/{id}/prompt_async`,
  `/permission/{id}/reply`, `/experimental/tool` and `/event`.
- The startup timing is one machine's, not a guarantee.

## Review triggers

Re-probe after every opencode bump, and specifically when `make smoke` fails,
when `GET /doc` shows a moved or renamed endpoint, when tool namespacing or the
prompt-body `tools` map changes shape, or when the deprecated agent-config
`tools` key is removed.
