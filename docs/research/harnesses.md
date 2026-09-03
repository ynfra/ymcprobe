# Harnesses evaluated

Why ymcprobe drives `opencode` and not one of the other eight agent harnesses
that could, on paper, do the same job. Surveyed 2026-08-30.

## What the slot actually requires

ymcprobe asks one question: *does an LLM, handed this remote MCP server, call
its tools — and with what arguments?* An engine fills the slot only if it can:

1. **Connect to a remote MCP server the way a real client would.** The whole
   point is fidelity. Anything that puts our own translation layer between the
   server and the model measures the layer, not the server.
2. **Take an MCP URL at runtime.** ymcprobe's CLI surface is a list of URLs.
   An engine that needs a config file written before boot inverts that.
3. **Emit tool calls as a stream, with arguments, incrementally.** A single
   JSON blob at the end cannot drive a live transcript.
4. **Span providers.** `src/models.ts` resolves across every authenticated
   provider on purpose; a single-vendor engine throws that away.

Requirement 2 is the one that decides it. **opencode is the only harness
surveyed with runtime MCP registration** — `POST /mcp` with `{name, config}`,
connected immediately, no restart, no config file, no trust prompt.

## The field

| Harness | MCP | Remote HTTP + auth | Headless event stream | Outcome |
|---|---|---|---|---|
| [opencode](https://github.com/anomalyco/opencode) | first-party, **runtime `POST /mcp`** | yes | SSE `/event` | **chosen** |
| [fx](https://github.com/vercel-labs/fx) (Vercel Labs) | built in | `fx mcp add --transport http` | `fx ask --json` | closest rival |
| [Codex CLI](https://developers.openai.com/codex/mcp) | built in, `config.toml` | streamable HTTP, OAuth/bearer, `http_headers`, `env_http_headers` | `codex exec --json` (NDJSON) | best auth story |
| Claude Code CLI | first-party | yes | `-p --output-format stream-json` | single-vendor |
| [Claude Agent SDK (TS)](https://code.claude.com/docs/en/agent-sdk) | http/sse/stdio | yes | `includePartialMessages` | disqualified |
| [goose](https://github.com/block/goose) (Block) | MCP-native | `streamable_http` extensions | recipes | viable, heavier |
| [crush](https://github.com/charmbracelet/crush) (Charm) | stdio / http / sse | yes | TUI-first | thin headless |
| Gemini CLI | yes | yes | `--output-format json` — one object per run | can't trace |
| [pi](https://github.com/badlogic/pi-mono) | **none in core** | via extension | `--mode json` / `--mode rpc` | best transport, worst fidelity |

## Why each rejection

**pi** — the core has no MCP and won't: the README lists "No MCP" under
*Philosophy*, arguing MCP tool definitions are too token-heavy (Playwright MCP
= 21 tools / 13.7k tokens; Chrome DevTools MCP = 26 tools / 18k). Issue
[#563](https://github.com/badlogic/pi-mono/issues/563), opened by the
maintainer to add an official MCP extension example, is closed with no PR. Six
community extensions exist — `pi-mcp-extension` (individual registration,
JSON Schema→TypeBox), `pi-mcp-adapter` (~1.4k stars, **one proxy tool by
default**), `ElieMessieCode/pi-mcp`, `scaryrawr/pi-mcp`, `pi-agent-suite`'s
mcp-wrapper, `pi-atlassian-mcp` — each with its own naming scheme and schema
conversion. Picking one means a green run proves *that bridge* works. Its
transport is genuinely better than ours (JSON-lines on stdout, no port, no
SSE); the fidelity cost is what disqualifies it. Repo has moved to
`earendil-works/pi`.

**fx** — Zig, ~6MB binary, ~10µs cold start, Apache-2.0, provider-agnostic,
Claude-compatible `.mcp.json`, and a WASM embedding SDK. Rejected on two
counts, both likely temporary: the repo's own banner reads "Status:
Experimental. Use at your own risk," and project MCP servers stay disconnected
behind a trust gate (`/mcp trust approve <server>`) — `fx ask` only reports
skipped servers on stderr, so an unapproved server yields a clean run with no
tools, which is precisely the failure ymcprobe exists to catch.

**Claude Agent SDK** — looked like the strongest technical fit, then failed on
two open bugs. [#202](https://github.com/anthropics/claude-agent-sdk-typescript/issues/202):
its HTTP MCP client omits `Accept: application/json, text/event-stream`, so
every Streamable HTTP server returns 406.
[#368](https://github.com/anthropics/claude-agent-sdk-typescript/issues/368):
the first turn dispatches before MCP servers connect, so **single-turn
sessions never see MCP tools**. ymcprobe is single-turn-per-prompt.

**Gemini CLI** — `--output-format json` returns one object per invocation, not
an event stream. No incremental tool calls, no live transcript.

**crush, goose** — both fine engines with real MCP support; neither offers
runtime registration, and neither improves on what we already have enough to
justify a rewrite.

## Not harnesses, but adjacent

- **MCP Inspector** (official) — hand-driving a server, no LLM. Complements
  ymcprobe, doesn't overlap.
- **mcp-test-harness** (`pip install mcp-test-harness`) — deterministic CI
  assertions with no model in the loop: `assert_tool_idempotent`, latency
  baselines. Answers the questions we deliberately don't.
- **Messages API MCP connector** — `mcp_servers: [{type: "url", url, name}]`
  **plus** `tools: [{type: "mcp_toolset", mcp_server_name: <same name>}]` under
  beta `mcp-client-2025-11-20`; both halves are required or it's a validation
  error. Anthropic's servers connect to the URL directly — no child process,
  no port, no SSE relay. Anthropic-only, so it can't answer "does *any* model
  bite," but it is the cheapest possible orthogonal second probe.

## What would change the decision

- **fx exits experimental** and grows a trust-bypass flag for scripted runs.
  Then the 3-5s opencode boot and the whole spawn/port/readiness dance become
  avoidable overhead rather than the cost of doing business.
- **Auth gets hard.** The moment we test servers behind OAuth or per-request
  headers, read Codex's `http_headers` / `env_http_headers` / OAuth handling
  before building our own.
- **opencode's SSE breaks again** (see [opencode-server.md](opencode-server.md)).
  Fallback order is fx, then `codex exec --json` — not pi.
