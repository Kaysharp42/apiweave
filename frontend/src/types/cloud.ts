export type ConflictWinner = "local" | "cloud";

export type ConflictKind =
  | "workspace"
  | "project"
  | "collection"
  | "workflow"
  | "environment";

export type ConflictPayload = Record<string, unknown>;

export interface ConflictListItem {
  readonly id: string;
  readonly workspace_id: string;
  readonly kind: ConflictKind;
  readonly record_id: string;
  readonly local_rev: number;
  readonly cloud_rev: number;
  readonly winner: ConflictWinner | null;
  readonly created_at: string;
  readonly resolved_at?: string | null;
}

export interface Conflict extends ConflictListItem {
  readonly local_payload: ConflictPayload;
  readonly cloud_payload: ConflictPayload;
}

export interface ResolveConflictRequest {
  readonly conflict_id: string;
  readonly winner: ConflictWinner;
  readonly device_id: string;
}
