import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import checker from "vite-plugin-checker";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
);

export default defineConfig(({ command }) => ({
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
