# ymcprobe — Agent Guide

Drives a headless `opencode` against one or more remote MCP servers so you can
see whether an LLM actually invokes their tools, and with what arguments.
Two front-ends, one state machine.

## Architecture

One child process. Everything else is HTTP against it.

```
ymcprobe (bun)
  ├─ direct MCP client ─────────────► each <mcp-url>   initialize + tools/list
  │     the inventory, and the reachability check that runs first so a dead
  │     URL fails in milliseconds rather than after an opencode boot
  │
  ├─ spawn ──► opencode serve :4179 ─► each <mcp-url>  the model's connection
  │
  ├─ POST /mcp                registers every server at runtime
  ├─ POST /session            one session per run
  ├─ POST /session/{id}/prompt_async
  └─ GET  /event (SSE)        filtered to our sessionID
                                 │
                    src/session.ts (pure reducer)
                       ├─► src/ui.tsx        Ink TUI
                       └─► src/web-client.ts browser, via src/web.ts on :4180
```

Two independent connections to the same MCP server is deliberate: the direct
one proves what the server advertises, the opencode one shows what the model
chose to do with it. When the two disagree, that gap is the finding.

**`src/session.ts` is the only place the trace is computed.** Both front-ends
feed it raw opencode events and render its output. Anything added to one UI
that changes what a trace *means* belongs in the reducer, not the view.

## Why plain `fetch` and not `@opencode-ai/sdk`

Every endpoint used here was pinned against the server's own OpenAPI document
(`GET /doc` on a running instance — the fastest way to re-check a contract
after an opencode bump). Dropping the SDK removes a version-coupled dependency
for maybe thirty lines of wrapper code.

## Facts worth not rediscovering

- **MCP servers can be added at runtime.** `POST /mcp` with `{name, config}`
  connects immediately. No restart, no config file.
- **`--port 0` does not allocate a random port**, it falls back to 4096. Pass a
  real port and parse `listening on <url>` back off stdout as the readiness
  signal. Startup is ~3-5s.
- **`/experimental/tool` lists built-ins only.** MCP tools are injected at
  prompt time and never appear there, which is why the inventory comes from
  our own `tools/list` call.
- **MCP tools are namespaced `<registered-name>_<tool>`**, e.g. `probe_echo`.
  `splitTool()` maps that back to a server so the UI can group by it.
- **Built-ins are muted per request** via the `tools: {name: false}` map on the
  prompt body. The agent-config `tools` key is deprecated; this is not.
- **The prompt body also takes `system`.** Without a system prompt the model
  treats MCP tools as optional trivia and answers from memory, which makes the
  harness useless. See `src/prompt.ts` — it lists tool *names* only, because
  opencode already sends each tool's description and schema, and on a real
  16-tool server repeating them costs thousands of tokens per turn.
- **Model selection has no global default.** `GET /config/providers` returns a
  `default` map of provider → model plus a full catalogue per provider. A bare
  `--model` resolves across every authenticated provider; ties break toward
  `github-copilot`, then toward each provider's own default, and anything
  still ambiguous is an error rather than a guess.
- **`capabilities.toolcall` is on every model entry.** Picking a model that
  cannot call tools is a silent dead end, so the header warns.
- **Token counts and cost ride on `message.updated`**, on the assistant message
  once `time.completed` is set — not on any part event.

## The regression to watch

The whole trace hangs on one event, `message.part.updated`. It silently
stopped being delivered on the `/event` SSE stream in opencode 1.14.42 through
1.15.1 ([#27966](https://github.com/anomalyco/opencode/issues/27966)) — the
server logged the publish, subscribers got nothing.

`bun run smoke` exists for exactly this: it boots the stack against the bundled
fixture and fails if no completed tool call reaches the stream. **Run it after
every opencode bump.** It costs one real LLM call. `MCP_URLS` (comma
separated), `MCP_MODEL` and `MCP_PROMPT` override what it exercises.

## Layout

| File | Role |
|---|---|
| `src/cli.tsx` | arg handling, boot order, model pick, teardown |
| `src/args.ts` | flags, and `name=url` / host-derived server naming |
| `src/opencode.ts` | spawn + typed HTTP client + SSE parser |
| `src/mcp.ts` | direct streamable-HTTP MCP client (`initialize`, `tools/list`) |
| `src/models.ts` | model resolution and the `--models` listing |
| `src/prompt.ts` | the system prompt that makes the model reach for the tools |
| `src/session.ts` | **the reducer** — events in, transcript + stats out |
| `src/ui.tsx` | Ink TUI: transcript, per-server panels, stats, input |
| `src/input.tsx` | the text input, because ink-text-input drops backspaces |
| `src/web.ts` | Bun server: page, prompt proxy, SSE relay, client bundling |
| `src/web-client.ts` | browser UI, plain DOM, bundled at serve() time |
| `src/preview.tsx` | renders the TUI against scripted events, no LLM spend |
| `src/smoke.ts` | headless end-to-end assertion |
| `fixtures/echo-mcp.ts` | 4-tool MCP server (`echo`, `add`, `boom`, `lorem`) |
| `Makefile` | `make` with no target prints the help; targets self-document via `## ` |
| `src/bundle-client.ts` | build-time macro that inlines the browser bundle |
| `stubs/react-devtools-core/` | stub so `--compile` can resolve ink's dev-only import |

The fixture is one tool per branch the UI has to render: `echo` and `add`
succeed, `boom` always fails, and `lorem` returns more text than fits on
screen. `PORT=8081 bun run fixture` gives you a second server to test grouping
with. The README screenshot is taken against these, never a real server — the
split repo is public.

## Terminal input

`ink-text-input` loses keystrokes here, for two reasons worth knowing before
anyone "simplifies" `src/input.tsx` back to it:

- Ink only sets `key.backspace` / `key.delete` when a rub-out arrives alone in
  its own read. Held down or pasted, the chunk arrives as raw `0x7f` bytes with
  **no key flag at all**, so `input` has to be walked character by character.
- `useInput`'s callback closes over the value from its render. Two events
  landing before React re-renders both see the same text and one deletion is
  lost. A ref updated synchronously keeps them composing.

## Laying out the TUI

- **Wrap to the box's measured width, never to `stdout.columns`.** When output
  is piped, `columns` reports a width Ink does not use, Ink shrinks the box to
  the real terminal, and then re-wraps our already-wrapped lines into ragged
  thirds. `measureElement` on a `flexGrow` box is the only width worth
  trusting.
- **`<Text>{""}</Text>` collapses to nothing.** Blank separator lines need a
  single space.

`bun run preview` renders the whole layout from a scripted event stream —
several servers, a dead one, a failed call — with no LLM spend.

## Web UI details worth keeping

- **Clamp tool output.** A single article-fetching tool returns tens of
  kilobytes and buries every other call in the trace. `clampable()` caps each
  block and offers *show more*; the expanded ids live outside the entry list so
  a re-render does not collapse them.
- **Sidebar names ellipsize, never wrap.** A wrapped name desyncs from its
  count and the column stops being scannable — real tool names like
  `fetch_support_article` are long enough to hit this.

## Getting it onto PATH

Two targets, both writing to `PREFIX` (default `~/.local/bin`, the XDG-ish
convention), both undone by `make uninstall`:

- **`make link`** symlinks `src/cli.tsx`, which carries a `#!/usr/bin/env bun`
  shebang and is committed executable. No build, and edits are live on the next
  run. This is the development path.
- **`make install`** builds and copies the standalone binary, for a machine
  without bun.

`install` over a symlink and `link` over a binary both work; `uninstall`
removes either.

## Compiling a standalone binary

`make build` produces `dist/ymcprobe` (~62 MB) that runs without bun. It still
needs `opencode` on PATH — the binary embeds ymcprobe, not the agent it drives.

Two things had to change to make that possible, and both will look like
pointless indirection to anyone who did not hit them:

- **The browser client is bundled by a build-time macro**, `src/bundle-client.ts`
  imported `with { type: "macro" }`. A compiled binary has no source tree, so
  the old runtime `Bun.build()` call failed the moment ymcprobe ran from
  anywhere but this directory. The macro shells out to `bun build` rather than
  calling `Bun.build()` directly — a macro cannot start a second bundle while
  the bundler is waiting on it.
- **`stubs/react-devtools-core/` exists so the import resolves.** ink's
  reconciler does `await import('./devtools.js')` behind an `isDev()` guard,
  and that module statically imports `react-devtools-core`. The guard is a
  function call, so the branch cannot be proven dead: `--external` keeps it as
  a runtime import and a compiled binary resolves those eagerly at startup
  (`Cannot find package` before `main` runs), and `--define` misses it because
  ink reads `process.env['DEV']` with bracket notation. A few-byte stub beats
  pulling the real ~10 MB package in for a branch we never take.

## Why the web UI proxies everything

Nothing in a page can spawn `opencode serve`, and a target MCP server almost
never sends CORS headers, so a static page plus `opencode serve --cors` is not
a shortcut that exists. `src/web.ts` is the origin: it serves the page, proxies
prompts, and relays the SSE stream. Permission auto-approval happens there too,
never in the browser.

Binding failures are reported as a sentence, not a Bun stack trace: leaving a
`--web` instance running is the normal way to hit `EADDRINUSE`, and the spawned
opencode child is killed on the way out rather than orphaned.

## Conventions

- Bun + TypeScript, ESM, `strict` with `noUncheckedIndexedAccess`.
- Runtime dependencies: `ink` and `react`. The browser UI has none.
- Commits: `[ymcprobe] lowercase imperative summary`.
