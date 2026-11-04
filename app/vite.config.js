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
        // Vendor boundaries, not a warning silencer: React, the flow engine and
        // the UI primitives change on their own release cadence, so keeping
        // them in separate content-hashed files means a renderer change does
        // not invalidate 1.5 MB of unchanged dependency code.
        //
        // Monaco is one dynamic import whose core is 2.7 MB. The ceiling below
        // splits it into on-demand chunks the browser can compile
        // incrementally; the editor still loads all of them the first time it
        // opens, but no single file has to be parsed in one go, and this is
        // applied to real module boundaries rather than to the warning limit.
        // The app entry itself is under the limit because the canvas, screens
        // and dialogs are loaded on demand.
        codeSplitting: {
          groups: [
            {
              name: "vendor-react-dom",
              test: /node_modules[\\/](react-dom|scheduler)[\\/]/,
              priority: 30,
            },
            {
              name: "vendor-react",
              test: /node_modules[\\/](react|react-router)[\\/]/,
              priority: 30,
            },
            {
              name: "vendor-flow",
              test: /node_modules[\\/](@xyflow|d3-|zustand)[\\/]/,
              priority: 30,
            },
            {
              name: "vendor-ui",
              test: /node_modules[\\/](@floating-ui|@headlessui|react-aria|allotment|sonner)[\\/]/,
              priority: 30,
            },
            {
              name: "vendor-icons",
              test: /node_modules[\\/]lucide-react[\\/]/,
              priority: 30,
            },
            {
              name: "vendor-zod",
              test: /node_modules[\\/]zod[\\/]/,
              priority: 30,
            },
            {
              name: "monaco",
              test: /node_modules[\\/]monaco-editor[\\/]esm[\\/]vs[\\/]/,
              maxSize: 1280 * 1024,
              minSize: 16 * 1024,
              priority: 20,
            },
          ],
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
