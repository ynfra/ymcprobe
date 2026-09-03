# ink 6.8.0

Observed behaviour of `ink`, the React renderer behind the TUI. Three separate
problems: keystrokes it drops, widths it lies about, and a dev-only import that
blocks a compiled binary. All measured against ink 6.8.0 with react 19 on bun,
2026-08-30 and 2026-08-31. ink 7.1.1 was measured too, and is worse here.

## Findings

### Terminal input

`ink-text-input` loses keystrokes, for two reasons:

- **Ink only sets `key.backspace` / `key.delete` when a rub-out arrives alone
  in its own read.** Held down or pasted, the chunk arrives as raw `0x7f` bytes
  with **no key flag at all**, so the `input` string has to be walked character
  by character.
- **`useInput`'s callback closes over the value from its render.** Two events
  landing before React re-renders both see the same text, and one deletion is
  lost. A ref updated synchronously keeps them composing.

### Layout

- **Wrapping to `stdout.columns` produces ragged output when piped.** `columns`
  reports a width Ink does not use, Ink shrinks the box to the real terminal,
  and then re-wraps already-wrapped lines into thirds. `measureElement` on a
  `flexGrow` box is the only width worth trusting.
- **`<Text>{""}</Text>` collapses to nothing.** A blank separator line needs a
  single space.

### The devtools import

ink's reconciler does `await import('./devtools.js')` behind an `isDev()`
guard. The guard is a function call, so the branch is never provably dead and
the bundler always walks into `devtools.js`, whose `react-devtools-core` import
is the only reason that package is ever referenced. Every way round it was
measured, and all of them fail:

| Attempt | Result |
|---|---|
| just remove the dependency | `Could not resolve: "react-devtools-core"`, no binary |
| `--external react-devtools-core` | builds; binary dies at startup with `Cannot find package` |
| `--external './devtools.js'` | still resolves the inner import |
| `--define process.env.DEV="false"` | missed: ink reads `process.env['DEV']` with bracket notation |
| `--allow-unresolved '*'` | only covers dynamic specifiers, this one is static |
| `--conditions production` | no effect |

**ink 7 does not fix it.** It guards the import with `import.meta.resolve` in a
try/catch, but the bundler still walks into `devtools.js` and the build fails
identically. Worse, **ink 7 renders nothing when stdout is piped**: the same
scripted preview produced 190 lines on 6.8.0 and 0 on 7.1.1, which silently
kills `bun run preview | …`.

### Compiled output

**`bun build --compile` leaves a 63 MB `.<hash>-00000000.bun-build` scratch
file behind on every single run.** They are gitignored and invisible; this tree
had accumulated ten of them, 718 MB, before anyone looked.

## Implications

- `src/input.tsx` exists instead of `ink-text-input`, walks `input`
  character by character, and holds the current value in a ref.
- `src/ui.tsx` wraps to a measured width and uses a single space for blank
  lines.
- ink is pinned and patched: `patchedDependencies` in `package.json` plus
  `patches/ink@6.8.0.patch`, which empties `ink/build/devtools.js`. A patch
  rather than a stub package or a `tsconfig` `paths` alias, because those leave
  a phantom dependency or a file whose only purpose is to be resolved
  ([ADR 0008](../adr/0008-compiled-binary-on-path.md)).
- `make build` deletes the scratch files itself rather than leaving them to
  `make clean`.
- `bun run preview` renders the whole layout from a scripted event stream, so
  layout changes can be checked with no LLM spend, and piping it is the ink 7
  canary.

## Limitations

- Measured on macOS with bun, in one terminal. The rub-out byte handling is
  terminal-dependent and other terminals may differ in which reads coalesce.
- The 190-line preview count is specific to the current scripted stream; it is
  a canary for "renders at all", not a golden output.
- ink 7.1.1 was evaluated only far enough to establish that both problems above
  persist.

## Review triggers

On an ink bump `bun install` fails because the patch no longer applies. **That
is the intended alarm, not a problem.** Regenerate with `bun patch ink`, empty
`build/devtools.js`, `bun patch --commit ink`, then re-check
`bun run preview | wc -l` against 190. Re-measure the input handling if ink
changes how `useInput` reports rub-outs, and re-check the devtools chain if ink
ever removes the import rather than guarding it.
