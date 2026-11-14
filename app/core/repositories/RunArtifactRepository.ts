import type { KVStore, SqliteRow } from "../db"
import type { RunArtifactInput } from "../runner/executor"
import { generateId } from "../id"
import { getMapped, queryMapped } from "./helpers"

interface RunArtifactBodyRow extends SqliteRow {
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

  /** Bytes bound to their run as well as their id, so one run's id never reads another's artifact. */
  public get(runId: string, artifactId: string): { readonly mime: string; readonly body: Buffer } | undefined {
    return getMapped<RunArtifactBodyRow, { readonly mime: string; readonly body: Buffer }>(
      this.store,
      "SELECT mime, body FROM run_artifacts WHERE run_id = ? AND id = ?",
      [runId, artifactId],
      (row) => ({ mime: row.mime, body: row.body }),
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
