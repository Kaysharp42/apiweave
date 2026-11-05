import { loader } from "@monaco-editor/react";
// The editor API, a curated set of editor features, and only the languages the
// app edits: JSON (request bodies, with its language service), JavaScript
// (request scripts) and GraphQL (queries) — highlighting only, each grammar a
// small chunk loaded on first use. `import "monaco-editor"` is the root entry,
// which adds ~80 grammars and the TypeScript, CSS and HTML language services, a
// 7 MB TypeScript worker among them. Since 0.56 the language contributions no
// longer pull editor features in as a side effect, and `features/register.all`
// pulls in roughly 60 contributions — diff breadcrumbs, GPU actions, inline
// completions, sticky scroll, inlay hints and more this app never turns on.
// The list below is the editing surface a request body, script and query
// actually use; adding one here is how a feature reaches the editor.
import * as monaco from "monaco-editor/editor";
import "monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget";
import "monaco-editor/features/codicon/register";
import "monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching";
import "monaco-editor/editor/contrib/clipboard/browser/clipboard";
import "monaco-editor/editor/contrib/comment/browser/comment";
import "monaco-editor/editor/contrib/contextmenu/browser/contextmenu";
import "monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo";
import "monaco-editor/editor/browser/widget/diffEditor/diffEditor.contribution";
import "monaco-editor/features/find/register";
import "monaco-editor/editor/contrib/folding/browser/folding";
import "monaco-editor/editor/contrib/format/browser/formatActions";
import "monaco-editor/editor/contrib/gotoError/browser/gotoError";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution";
import "monaco-editor/editor/contrib/indentation/browser/indentation";
import "monaco-editor/editor/contrib/linesOperations/browser/linesOperations";
import "monaco-editor/editor/contrib/multicursor/browser/multicursor";
import "monaco-editor/editor/contrib/placeholderText/browser/placeholderText.contribution";
import "monaco-editor/editor/contrib/smartSelect/browser/smartSelect";
import "monaco-editor/editor/contrib/snippet/browser/snippetController2";
import "monaco-editor/editor/contrib/suggest/browser/suggestController";
import "monaco-editor/editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode";
import "monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter";
import "monaco-editor/editor/contrib/wordOperations/browser/wordOperations";
import "monaco-editor/editor/contrib/wordPartOperations/browser/wordPartOperations";
import "monaco-editor/languages/features/json/register";
import "monaco-editor/languages/definitions/javascript/register";
import "monaco-editor/languages/definitions/graphql/register";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/languages/features/json/json.worker?worker";

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker(workerId: string, label: string): Worker;
    };
  }
}

// Bundle Monaco locally and feed the instance to @monaco-editor/loader so the
// renderer never fetches the editor from a CDN (default loader pulls
// https://cdn.jsdelivr.net/npm/monaco-editor@.../min/vs/loader.js). All worker
// entry points are bundled as Vite web workers and served from app://local.
window.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "json") {
      return new jsonWorker();
    }
    return new editorWorker();
  },
};

loader.config({ monaco });