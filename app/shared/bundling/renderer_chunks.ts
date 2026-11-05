/**
 * The renderer bundle's chunk boundaries, as `vite.config.js` assigns them.
 *
 * Vendor boundaries, not warning silencers: React, the flow engine and the UI
 * primitives change on their own release cadence, so keeping them in separate
 * content-hashed files means a renderer change does not invalidate a large
 * block of unchanged dependency code.
 *
 * Monaco is one dynamic import, but its core is 2.7 MB and every request body,
 * script and query waits on it. These boundaries follow Monaco's own layers —
 * editor/browser, editor/common, base, platform — so each file compiles in one
 * piece. Contributions deliberately stay in their module graph: splitting them
 * by size instead re-included roughly half a megabyte of features the editor
 * tree-shakes away.
 */

/**
 * Vendor boundaries in matching order: a module belongs in the chunk of the
 * first key its path contains. `scheduler` goes with React DOM because that is
 * the only thing that imports it.
 */
const VENDOR_CHUNKS: Readonly<Record<string, string>> = {
  "/react-dom/": "vendor-react-dom",
  "/scheduler/": "vendor-react-dom",
  "/react/": "vendor-react",
  "/react-router/": "vendor-react",
  "/@xyflow/": "vendor-flow",
  "/d3-": "vendor-flow",
  "/zustand/": "vendor-flow",
  "/@floating-ui/": "vendor-ui",
  "/@headlessui/": "vendor-ui",
  "/react-aria/": "vendor-ui",
  "/allotment/": "vendor-ui",
  "/sonner/": "vendor-ui",
  "/lucide-react/": "vendor-icons",
  "/zod/": "vendor-zod",
}

/**
 * Monaco's own layers, in matching order and most specific first: `diffEditor`
 * before the generic `widget/` boundary, and `base/browser/ui/` before
 * `base/browser/`. Only applied inside {@link MONACO_ESM}.
 */
const MONACO_CHUNKS: Readonly<Record<string, string>> = {
  "/editor/browser/widget/diffEditor/": "monaco-diff",
  "/editor/browser/widget/codeEditor/": "monaco-code-editor",
  "/editor/browser/widget/multiDiffEditor/": "monaco-multi-diff",
  "/editor/browser/widget/": "monaco-browser-widget",
  "/editor/contrib/suggest/": "monaco-suggest",
  "/editor/browser/viewParts/": "monaco-browser-view",
  "/editor/browser/controller/": "monaco-browser-controller",
  "/editor/browser/services/": "monaco-browser-services",
  "/editor/browser/": "monaco-browser-rest",
  "/editor/common/": "monaco-common",
  "/editor/standalone/": "monaco-standalone",
  "/base/browser/ui/": "monaco-base-ui",
  "/base/browser/": "monaco-base-browser",
  "/base/common/": "monaco-base-common",
  "/platform/": "monaco-platform",
}

const MONACO_ESM = "/monaco-editor/esm/vs/"

function chunkIn(id: string, chunks: Readonly<Record<string, string>>): string | undefined {
  for (const [needle, chunk] of Object.entries(chunks)) {
    if (id.includes(needle)) return chunk
  }
  return undefined
}

/** The vendor chunk a module belongs in, or undefined to let Rolldown place it. */
export function chunkForModule(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined
  const vendor = chunkIn(id, VENDOR_CHUNKS)
  if (vendor !== undefined) return vendor
  return id.includes(MONACO_ESM) ? chunkIn(id, MONACO_CHUNKS) : undefined
}
