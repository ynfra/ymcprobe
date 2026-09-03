# 0003: One Reducer Computes the Trace

**Status:** accepted

## Context

There are two front-ends, an Ink TUI and a browser page, over the same event
stream. The obvious shape is for each to consume opencode's events and render
them, since each already needs its own rendering code anyway.

That shape puts the definition of a trace in two places. A tool call's identity,
when it counts as completed, how a failure is attributed to a server, what the
per-tool latency average is: any of those drifting between front-ends means the
two UIs report different findings from the same run, and neither can be trusted.

## Decision

`src/session.ts` is a pure reducer and the only place the trace is computed. It
takes raw opencode events and returns the transcript plus the statistics. Both
front-ends feed it and render its output; neither interprets events itself.

Anything added to one UI that changes what a trace *means* belongs in the
reducer, not the view. Presentation is free to differ: the TUI truncates tool
output to one line, the browser clamps it with a toggle.

## Consequences

- The two UIs cannot disagree about what happened.
- The reducer is testable without a terminal, a browser or an LLM;
  `bun run preview` drives the whole TUI from a scripted event stream.
- A front-end-only feature that needs derived state has to go through the
  reducer, which feels like indirection until the second front-end needs it.

## Review Triggers

Revisit if a third consumer needs a materially different aggregation, or if the
reducer starts carrying view state.
