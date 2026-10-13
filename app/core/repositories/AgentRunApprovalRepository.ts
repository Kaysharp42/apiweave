// fallow-ignore-file code-duplication -- the row interface and COLUMNS projection restate the table verbatim, exactly the shape every sibling repository carries: that mirroring is the convention (persistence models and SQLite rows intentionally track each other), not behaviour to extract, and a generic base repository is the abstraction this codebase deliberately does without. Two clone groups land on different line ranges and fallow 2.104 has no range form, so file-level is the narrowest marker available.
import type { KVStore, SqliteRow } from "../db"
import type { AgentRunApproval } from "@shared/types/AgentRunApproval"
import { generateId } from "../id"
import { getMapped, mustExist, parseJson, queryMapped, toJson } from "./helpers"

/** Identifies the exact run description an approval stands for. */
export interface AgentRunApprovalLookup {
  readonly workspaceId: string
  readonly agent: string
  readonly workflowId: string
  /** Secret names, destinations and script presence, reduced to one stable string. */
  readonly fingerprint: string
}

export type AgentRunApprovalCreate = AgentRunApprovalLookup &
  Pick<AgentRunApproval, "workflowName" | "secretNames" | "destinations" | "runsScripts">

const COLUMNS =
  "id, workspace_id, agent, workflow_id, workflow_name, fingerprint, secret_names, destinations, runs_scripts, createdAt"

interface AgentRunApprovalRow extends SqliteRow {
  readonly id: string
  readonly workspace_id: string
  readonly agent: string
  readonly workflow_id: string
  readonly workflow_name: string
  readonly fingerprint: string
  readonly secret_names: string
  readonly destinations: string
  readonly runs_scripts: number
  readonly createdAt: string
}

/**
 * The "Never ask again" answers. One row is one shape the user approved for
 * good; `find` is the scheduler's lookup before it asks, and Settings > MCP
 * Server lists and deletes rows here.
 */
export class AgentRunApprovalRepository {
  public constructor(private readonly store: KVStore) {}

  public find(lookup: AgentRunApprovalLookup): AgentRunApproval | undefined {
    return getMapped<AgentRunApprovalRow, AgentRunApproval>(
      this.store,
      `SELECT ${COLUMNS} FROM agent_run_approvals WHERE workspace_id = ? AND agent = ? AND workflow_id = ? AND fingerprint = ?`,
      [lookup.workspaceId, lookup.agent, lookup.workflowId, lookup.fingerprint],
      rowToAgentRunApproval,
    )
  }

  /**
   * Insert idempotently. Two runs of the same shape can be approved at the
   * same time — both dialogs were already open — and the key's uniqueness
   * makes the second write a no-op rather than a failure that would strand an
   * already-approved run.
   */
  public save(input: AgentRunApprovalCreate): AgentRunApproval {
    const id = generateId()
    this.store.set(
      "INSERT OR IGNORE INTO agent_run_approvals (id, workspace_id, agent, workflow_id, workflow_name, fingerprint, secret_names, destinations, runs_scripts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        input.workspaceId,
        input.agent,
        input.workflowId,
        input.workflowName,
        input.fingerprint,
        toJson(input.secretNames),
        toJson(input.destinations),
        input.runsScripts ? 1 : 0,
      ],
    )
    return mustExist(
      this.find(input),
      `agent run approval for workflow ${input.workflowId} missing after insert`,
    )
  }

  public list(): readonly AgentRunApproval[] {
    return queryMapped<AgentRunApprovalRow, AgentRunApproval>(
      this.store,
      `SELECT ${COLUMNS} FROM agent_run_approvals ORDER BY createdAt DESC, id DESC`,
      [],
      rowToAgentRunApproval,
    )
  }

  public delete(approvalId: string): boolean {
    return this.store.delete("DELETE FROM agent_run_approvals WHERE id = ?", [approvalId]).changes > 0
  }
}

function rowToAgentRunApproval(row: AgentRunApprovalRow): AgentRunApproval {
  return {
    approvalId: row.id,
    workspaceId: row.workspace_id,
    agent: row.agent,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    secretNames: parseJson<readonly string[]>(row.secret_names),
    destinations: parseJson<readonly string[]>(row.destinations),
    runsScripts: row.runs_scripts === 1,
    createdAt: row.createdAt,
  }
}
