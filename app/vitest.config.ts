import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [["src/**", "jsdom"]],
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: [
      "src/**/*.test.{ts,tsx}",
      "core/**/*.test.ts",
      "electron/**/*.test.ts",
      "shared/**/*.test.ts",
    ],
    // Type-level tests use tsc, not vitest — exclude from test runner
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
      "src/types/__tests__/types.test.ts",
    ],
  },
});
