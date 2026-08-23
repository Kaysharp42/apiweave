/**
 * A named logger in the SLF4J style: code asks for a logger by name
 * (`getLogger("cloud-sync")`) and every record it writes is tagged with that
 * name, a timestamp and the level by whatever backend is bound at startup —
 * electron-log's daily file transport in the packaged app, the browser console
 * in tests. Callers never know which.
 */
export interface Logger {
  debug: (message: string, ...data: unknown[]) => void
  info: (message: string, ...data: unknown[]) => void
  warn: (message: string, ...data: unknown[]) => void
  error: (message: string, ...data: unknown[]) => void
}
