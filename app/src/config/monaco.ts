import { loader } from "@monaco-editor/react";
// The editor API, every editor feature, and only the languages the app edits:
// JSON (request bodies, with its language service), JavaScript (request
// scripts) and GraphQL (queries) — highlighting only, each grammar a small
// chunk loaded on first use. `import "monaco-editor"` is the root entry, which
// adds ~80 grammars and the TypeScript, CSS and HTML language services, a
// 7 MB TypeScript worker among them. Since 0.56 the language contributions no
// longer pull editor features in as a side effect, so `features/register.all`
// is what registers the suggest widget, hover, find and the rest.
import * as monaco from "monaco-editor/editor";
import "monaco-editor/features/register.all";
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