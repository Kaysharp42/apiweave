import { HarnessError } from "./harness-error";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonValue(value: unknown, path: string): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => parseJsonValue(item, path) ?? null);
  }
  if (!isRecord(value)) {
    throw new HarnessError("fixture_validation", `Validation error in ${path}: value is not JSON-compatible`);
  }
  const out: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = parseJsonValue(value[key], path) ?? null;
  }
  return out;
}

export function diffJson(expected: JsonValue, actual: JsonValue, path: string): readonly string[] {
  if (Object.is(expected, actual)) {
    return [];
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const count = Math.max(expected.length, actual.length);
    return Array.from({ length: count }, (_item, index) =>
      diffJson(expected[index] ?? null, actual[index] ?? null, `${path}[${index}]`),
    ).flat();
  }
  if (isRecord(expected) && isRecord(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    return [...keys].sort().flatMap((key) => diffJson(expected[key] ?? null, actual[key] ?? null, `${path}.${key}`));
  }
  return [`${path}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`];
}
