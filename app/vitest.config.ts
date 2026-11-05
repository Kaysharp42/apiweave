import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const sharedTestConfig = {
  globals: true,
  setupFiles: ["./src/__tests__/setup.ts"],
  // Type-level tests use tsc, not vitest — exclude from test runner
  exclude: [
    "**/node_modules/**",
    "**/dist/**",
    "**/.{idea,git,cache,output,temp}/**",
    "src/types/__tests__/types.test.ts",
  ],
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        test: {
          ...sharedTestConfig,
          name: "renderer",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
        },
      },
      {
        test: {
          ...sharedTestConfig,
          name: "desktop",
          environment: "node",
          include: [
            "core/**/*.test.ts",
            "electron/**/*.test.ts",
            "shared/**/*.test.ts",
          ],
          // These tests open real SQLite databases, HTTP fixtures and worker
          // threads. The 5s default is fine in isolation but races the file
          // scheduler on a loaded machine; the assertions still catch a hang.
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
