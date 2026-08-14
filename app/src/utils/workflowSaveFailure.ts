import { ZodError } from "zod";
import type { SaveFailureEnvelope } from "../types/SaveFailureEnvelope";

/**
 * The reason a save was refused, read from a non-OK response body. The IPC
 * shim reports failures as `{ detail, code, details }`; a save that only says
 * "failed" costs a debugging session, so every part that names a cause is
 * worth reading — even though a malformed body must not mask the original
 * failure.
 */
export async function readSaveFailureEnvelope(
  response: Response,
): Promise<SaveFailureEnvelope> {
  try {
    const body = (await response.json()) as {
      readonly detail?: unknown;
      readonly code?: unknown;
      readonly details?: unknown;
    };
    const detail =
      typeof body.detail === "string" && body.detail.length > 0
        ? body.detail
        : undefined;
    const code = typeof body.code === "string" ? body.code : undefined;
    const envelope: SaveFailureEnvelope = {
      issues: readableZodIssues(body.details),
    };
    if (detail !== undefined) envelope.detail = detail;
    if (code !== undefined) envelope.code = code;
    return envelope;
  } catch {
    return { issues: [] };
  }
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
