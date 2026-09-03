# ymcprobe — Agent Guide

Drives a headless `opencode` against one or more remote MCP servers so you can
see whether an LLM actually invokes their tools, and with what arguments. Two
front-ends, one state machine. Everything here serves one constraint: **what
the trace shows must be what the stream delivered.**

- `README.md` — what it is and how to run it
- `PRD.md` — scope, requirements and acceptance criteria
- `CHANGELOG.md` — command-facing changes by date
- `docs/adr/` — durable decisions as ADRs
- `docs/research/` — measured behaviour of `opencode serve` and `ink`

Read the relevant ones before changing what they cover, and update them when a
change bends a decision or contradicts a finding.

## Stack

- Bun and TypeScript, ESM, `strict` with `noUncheckedIndexedAccess`
- Ink for the TUI, plain DOM for the browser UI
- A direct streamable-HTTP MCP client, hand-written
- `opencode serve` as a spawned child, driven over `fetch` and one SSE stream

`bun install` once, then `make` with no target prints the list. Every target
self-documents via its `## ` comment.

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
chose to do with it. When the two disagree, that gap is the finding
([ADR 0002](docs/adr/0002-two-connections-per-server.md)).

**`src/session.ts` is the only place the trace is computed.** Both front-ends
feed it raw opencode events and render its output. Anything added to one UI
that changes what a trace *means* belongs in the reducer, not the view
([ADR 0003](docs/adr/0003-one-reducer-computes-the-trace.md)).

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
| `src/bundle-client.ts` | build-time macro that inlines the browser bundle |
| `fixtures/echo-mcp.ts` | 4-tool MCP server (`echo`, `add`, `boom`, `lorem`) |
| `patches/ink@6.8.0.patch` | empties ink's dev-only devtools module so nothing imports `react-devtools-core` |
| `Makefile` | `make` with no target prints the help; targets self-document via `## ` |

## Development

- Keep changes small and scoped to the requested behaviour.
- Flags, defaults, the `name=url` syntax, `--json` output and the `make` verbs
  are public behaviour. Treat a change to them as a product change and record
  it in `CHANGELOG.md`.
- Runtime dependencies are `ink` and `react`. The browser UI has none. Adding a
  third needs a reason that survives [ADR 0004](docs/adr/0004-plain-fetch-not-the-sdk.md).
- Measure opencode or ink behaviour before coding around it, and record it in
  `docs/research/` rather than in a comment.
- Errors reach the user as one sentence, never a Bun stack trace. `EADDRINUSE`
  from a `--web` instance left running is the common case.
- Header values are credentials. They go to the servers under test and to
  nothing else, including logs, the page and `--json`.
- Keep comments rare; explain why, not what.

### Front-end rules

- **Wrap to the box's measured width, never `stdout.columns`**, and use a
  single space rather than an empty `<Text>` for a blank line. Both are ink
  quirks with real symptoms ([ink-behaviour.md](docs/research/ink-behaviour.md)).
- **Do not "simplify" `src/input.tsx` back to `ink-text-input`.** It loses
  keystrokes for two measured reasons, recorded in the same document.
- **Clamp tool output.** A single article-fetching tool returns tens of
  kilobytes and buries every other call in the trace. `clampable()` caps each
  block and offers *show more*; the expanded ids live outside the entry list so
  a re-render does not collapse them.
- **Sidebar names ellipsize, never wrap.** A wrapped name desyncs from its
  count and the column stops being scannable — real tool names like
  `fetch_support_article` are long enough to hit this.

## Testing

- `make typecheck` on every change.
- `make preview` renders the whole layout from a scripted event stream —
  several servers, a dead one, a failed call — with no LLM spend. Piping it is
  also the ink-version canary: 190 lines on ink 6.8.0, zero on ink 7.
- `make smoke` boots the stack against the bundled fixture and fails if no
  completed tool call reaches the stream. It costs one real LLM call.
  `MCP_URLS` (comma separated), `MCP_MODEL` and `MCP_PROMPT` override what it
  exercises.
- The fixture is one tool per branch the UI has to render: `echo` and `add`
  succeed, `boom` always fails, and `lorem` returns more text than fits on
  screen. `make fixture PORT=8081` gives you a second server to test grouping
  with.
- The README screenshot is taken against the fixture, never a real server: the
  split repo is public.

## Operations

- **Run `make smoke` after every opencode bump.** The whole trace hangs on one
  event that has silently stopped being delivered once before, and nothing else
  fails when it does ([opencode-server.md](docs/research/opencode-server.md)).
- **On an ink bump `bun install` fails because the patch no longer applies.**
  That is the intended alarm. Regenerate with `bun patch ink`, empty
  `build/devtools.js`, `bun patch --commit ink`, then re-check
  `bun run preview | wc -l` against 190. Do not sidestep it by upgrading to
  ink 7.
- `make ship` is `build` then `link`, and the five fx-style verbs mean what
  they mean in `fxstack/fxgit` — keep them that way
  ([ADR 0008](docs/adr/0008-compiled-binary-on-path.md)). `make install`
  installs *dependencies* and does not touch PATH.
- `make clean` leaves the symlink dangling until the next `make build`.

## Conventions

- Commits: `[ymcprobe] lowercase imperative summary`.
- The component's documents follow [.ytemplate](../.ytemplate/README.md).
