import type { JsonValue } from "@shared/types/JsonValue";
import { valueText } from "./mergeValues";

/** A value as the text its editor holds: a text value as itself, anything else as JSON. */
export function draftTextOf(value: JsonValue | undefined, textValue: boolean): string {
  if (textValue) return typeof value === "string" ? value : "";
  return value === undefined ? "" : valueText(value);
}
