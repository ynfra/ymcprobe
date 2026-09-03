# Changelog

Command-facing changes, newest first. The command name, its flags, the server
naming syntax and the `make` targets are public behaviour; a rename breaks
whoever scripted the old name.

## v2026-08-31

- The binary is built to `./ymcprobe` in the component root and `make link`
  symlinks that path, so a rebuild needs no relink.
- Breaking: `make distribute` renamed to `make ship`, aligning the Makefile
  with `fxstack/fxgit`: `install` / `build` / `link` / `ship` / `clean` now mean
  there what they mean here.
- New target `make clean`: removes the compiled binary and the build scratch.
  `make distclean` shipped alongside it and was dropped the same day.
- `make build` sweeps the `.bun-build` scratch file that `bun build --compile`
  leaves behind on every run.
- ink's React DevTools bridge is dropped with a patch instead of a stub
  `react-devtools-core` package, which leaves no phantom dependency. An ink
  bump now fails `bun install` until the patch is regenerated. No command
  behaviour change.

## v2026-08-30

- First release. TUI chat against a remote MCP server, showing every tool call
  with its arguments, result and latency.
- Breaking: the command is renamed from `ymcptest` to `ymcprobe`.
- Several servers per run, named from the host or explicitly as `name=url`;
  calls are attributed and grouped per server.
- New flag `--web`: the same session and trace in a browser page, on the agent
  port plus one.
- New flags `--system` and `--no-system`: replace or drop the system prompt
  that tells the model this is a test harness. Without it the model answers
  from memory and the trace stays empty.
- New flag `--all-tools`: keep the driving agent's built-in tools, which are
  muted by default so everything in the trace comes from a server under test.
- New flag `--json`: print every server's advertised tools and exit, without
  starting the driving agent.
- New flag `--models`, and `--model` now accepts a bare id, a unique substring
  or `provider/model`. An ambiguous choice is an error rather than a guess, and
  a model that cannot call tools is flagged in the header.
- The sidebar reports call count and average latency per advertised tool,
  including the tools the model never called.
- An unreachable server is a warning rather than a fatal error; the session
  starts as long as one server answers.
- New `Makefile` whose default target is the help, wrapping the common paths as
  `make run` / `web` / `json` / `fixture` / `preview` / `smoke`.
- `make build` compiles a standalone binary and `make link` symlinks it onto
  PATH. The binary still needs `opencode` on PATH.
- Breaking: `make install` installs dependencies and no longer touches PATH;
  installing onto PATH is `make link`, and `make deps` is gone.
