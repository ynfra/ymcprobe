// Build-time bundling of the browser client.
//
// Imported from web.ts with `{ type: "macro" }`, so this runs during the build
// and the result is inlined as a string literal. That is what makes
// `bun build --compile` work: a compiled binary has no source tree to read, so
// bundling the client lazily at runtime would fail the moment ymcprobe runs
// from anywhere but this directory.
//
// It shells out rather than calling Bun.build() directly, because a macro
// running inside the bundler cannot start a second bundle — the bundler is
// waiting on the macro while the macro waits on the bundler.

export function clientBundle(): string {
  const entry = new URL("./web-client.ts", import.meta.url).pathname
  const result = Bun.spawnSync(
    ["bun", "build", entry, "--target=browser", "--format=esm", "--minify"],
    { stdout: "pipe", stderr: "pipe" },
  )
  if (result.exitCode !== 0) {
    throw new Error(`web client bundle failed:\n${result.stderr.toString()}`)
  }
  return result.stdout.toString()
}
