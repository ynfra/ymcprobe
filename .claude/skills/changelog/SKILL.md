---
name: changelog
description: Update ymcprobe's CHANGELOG.md with command-facing changes since the last entry. Use after committing changes to flags, arguments, make targets or output, or when asked to update the changelog.
---

# Changelog

Maintain `CHANGELOG.md` in this directory. It records command-facing changes,
newest first, under `## v{YYYY}-{MM}-{DD}` headings.

## What counts

The command name, its flags and their defaults, the `name=url` server syntax,
the shape of `--json` output, the `make` targets, and what the trace shows are
public behaviour. Record:

- a flag, target or argument added, renamed, or removed
- a change to a default, a limit, or where output lands
- a change to what the trace reports or how calls are attributed
- an upgrade to the driving agent that changes what a run produces
- a change to the prerequisites, including what the compiled binary needs

Skip refactors, tests, docs, screenshots and internal restructuring with no
user-visible effect. When work changes nothing visible but readers may ask, one
line ending "No command behaviour change." is enough.

## Procedure

1. Find the newest heading in `CHANGELOG.md` and list commits since that date:
   `git log --since=<date> --format='%ad %h %s' --date=short -- .`
   (add `--until` when backfilling a gap).
2. For each candidate commit, confirm the visible effect in the diff; commit
   subjects alone mislead. `git show <sha>:ymcprobe/Makefile` is the quickest
   way to check what a target was called at the time.
3. Add or extend the `## v{YYYY}-{MM}-{DD}` section for each date that has
   command-facing changes, keeping the file newest first. Use the commit date,
   not today, when backfilling.
4. Verify every flag against `src/args.ts` and every target against the
   `Makefile` before writing it.

## Style

- One bullet per change. Flags, targets and names in backticks.
- Prefix renames and removals with "Breaking:" and give both old and new names.
- New flags read "New flag `--name`: what it does."
- A change shipped and reverted within the range still gets one line.
- No counts of things. See [.ytemplate/README.md](../../../../.ytemplate/README.md)
  for the prose rules.

Commit separately as `[ymcprobe] update the changelog`.
