// Stub for ink's optional React DevTools bridge.
//
// ink's reconciler does `await import('./devtools.js')` behind an
// `isDev()` guard, and that module statically imports `react-devtools-core`.
// The guard is a function call, so no bundler can prove the branch is dead:
//
//   --external  keeps it as a runtime import, and a `bun build --compile`
//               binary resolves those eagerly at startup, so it throws
//               "Cannot find package 'react-devtools-core'" before main runs
//   --define    misses it, because ink reads process.env['DEV'] with bracket
//               notation
//
// So the import has to resolve to *something*. This is that something: a few
// bytes instead of pulling the real ~10 MB package into the binary for a
// branch ymcprobe never takes. Set DEV=true and you get no devtools, which is
// the intended trade.

export default {
  initialize() {},
  connectToDevTools() {},
}
