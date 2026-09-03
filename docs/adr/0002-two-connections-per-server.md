# 0002: Two Independent MCP Connections per Server

**Status:** accepted

## Context

Once opencode holds a connection to the server under test, a second connection
from ymcprobe looks redundant. It is not, for two reasons.

opencode cannot be asked what a server advertises: `/experimental/tool` lists
built-ins only, and MCP tools are injected at prompt time
([opencode-server.md](../research/opencode-server.md)). An inventory has to
come from somewhere else.

And a dead URL discovered after the 3-5 s opencode boot is a slow failure for
something that is really a typo.

## Decision

Talk to each server twice, deliberately:

- A direct streamable-HTTP MCP client (`src/mcp.ts`) does `initialize` plus
  `tools/list`. This runs first, before opencode is spawned, and produces both
  the tool inventory and the reachability check.
- opencode holds the connection the model uses.

The direct probe is what the server *advertises*; the opencode connection is
what the model *does with it*. When the two disagree, that gap is the finding
the tool exists to report, so the UI shows opencode's own connection status
next to our inventory rather than assuming they agree.

An unreachable server is a warning, not a fatal error. ymcprobe starts as long
as one server answers and shows the rest as failed.

## Consequences

- A typo fails in milliseconds instead of after a boot.
- The sidebar can list advertised tools the model never called, which is the
  most useful signal in the UI: usually a description problem, not a wiring
  problem.
- Two connections mean two chances to disagree about auth headers, and headers
  have to be passed to both.
- `--json` needs no opencode at all, so dumping an inventory costs nothing.

## Review Triggers

Revisit if opencode exposes the MCP tools it has connected, which would make
the direct client redundant for the inventory, though not for the fast
reachability check.
