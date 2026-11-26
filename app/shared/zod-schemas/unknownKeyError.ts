/**
 * A strict object's unknown-key error, made answerable: zod's default says only
 * "Unrecognized key: \"nodeId\"", which names the key but not what this tool
 * takes instead. Keys an agent reaches for that this tool spells differently
 * (a removed name, a role-specific sibling) get a per-key hint sentence. Pass
 * the result as `z.strictObject(shape, { error: … })` — the object schema is
 * the one that raises `unrecognized_keys`, so this never touches a property's
 * own errors. The issue parameter is the minimal structural shape, so the
 * function satisfies zod's narrowed per-schema error-map types.
 */
export function unknownKeyError(hints: Readonly<Record<string, string>>): (issue: { readonly code: string; readonly keys?: unknown }) => string {
  return (issue) => {
    if (issue.code !== "unrecognized_keys" || !Array.isArray(issue.keys)) return "Invalid request shape."
    const keys = issue.keys as readonly unknown[]
    const named = keys.map((key) => `"${String(key)}"`).join(", ")
    const hint = keys
      .flatMap((key) => {
        const message = hints[String(key)]
        return message === undefined ? [] : [message]
      })
      .join(" ")
    return `Unrecognized key${keys.length === 1 ? "" : "s"} ${named}.${hint === "" ? "" : ` ${hint}`}`
  }
}
