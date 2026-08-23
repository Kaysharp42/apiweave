/**
 * Severity of one log record, ordered least to most severe. The four levels
 * are the whole contract: trace/verbose variants were deliberately left out
 * because nothing in the app needed them.
 */
export type LogLevel = "debug" | "info" | "warn" | "error"
