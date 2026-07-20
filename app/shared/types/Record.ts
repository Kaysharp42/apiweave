/**
 * Base shape for syncable aggregate roots.
 *
 * Each aggregate carries its own identity field name (Workspace#workspaceId,
 * Workflow#workflowId, Run#runId, Environment#environmentId, Collection
 * #collectionId). Stable identity comes from `app/core/id.ts` (ULID),
 * which every repository uses when creating rows. This interface captures
 * only the change-provenance triple every aggregate root carries, so a
 * future sync engine (see `app/core/sync/SyncProvider.ts`) can read
 * `rev/createdAt/updatedAt` without per-aggregate special cases.
 *
 * Note: TS also has a built-in `Record<K, V>` utility type. Files that
 * consume sync records should import this via alias (e.g.
 * `import type { Record as RepositoryRecord } from "@shared/types/Record"`)
 * when both shapes are needed in the same scope.
 *
 * AGENTS.md: ONE-Type-Per-File rule — this lives alone in shared/types/Record.ts.
 */
export interface Record {
  readonly rev: number
  readonly createdAt: string
  readonly updatedAt: string
}
