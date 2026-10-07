import { loader } from "@monaco-editor/react";
// The editor API plus JSON, the only language any editor in the app uses (the
// contribution brings the editor's own features with it). `import
// "monaco-editor"` is editor.main, which adds ~80 grammars and the TypeScript,
// CSS and HTML language services, a 7 MB TypeScript worker among them.
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/language/json/monaco.contribution.js";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

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