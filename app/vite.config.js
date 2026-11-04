import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import checker from "vite-plugin-checker";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
);

export default defineConfig(({ command, mode }) => ({
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    command === "serve"
      ? checker({
          typescript: true,
        })
      : null,
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  build: {
    outDir: "dist/renderer",
    ...(mode === "development" ? { minify: false, sourcemap: true } : {}),
    rolldownOptions: {
      output: {
        // Vendor boundaries, not warning silencers: React, the flow engine and
        // the UI primitives change on their own release cadence, so keeping
        // them in separate content-hashed files means a renderer change does
        // not invalidate a large block of unchanged dependency code.
        //
        // Monaco is one dynamic import, but its core is 2.7 MB and every
        // request body, script and query waits on it. These boundaries follow
        // Monaco's own layers — editor/browser, editor/common, base, platform —
        // so each file compiles in one piece. Contributions deliberately stay
        // in their module graph: splitting them by size instead re-included
        // roughly half a megabyte of features the editor tree-shakes away.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          if (id.includes("/react-dom/") || id.includes("/scheduler/")) {
            return "vendor-react-dom";
          }
          if (id.includes("/react/") || id.includes("/react-router/")) {
            return "vendor-react";
          }
          if (
            id.includes("/@xyflow/") ||
            id.includes("/d3-") ||
            id.includes("/zustand/")
          ) {
            return "vendor-flow";
          }
          if (
            id.includes("/@floating-ui/") ||
            id.includes("/@headlessui/") ||
            id.includes("/react-aria/") ||
            id.includes("/allotment/") ||
            id.includes("/sonner/")
          ) {
            return "vendor-ui";
          }
          if (id.includes("/lucide-react/")) return "vendor-icons";
          if (id.includes("/zod/")) return "vendor-zod";

          if (!id.includes("/monaco-editor/esm/vs/")) return undefined;
          if (id.includes("/editor/browser/widget/diffEditor/")) {
            return "monaco-diff";
          }
          if (id.includes("/editor/browser/widget/codeEditor/")) {
            return "monaco-code-editor";
          }
          if (id.includes("/editor/browser/widget/multiDiffEditor/")) {
            return "monaco-multi-diff";
          }
          if (id.includes("/editor/browser/widget/")) {
            return "monaco-browser-widget";
          }
          if (id.includes("/editor/contrib/suggest/")) return "monaco-suggest";
          if (id.includes("/editor/browser/viewParts/")) {
            return "monaco-browser-view";
          }
          if (id.includes("/editor/browser/controller/")) {
            return "monaco-browser-controller";
          }
          if (id.includes("/editor/browser/services/")) {
            return "monaco-browser-services";
          }
          if (id.includes("/editor/browser/")) return "monaco-browser-rest";
          if (id.includes("/editor/common/")) return "monaco-common";
          if (id.includes("/editor/standalone/")) return "monaco-standalone";
          if (id.includes("/base/browser/ui/")) return "monaco-base-ui";
          if (id.includes("/base/browser/")) return "monaco-base-browser";
          if (id.includes("/base/common/")) return "monaco-base-common";
          if (id.includes("/platform/")) return "monaco-platform";
          return undefined;
        },
      },
    },
  },
  server: {
    port: 3000,
    host: "127.0.0.1",
    strictPort: true,
  },
  preview: {
    port: 3000,
    host: "127.0.0.1",
    strictPort: true,
  },
}));
