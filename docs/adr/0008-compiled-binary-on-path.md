# 0008: Ship a Compiled Binary, Symlinked onto PATH

**Status:** accepted

## Context

`bun run src/cli.tsx <url>` works from the source tree and nowhere else.
Reaching for ymcprobe while debugging someone else's MCP server means it has to
be a command, and `bun link` or a global `bun install` still ties the command to
this checkout's dependencies.

`bun build --compile` produces a standalone binary, but two things stood in the
way: the browser client was bundled at runtime with `Bun.build()`, which needs a
source tree that a compiled binary does not have, and ink pulls
`react-devtools-core` through an import the bundler cannot be talked out of
([ink-behaviour.md](../research/ink-behaviour.md)).

## Decision

`make build` compiles a minified `./ymcprobe` (~61 MB). `make link` symlinks it
into `~/.local/bin`, and `make ship` is `build` then `link`. The Makefile
follows `fxstack/fxgit`: `BIN` / `ENTRY` / `BIN_DIR` variables, a single
`.PHONY` line, `help` as the default goal extracting `## ` comments, and
`install` / `build` / `link` / `ship` / `clean` meaning what they do there, so
every fx-style tool answers to the same verbs. `make install` installs
*dependencies* and does not touch PATH.

Two supporting changes were required:

- **The browser client is bundled by a build-time macro**, `src/bundle-client.ts`
  imported `with { type: "macro" }`. It shells out to `bun build` rather than
  calling `Bun.build()`, because a macro cannot start a second bundle while the
  bundler is waiting on it.
- **ink is patched to drop its React DevTools bridge**, via
  `patchedDependencies` in `package.json` and `patches/ink@6.8.0.patch`, which
  empties `ink/build/devtools.js`. A patch rather than a stub `file:` package or
  a `tsconfig` `paths` alias: both of those worked, and both leave behind either
  a phantom dependency or a file whose only purpose is to be resolved.

## Consequences

- `ymcprobe <url>` works from any directory.
- The symlink means a rebuild needs no reinstall. The flip side: `make clean`
  leaves the symlink dangling and the command is "command not found" until the
  next `make build`.
- The binary still needs `opencode` on PATH. It embeds ymcprobe, not the agent
  it drives.
- Two pieces of machinery, the macro and the patch, look like pointless
  indirection to anyone who has not hit the failures they exist for. Both are
  documented in the research record rather than in a comment.
- An ink bump breaks `bun install` until the patch is regenerated. That alarm is
  intended.
- 61 MB per build, and a 63 MB scratch file per run that `make build` sweeps
  itself.

## Review Triggers

Revisit if ink removes the devtools import rather than guarding it, which would
retire the patch, or if Bun's `--compile` learns to bundle imported assets
without a macro. Do not "fix" the patch by upgrading to ink 7: the build fails
identically and ink 7 renders nothing when stdout is piped.
