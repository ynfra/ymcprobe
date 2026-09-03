# Architecture Decisions

These records explain durable choices and their trade-offs. They do not define
current behaviour: the README's command table and `--help` do that.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-opencode-as-the-engine.md) | Drive a spawned headless `opencode` rather than our own model plumbing | Accepted |
| [0002](0002-two-connections-per-server.md) | Connect to each server twice: a direct probe and opencode's own | Accepted |
| [0003](0003-one-reducer-computes-the-trace.md) | Compute the trace in one pure reducer; front-ends only render | Accepted |
| [0004](0004-plain-fetch-not-the-sdk.md) | Call opencode with plain `fetch` instead of its SDK | Accepted |
| [0005](0005-harness-prompt-and-muted-builtins.md) | Inject a harness system prompt and mute built-in tools by default | Accepted |
| [0006](0006-auto-approve-permissions.md) | Auto-approve permission prompts, in the process that owns the connection | Accepted |
| [0007](0007-web-ui-is-the-origin.md) | Serve the web UI from its own origin and proxy prompts and events | Accepted |
| [0008](0008-compiled-binary-on-path.md) | Ship a compiled binary, symlinked onto PATH | Accepted |

Research records supporting these decisions are evidence, not normative
documentation. Amend an ADR when its decision remains valid but its context
changes; supersede it when the decision changes.
