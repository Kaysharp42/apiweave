/* eslint-disable no-console -- the fallback sink *is* the console by definition; these two logging files are the only places allowed to touch it */
import type {} from "electron-log/renderer"
import type { LogLevel, Logger } from "@shared/types/Logger"

/**
 * Renderer-side logger in the same SLF4J style as the main process:
 * `getLogger("SidebarStore").warn(...)`.
 *
 * Records travel over electron-log's IPC bridge into the same daily file the
 * main process writes: `log.initialize()` in the main process injects a
 * session preload exposing `window.__electronLog`, and this module hands it
 * records directly rather than importing electron-log's renderer bundle (its
 * Proxy-based export is hostile to bundler interop and buys nothing here).
 *
 * When the bridge is absent — plain vitest/jsdom runs, or a renderer frame
 * that loaded before the injected preload did — records fall back to the
 * browser console with a `[name]` tag, so tests stay readable and nothing is
 * silently dropped. Anything printed that way is mirrored back into the files
 * anyway by the main process' renderer-console spy. Either route tags the
 * message with the logger's name, because the bridge carries no scope field.
 */
export function getLogger(name: string): Logger {
  const write =
    (level: LogLevel): ((message: string, ...data: unknown[]) => void) =>
    (message, ...data) => {
      const tagged = `[${name}] ${message}`
      const bridge = typeof window === "object" ? window.__electronLog : undefined
      if (bridge !== undefined) {
        bridge[level](tagged, ...data)
        return
      }
      console[level](tagged, ...data)
    }

  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
  }
}
