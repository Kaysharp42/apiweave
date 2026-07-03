import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import checker from "vite-plugin-checker";

const proxy = {
  "/api": {
    target: process.env.BACKEND_INTERNAL_URL || "http://localhost:8000",
    changeOrigin: true,
  },
  "/mcp": {
    target: process.env.BACKEND_INTERNAL_URL || "http://localhost:8000",
    changeOrigin: true,
  },
};

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    command === "serve"
      ? checker({
          typescript: true,
        })
      : null,
  ].filter(Boolean),
  server: {
    port: 3000,
    host: true,
    allowedHosts: process.env.FRONTEND_ALLOWED_HOST
      ? [process.env.FRONTEND_ALLOWED_HOST]
      : undefined,
    proxy,
  },
  preview: {
    port: 3000,
    host: true,
    allowedHosts: process.env.FRONTEND_ALLOWED_HOST
      ? [process.env.FRONTEND_ALLOWED_HOST]
      : undefined,
    proxy,
  },
}));
