# 0005: A Harness System Prompt, and Built-ins Muted by Default

**Status:** accepted

## Context

A neutral session makes the harness useless in two distinct ways.

Without a system prompt, the model treats MCP tools as optional trivia and
answers from its own knowledge. A run then produces a good answer and an empty
trace, and the user learns nothing about their server.

With opencode's built-in tools live (`bash`, `read`, `edit`, …), a call in the
trace may have come from a built-in rather than from the server under test, so
the trace no longer answers the question it was opened to answer.

## Decision

By default, inject a system prompt (`src/prompt.ts`) that states plainly what
the session is for: call the tools rather than answering from memory; do
exactly what was asked even when another tool would answer better; read "test
every tool" as "call each one once, in order, with the smallest plausible
arguments"; never fabricate a call or a result; report failures verbatim.

By default, mute every built-in tool through the prompt body's
`tools: {name: false}` map, so everything in the trace came from a server under
test.

Both defaults are escapable: `--system <text>` replaces the prompt,
`--no-system` drops it, `--all-tools` puts the built-ins back.

The prompt lists tool **names** only. opencode already sends each tool's
description and JSON schema, and repeating them costs thousands of tokens per
turn on a real 16-tool server.

## Consequences

- A run measures the server, not the model's memory.
- The measurement is of a *nudged* model. ymcprobe answers "will a model that
  is trying call this tool, and correctly", not "will a model reach for it
  unprompted". `--no-system` is the honest way to ask the second question.
- The prompt is part of the instrument, so changing its wording changes results
  between runs.
- The `tools` map on the prompt body is the supported mechanism; the
  agent-config `tools` key is deprecated
  ([opencode-server.md](../research/opencode-server.md)).

## Review Triggers

Revisit when a model ignores the prompt's numbered instructions often enough to
distort results, or if opencode changes how built-ins are filtered.
