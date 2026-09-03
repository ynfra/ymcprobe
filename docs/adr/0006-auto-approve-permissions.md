# 0006: Auto-Approve Permission Prompts

**Status:** accepted

## Context

opencode asks for permission before some tool calls, arriving as
`permission.asked` on the event stream. A harness that stalls on that prompt
stalls the run, and in the browser UI there is no terminal to answer it in.

Forwarding the prompt to the user was the alternative. It would make ymcprobe
safe to point anywhere, at the cost of a decision on every call in a session
whose entire purpose is to call every tool once.

## Decision

Answer every `permission.asked` with an approval, in the process that owns the
opencode connection: `src/ui.tsx` for the TUI, `src/web.ts` for the browser,
`src/smoke.ts` for the headless check. Never in the browser client, which has
no direct connection to approve on.

The safety boundary is therefore the user's choice of target, stated in the
README: this is a test harness, so do not aim it at an MCP server whose tools
have real side effects.

## Consequences

- A "test every tool" run completes unattended.
- ymcprobe will happily call a destructive tool. There is no confirmation and
  no dry-run.
- Approval lives in three call sites, one per front-end owner, which must stay
  in step.

## Review Triggers

Revisit if ymcprobe is ever aimed at production servers as a normal workflow,
or if the trace becomes useful enough for non-test use that a per-tool
allowlist or a `--confirm` flag is worth the friction.
