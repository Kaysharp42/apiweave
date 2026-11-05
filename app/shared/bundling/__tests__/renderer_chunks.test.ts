import { describe, expect, it } from "vitest"
import { chunkForModule } from "../renderer_chunks"

const MODULES = "/work/app/node_modules"

describe("chunkForModule", () => {
  it("keeps a module outside node_modules unassigned", () => {
    expect(chunkForModule("/work/app/src/components/App.tsx")).toBeUndefined()
    expect(chunkForModule("/work/app/shared/git-merge/tree.ts")).toBeUndefined()
  })

  it("assigns each vendor dependency to the chunk of its package", () => {
    const expected: readonly (readonly [string, string])[] = [
      [`${MODULES}/react-dom/client.js`, "vendor-react-dom"],
      [`${MODULES}/scheduler/index.js`, "vendor-react-dom"],
      [`${MODULES}/react/jsx-runtime.js`, "vendor-react"],
      [`${MODULES}/react-router/dist/index.js`, "vendor-react"],
      [`${MODULES}/@xyflow/system/dist/esm/index.js`, "vendor-flow"],
      [`${MODULES}/d3-selection/src/index.js`, "vendor-flow"],
      [`${MODULES}/zustand/esm/index.js`, "vendor-flow"],
      [`${MODULES}/@floating-ui/dom/index.js`, "vendor-ui"],
      [`${MODULES}/@headlessui/tailwindcss/dist/index.js`, "vendor-ui"],
      [`${MODULES}/react-aria/dist/index.js`, "vendor-ui"],
      [`${MODULES}/allotment/dist/index.js`, "vendor-ui"],
      [`${MODULES}/sonner/dist/index.js`, "vendor-ui"],
      [`${MODULES}/lucide-react/dist/cjs/lucide-react.js`, "vendor-icons"],
      [`${MODULES}/zod/v4/index.js`, "vendor-zod"],
    ]
    for (const [id, chunk] of expected) expect(chunkForModule(id), id).toBe(chunk)
  })

  it("assigns Monaco's layers by their own directory, most specific first", () => {
    const monaco = `${MODULES}/monaco-editor/esm/vs`
    const expected: readonly (readonly [string, string])[] = [
      [`${monaco}/editor/browser/widget/diffEditor/diffEditor.js`, "monaco-diff"],
      [`${monaco}/editor/browser/widget/codeEditor/codeEditorWidget.js`, "monaco-code-editor"],
      [`${monaco}/editor/browser/widget/multiDiffEditor/multiDiffEditorWidget.js`, "monaco-multi-diff"],
      [`${monaco}/editor/browser/widget/overlayWidget.js`, "monaco-browser-widget"],
      [`${monaco}/editor/contrib/suggest/browser/suggestController.js`, "monaco-suggest"],
      [`${monaco}/editor/browser/viewParts/lineNumbers/lineNumbers.js`, "monaco-browser-view"],
      [`${monaco}/editor/browser/controller/textAreaHandler.js`, "monaco-browser-controller"],
      [`${monaco}/editor/browser/services/codeEditorService.js`, "monaco-browser-services"],
      [`${monaco}/editor/browser/editorBrowser.js`, "monaco-browser-rest"],
      [`${monaco}/editor/common/languages.js`, "monaco-common"],
      [`${monaco}/editor/standalone/browser/standaloneEditor.js`, "monaco-standalone"],
      [`${monaco}/base/browser/ui/button/button.js`, "monaco-base-ui"],
      [`${monaco}/base/browser/browser.js`, "monaco-base-browser"],
      [`${monaco}/base/common/lifecycle.js`, "monaco-base-common"],
      [`${monaco}/platform/registry/common/platform.js`, "monaco-platform"],
    ]
    for (const [id, chunk] of expected) expect(chunkForModule(id), id).toBe(chunk)
  })

  it("only splits Monaco's own ESM tree, not wrappers around it", () => {
    expect(chunkForModule(`${MODULES}/@monaco-editor/loader/lib/es/index.js`)).toBeUndefined()
    expect(chunkForModule(`${MODULES}/monaco-editor/esm/vs/editor/contrib/other.js`)).toBeUndefined()
  })

  it("takes the first matching boundary in the table, and the vendor rules before Monaco's", () => {
    // `@xyflow/react` matches the React needle first, which is why it travels with React.
    expect(chunkForModule(`${MODULES}/@xyflow/react/dist/esm/index.js`)).toBe("vendor-react")
    expect(chunkForModule(`${MODULES}/monaco-editor/esm/vs/base/common/react-router/index.js`)).toBe("vendor-react")
    expect(chunkForModule(`${MODULES}/some-package/node_modules/react-dom/index.js`)).toBe("vendor-react-dom")
  })
})
