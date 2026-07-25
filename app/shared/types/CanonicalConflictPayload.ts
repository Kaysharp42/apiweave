import type { JsonValue } from "./JsonValue"

/**
 * The canonical comparison form of a conflict payload.
 *
 * Both the local (incoming) and cloud (current) snapshots are mapped to this
 * single shape before any diff or merge runs, so the comparison is apples to
 * apples. Volatile metadata (`rev`, `updatedAt`) and per-surface identity
 * remaps (local vs cloud workspace/scope ids, desktop-only denormalized
 * fields) are normalized away; the remaining fields are the meaningful
 * structural comparison surface. See `canonicalizeSyncPayload` in
 * `../conflict-diff/canonicalize.ts`.
 */
export type CanonicalConflictPayload = { readonly [key: string]: JsonValue }