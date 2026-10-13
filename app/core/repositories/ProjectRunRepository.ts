import type { KVStore, SqliteRow } from "../db"
import { PROJECT_RUN_HISTORY_RETENTION_PER_PROJECT } from "../db"
import type { ProjectRun } from "@shared/types/ProjectRun"
import type { ProjectRunItem } from "@shared/types/ProjectRunItem"
import { generateId } from "../id"
import { getMapped, insertAndRead, parseJson, queryMapped, toJson } from "./helpers"

export interface ProjectRunCreate {
  readonly projectId: string
  readonly environmentId: string | null
  readonly items: readonly ProjectRunItem[]
}

const COLUMNS = "id, project_id, environment_id, status, items_json, startedAt, finishedAt"
const TERMINAL: ReadonlySet<ProjectRun["status"]> = new Set(["completed", "failed", "cancelled", "interrupted"])

interface ProjectRunRow extends SqliteRow {
  readonly id: string
  readonly project_id: string
  readonly environment_id: string | null
  readonly status: string
  readonly items_json: string
  readonly startedAt: string
  readonly finishedAt: string | null
}

export class ProjectRunRepository {
  public constructor(private readonly store: KVStore) {}

  /** A project run starts `running`: it is created at the moment its first workflow is enqueued. */
  public create(input: ProjectRunCreate): ProjectRun {
    const id = generateId()
    return insertAndRead(
      this.store,
      "INSERT INTO project_runs (id, project_id, environment_id, status, items_json, startedAt) VALUES (?, ?, ?, 'running', ?, ?)",
      [id, input.projectId, input.environmentId, toJson(input.items), new Date().toISOString()],
      () => this.getById(id),
      `project run ${id} missing after insert`,
    )
  }

  public getById(projectRunId: string): ProjectRun | undefined {
    return getMapped(this.store, `SELECT ${COLUMNS} FROM project_runs WHERE id = ?`, [projectRunId], rowToProjectRun)
  }

  /** Newest first. Retention keeps this bounded per project. */
  public listByProject(projectId: string): readonly ProjectRun[] {
    return queryMapped(
      this.store,
      `SELECT ${COLUMNS} FROM project_runs WHERE project_id = ? ORDER BY startedAt DESC, id DESC`,
      [projectId],
      rowToProjectRun,
    )
  }

  public listNonTerminal(): readonly ProjectRun[] {
    return queryMapped(
      this.store,
      `SELECT ${COLUMNS} FROM project_runs WHERE status IN ('pending', 'running')`,
      [],
      rowToProjectRun,
    )
  }

  /**
   * Write the current status and items. A terminal status stamps `finishedAt`
   * and prunes the project's older finished runs past the retention cap.
   */
  public update(projectRunId: string, status: ProjectRun["status"], items: readonly ProjectRunItem[]): ProjectRun | undefined {
    const terminal = TERMINAL.has(status)
    this.store.transaction((tx) => {
      tx.set("UPDATE project_runs SET status = ?, items_json = ?, finishedAt = ? WHERE id = ?", [
        status,
        toJson(items),
        terminal ? new Date().toISOString() : null,
        projectRunId,
      ])
      if (terminal) {
        tx.delete(
          "DELETE FROM project_runs WHERE project_id = (SELECT project_id FROM project_runs WHERE id = ?) " +
            "AND status IN ('completed', 'failed', 'cancelled', 'interrupted') AND id NOT IN " +
            "(SELECT id FROM project_runs WHERE project_id = (SELECT project_id FROM project_runs WHERE id = ?) " +
            "ORDER BY startedAt DESC, id DESC LIMIT ?)",
          [projectRunId, projectRunId, PROJECT_RUN_HISTORY_RETENTION_PER_PROJECT],
        )
      }
    })
    return this.getById(projectRunId)
  }
}

function rowToProjectRun(row: ProjectRunRow): ProjectRun {
  return {
    projectRunId: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    status: row.status as ProjectRun["status"],
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    items: parseJson<ProjectRunItem[]>(row.items_json),
  }
}
