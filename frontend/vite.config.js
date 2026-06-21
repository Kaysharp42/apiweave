import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import checker from "vite-plugin-checker";

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
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
}));
