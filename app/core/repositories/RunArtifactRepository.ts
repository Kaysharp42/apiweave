import type { KVStore, SqliteRow } from "../db"
import type { RunArtifactInput } from "../runner/executor"
import { generateId } from "../id"
import { getMapped, queryMapped } from "./helpers"

interface RunArtifactBodyRow extends SqliteRow {
  readonly run_id: string
  readonly mime: string
  readonly body: Buffer
}

interface RunArtifactRow extends SqliteRow {
  readonly id: string
  readonly node_id: string
  readonly kind: string
  readonly mime: string
  readonly size: number
  readonly createdAt: string
}

/** One artifact's metadata: what an evidence list shows, and no bytes. */
export interface RunArtifactSummary {
  readonly artifactId: string
  readonly nodeId: string
  readonly kind: string
  readonly mime: string
  readonly size: number
  readonly createdAt: string
}

/** One artifact's bytes, with the run that owns them. */
export interface RunArtifactBody {
  readonly runId: string
  readonly mime: string
  readonly body: Buffer
}

/**
 * A run's stored evidence files (migration 033): a failed browser step's
 * screenshot. Bodies are only ever read by id, so listing a run never loads an
 * image; rows disappear with their run through the foreign key cascade.
 */
export class RunArtifactRepository {
  public constructor(private readonly store: KVStore) {}

  public save(input: RunArtifactInput): string {
    const id = generateId()
    this.store.set(
      "INSERT INTO run_artifacts (id, run_id, node_id, kind, mime, body, size) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, input.runId, input.nodeId, input.kind, input.mime, input.body, input.body.length],
    )
    return id
  }

  /**
   * Bytes by their own id, with the run that owns them. A rerun copies a
   * failed step's result verbatim, so the pane holds a screenshot id from an
   * earlier run; the owning `runId` travels back with the bytes so the caller
   * can still check the artifact against the workspace it was asked for.
   */
  public get(artifactId: string): RunArtifactBody | undefined {
    return getMapped<RunArtifactBodyRow, RunArtifactBody>(
      this.store,
      "SELECT run_id, mime, body FROM run_artifacts WHERE id = ?",
      [artifactId],
      (row) => ({ runId: row.run_id, mime: row.mime, body: row.body }),
    )
  }

  public listForRun(runId: string): readonly RunArtifactSummary[] {
    return queryMapped<RunArtifactRow, RunArtifactSummary>(
      this.store,
      "SELECT id, node_id, kind, mime, size, createdAt FROM run_artifacts WHERE run_id = ? ORDER BY rowid ASC",
      [runId],
      (row) => ({
        artifactId: row.id,
        nodeId: row.node_id,
        kind: row.kind,
        mime: row.mime,
        size: row.size,
        createdAt: row.createdAt,
      }),
    )
  }
}
