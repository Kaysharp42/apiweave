import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import checker from "vite-plugin-checker";
import { chunkForModule } from "./shared/bundling/renderer_chunks.ts";

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
        // Which module goes in which vendor file is the ordered table in
        // shared/bundling/renderer_chunks.ts (and its test); this is the wiring.
        manualChunks: chunkForModule,
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
