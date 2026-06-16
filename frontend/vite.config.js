import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import checker from 'vite-plugin-checker'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function fixLibsodiumEsm() {
  return {
    name: 'fix-libsodium-esm',
    resolveId(source, importer) {
      if (
        source === './libsodium.mjs' &&
        importer &&
        importer.includes('libsodium-wrappers')
      ) {
        return resolve(
          __dirname,
          'node_modules/libsodium/dist/modules/libsodium.js',
        )
      }
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [
    fixLibsodiumEsm(),
    react(),
    command === 'serve'
      ? checker({
          typescript: true,
        })
      : null,
  ].filter(Boolean),
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
}))
