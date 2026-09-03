# Product Requirements: ymcprobe

## Purpose

ymcprobe answers one question about a remote MCP server: handed to a real LLM,
does it call the server's tools, with which arguments, and what comes back? It
is MCP Inspector's job driven by a model instead of a form, so the finding is
about how the server reads to a model rather than about whether its wire
protocol works.

Its users are the people who write MCP servers: checking a new tool is
reachable, that a description makes a model reach for it, that arguments arrive
in the shape the schema promised, and that failures surface as errors rather
than as invention.

## Goals

- Show, live, every tool call a model makes against one or more MCP servers.
- Show which advertised tools the model never called, because that is usually a
  description problem rather than a wiring problem.
- Fail fast and clearly when a server is unreachable, before any model spend.
- Work against several servers in one session, with calls attributed per
  server.
- Reuse the operator's existing agent auth, so there is no extra key and no
  account.
- Run in a terminal or a browser, and report the same trace in both.
- Stay a testing instrument. It is not a client anyone should point at a
  production server.

## Product Surface

| Invocation | Purpose |
| --- | --- |
| `ymcprobe <url>...` | Chat against the servers in a TUI, with a live trace |
| `ymcprobe <url>... --web` | The same session and trace in a browser page |
| `ymcprobe <url>... --json` | Print what every server advertises and exit, no model |
| `ymcprobe --models` | List authenticated providers and their models |
| `<name>=<url>` | Name a server explicitly instead of deriving it from the host |
| `-H, --header 'K: V'` | Header sent to every server, repeatable |
| `-m, --model` | Bare id, unique substring, or `provider/model` |
| `-p, --port` | Port for the spawned agent; the web UI takes the next one |
| `--system` / `--no-system` | Replace or drop the harness system prompt |
| `--all-tools` | Keep the agent's built-in tools in play |

Supporting commands, for developing ymcprobe rather than probing a server:
`make fixture` serves a local MCP server whose tools cover every branch the UI
renders, `make preview` renders the TUI from scripted events with no model
spend, and `make smoke` asserts end to end that tool events still arrive.

## Functional Requirements

### Inventory and reachability

- Every server must be probed directly, before the agent is started, so an
  unreachable URL fails in milliseconds rather than after a boot.
- The tool inventory must come from the server's own `tools/list`, never from
  the driving agent.
- A single unreachable server must be a warning; the session must start as long
  as one server answers, and must show the rest as failed.
- All servers unreachable must be a fatal error naming each URL and its own
  failure.
- The status shown per server must be the one the driving agent reports, so a
  server we can reach but the model cannot is visible rather than assumed.
- Server names must be unique and terse, derived from the host unless given as
  `name=url`, because tool calls are attributed by that name.
- Only `http` and `https` URLs are accepted.

### The trace

- Every tool call must appear with its server, its arguments, its result or its
  error, and its latency.
- A failing tool call must be reported verbatim. A failure is a result, not
  something to hide.
- Tool calls must appear incrementally as they happen, not in a batch at the
  end of the turn.
- The trace must be computed in one place and rendered identically by both
  front-ends; the two must never be able to disagree about what happened.
- Per-tool call counts and average latency must be shown for every advertised
  tool, including the ones with no calls.
- Token use and cost must be reported once the turn completes.
- Long tool output must be bounded in both front-ends, so one chatty tool
  cannot push the rest of the trace off screen, and the bounding must be
  visible rather than silent.

### The model

- The session must default to a model that can call tools, and must warn when
  the selected model reports that it cannot.
- A bare model id or a unique substring must resolve across every authenticated
  provider; an ambiguous choice must be an error rather than a guess.
- By default the model must be told it is inside a test harness: call the
  tools, do exactly what was asked, treat "test every tool" as one call each,
  never fabricate a call or a result, and report failures verbatim.
- The system prompt must be replaceable and removable, because a nudged model
  and an unprompted one answer different questions.
- The system prompt must not repeat tool descriptions or schemas the agent
  already sends.
- By default the driving agent's own built-in tools must be muted, so
  everything in the trace came from a server under test, and restoring them
  must be one flag.

### Failure and teardown

- A missing prerequisite, a bad flag, an unresolvable model and a port already
  in use must each produce one sentence naming the problem, never a stack
  trace.
- The spawned agent process must be killed on every exit path, including
  signals, rather than orphaned.
- Piping the TUI must be refused with the alternative named, because the
  renderer produces nothing useful when stdout is not a terminal.

## Quality Requirements

### Accuracy

- What the trace shows must be what the stream delivered. Nothing may be
  inferred, completed or reordered to look tidier.
- An empty trace must be distinguishable from a broken event stream. A run
  where no tool was called and a run where tool events were never delivered
  look identical from the outside, so the difference must be provable by a
  check that fails loudly.
- Advertised inventory and observed calls must stay visibly separate.

### Performance

- Reachability must be established before any model spend.
- `--json` must complete without starting the driving agent.
- Rendering must remain correct when output is piped, which means measured
  widths rather than assumed terminal width.

### Reliability

- One dead server must not stop a session that has a live one.
- The regression that silently empties the trace must be caught by a check that
  is part of the documented upgrade procedure, not by a user noticing.
- The instrument must be runnable against a local fixture, with no network and
  no real server, so its own UI can be exercised.

### Observability and Privacy

- Headers are credentials: they must be passed to the servers under test and
  must never be printed to the terminal, the page, or the JSON output.
- Prompts, tool arguments and results must not be persisted anywhere. The trace
  lives in memory for the length of the run.

## Security Requirements

- Permission prompts are auto-approved, so the only safety boundary is the
  operator's choice of target. The documentation must say plainly that this is
  a harness and must not be aimed at tools with real side effects.
- Screenshots and fixtures committed to the repository must come from the
  bundled fixture server, never from a real server, because the split
  repository is public.
- The browser UI must not hold credentials or approve permissions; its server
  is the only party that talks to the agent.

## Out of Scope

- Deterministic CI assertions about MCP servers: idempotency, latency
  baselines, contract snapshots. A model in the loop makes runs non-repeatable
  by design.
- Hand-driving a server without a model. MCP Inspector does that.
- Authoring or hosting MCP servers. The bundled fixture exists to test
  ymcprobe, not as a starting point for a server.
- OAuth flows and token refresh. Static headers only.
- Persisting sessions, transcripts or comparisons between runs.
- Any claim that a green run proves a server is correct. It proves one model,
  once, called what it called.

## Risks

| Risk | Required mitigation |
| --- | --- |
| The driving agent stops delivering tool events, leaving an empty trace | A headless check asserts a completed tool call arrives, and running it after every agent upgrade is documented procedure |
| An empty trace is read as "the model ignored my tools" when the stream is broken | The same check, plus a fixture whose tools are known to be called |
| A destructive tool is called because prompts are auto-approved | State the harness-only boundary in the README and the ADR; keep the target choice with the operator |
| The nudged model's behaviour is read as a model's natural behaviour | Ship the prompt as a documented, replaceable part of the instrument |
| Auth headers leak into a screenshot or a shared JSON dump | Never render header values; take documentation screenshots against the fixture |
| The driving agent's API changes under us | Pin every endpoint against its OpenAPI document, keep the client in one file, and record measured behaviour with review triggers |
| A chatty tool buries the rest of the trace | Bound tool output in both front-ends, and make the bounding visible |

## Acceptance Criteria

1. Pointed at one MCP server, ymcprobe lists its advertised tools and, after a
   prompt, shows each tool call with arguments, result and latency.
2. Pointed at several servers, every call is attributed to the server that
   served it, and per-server panels group them.
3. An unreachable URL among reachable ones produces a warning and a session;
   all URLs unreachable produces a single fatal message naming each failure.
4. A tool that always fails appears in the trace with its error text, and does
   not stop the turn.
5. Advertised tools the model never called are visibly distinguishable from
   tools it called.
6. `--json` prints every server's inventory without starting the driving agent.
7. `--models` lists authenticated providers and models; an ambiguous `--model`
   is an error naming the candidates.
8. The TUI and the browser UI report the same calls, counts and latencies for
   the same run.
9. Built-in tools are absent from the trace by default and present with
   `--all-tools`.
10. `--no-system` runs without the harness prompt, and the difference in
    behaviour is the user's to observe.
11. The headless check fails when tool events stop arriving on the event
    stream.
12. The TUI renders correctly piped and unpiped, and refuses to start with a
    clear message when stdout is not a terminal.
13. Every exit path leaves no orphaned agent process.
14. Header values never appear in any output.
