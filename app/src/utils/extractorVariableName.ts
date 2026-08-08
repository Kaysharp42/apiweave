/**
 * Variable names are referenced as `{{variables.name}}`, so they are restricted
 * to the same identifier shape the substitution regex accepts.
 */
const VARIABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Shown wherever {@link isValidVariableName} rejects a non-empty name. */
export const INVALID_VARIABLE_NAME_MESSAGE =
  "Use letters, digits and underscores, starting with a letter.";

export function isValidVariableName(name: string): boolean {
  return VARIABLE_NAME_RE.test(name);
}

function toCamelSegment(segment: string, capitalize: boolean): string {
  const words = segment
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word, index) =>
      index === 0 && !capitalize
        ? word.charAt(0).toLowerCase() + word.slice(1)
        : word.charAt(0).toUpperCase() + word.slice(1),
    );
  return words.join("");
}

/**
 * Derives a variable name from a location in the response body.
 *
 * A bare leaf key is usually what the user wants (`id` -> `id`), but leaf keys
 * repeat across a payload, so once the plain name is taken the parent key is
 * folded in (`data.user.id` -> `userId`) before falling back to numbering.
 * Array indices never appear in the name -- `items[0].id` reads as `itemsId`.
 */
export function suggestVariableName(
  segments: ReadonlyArray<string | number>,
  takenNames: ReadonlyArray<string>,
): string {
  const keys = segments.filter(
    (segment): segment is string => typeof segment === "string",
  );
  const taken = new Set(takenNames);

  const candidates: string[] = [];
  for (let depth = 1; depth <= Math.min(keys.length, 3); depth++) {
    const name = keys
      .slice(keys.length - depth)
      .map((key, index) => toCamelSegment(key, index > 0))
      .join("");
    if (isValidVariableName(name)) candidates.push(name);
  }

  // With no usable key -- the body root, or an array element directly under it
  // -- the value is the body itself as far as a name is concerned.
  const fallback = candidates[candidates.length - 1] ?? "body";
  const firstFree = candidates.find((candidate) => !taken.has(candidate));
  if (firstFree) return firstFree;
  if (!taken.has(fallback)) return fallback;

  let suffix = 2;
  while (taken.has(`${fallback}${suffix}`)) suffix++;
  return `${fallback}${suffix}`;
}
