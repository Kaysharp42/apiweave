import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
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