# 0004: Plain `fetch` Instead of `@opencode-ai/sdk`

**Status:** accepted

## Context

opencode publishes a TypeScript SDK for its server API. Using it is the default
choice and removes the need to hand-write request shapes.

The endpoints ymcprobe needs are few: providers, session creation,
`prompt_async`, runtime MCP registration, a permission reply, and the `/event`
SSE stream. All of them were pinned against the server's own OpenAPI document,
`GET /doc` on a running instance, which stays the fastest way to re-check a
contract after a bump ([opencode-server.md](../research/opencode-server.md)).

## Decision

Call the server with plain `fetch` from a small typed client in
`src/opencode.ts`. Do not depend on `@opencode-ai/sdk`.

## Consequences

- One fewer version-coupled dependency, for roughly thirty lines of wrapper
  code. Runtime dependencies stay at `ink` and `react`.
- A contract change lands as a runtime error in our own file rather than as an
  install-time version conflict, and `GET /doc` is the check.
- Nothing warns at build time when an endpoint moves. `make smoke` is the net.

## Review Triggers

Revisit if ymcprobe starts needing a broad slice of the API rather than a
handful of endpoints, or if opencode ships breaking API changes often enough
that hand-written shapes cost more than the dependency would.
