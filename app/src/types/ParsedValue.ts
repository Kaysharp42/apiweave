import type { JsonValue } from "@shared/types/JsonValue";

/** What an editor's text came to: the JSON value it holds, or why it is not one. */
export type ParsedValue =
  | { readonly value: JsonValue }
  | { readonly error: string };
