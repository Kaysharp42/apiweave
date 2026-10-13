import { ZodError } from "zod";
import type { SaveFailureEnvelope } from "../types/SaveFailureEnvelope";
import type { IpcError } from "./apiweaveClient";

/**
 * The reason a save was refused, read from the IPC error. A save that only
 * says "failed" costs a debugging session, so every part that names a cause is
 * worth reading: the message, the contract code, and the zod issues the
 * handler attached when the request failed input validation.
 */
export function readSaveFailure(error: IpcError): SaveFailureEnvelope {
  const envelope: SaveFailureEnvelope = {
    code: error.code,
    issues: readableZodIssues(error.details),
  };
  if (error.message.length > 0) envelope.detail = error.message;
  return envelope;
}

/**
 * The most specific sentence a thrown error offers, or undefined. A zod
 * failure names the exact field (`nodes.3.config.url: expected string`); any
 * other error falls back to its message. Returning undefined keeps the
 * caller's generic toast as the last resort rather than printing "unknown".
 */
export function describeThrownSaveError(error: unknown): string | undefined {
  if (error instanceof ZodError) {
    const first = readableZodIssues(error.issues)[0];
    return first === undefined
      ? "workflow data failed validation"
      : `workflow data failed validation — ${first}`;
  }
  return error instanceof Error && error.message.length > 0
    ? error.message
    : undefined;
}

/** Flatten zod issues into `path: message` lines, in issue order. */
function readableZodIssues(details: unknown): string[] {
  if (!Array.isArray(details)) return [];
  const issues: string[] = [];
  for (const issue of details) {
    if (typeof issue !== "object" || issue === null) continue;
    const candidate = issue as {
      readonly path?: unknown;
      readonly message?: unknown;
    };
    const path = Array.isArray(candidate.path)
      ? candidate.path.map((part) => String(part)).join(".")
      : undefined;
    if (typeof candidate.message !== "string" || candidate.message.length === 0) {
      continue;
    }
    issues.push(path ? `${path}: ${candidate.message}` : candidate.message);
  }
  return issues;
}
