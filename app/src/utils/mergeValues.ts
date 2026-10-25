import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { GitMergePick } from "@shared/types/GitMergePick";
import type { JsonValue } from "@shared/types/JsonValue";
import type { ParsedValue } from "../types";

/**
 * How long a line of text may be before it is no longer edited in an input:
 * a body or a script is read and changed in Monaco, with the diff beside it.
 */
export const LONG_VALUE_TEXT_LENGTH = 120;

/** A value as the JSON text the editor edits. Text carries its quotes, so `42` and `"42"` stay different values. */
export function valueText(value: JsonValue): string {
  return JSON.stringify(value);
}

/** Whether a value is better edited and compared in Monaco: an object, an array, or a long or multiline string. */
export function isLongValue(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") {
    return value.length > LONG_VALUE_TEXT_LENGTH || value.includes("\n");
  }
  return typeof value !== "number" && typeof value !== "boolean";
}

/** Parse the editor's text as the value it names, with a sentence when it is not JSON. */
export function parseValueText(text: string): ParsedValue {
  try {
    return { value: JSON.parse(text) as JsonValue };
  } catch {
    return {
      error:
        "Not JSON. Text needs quotes, and numbers, true, false and null do not.",
    };
  }
}

/**
 * The value the merge would write at this conflict now: the pick's, or the
 * remote copy's value while nothing settles it — the same value the engine
 * stands on until a pick arrives.
 */
export function resolvedValue(
  conflict: GitMergeConflict,
  resolution: GitMergePick | undefined,
): JsonValue | undefined {
  if (resolution === undefined) return conflict.theirs;
  if ("value" in resolution) return resolution.value;
  return resolution.side === "ours" ? conflict.ours : conflict.theirs;
}
