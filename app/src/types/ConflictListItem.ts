import type { ConflictKind } from "./ConflictKind";
import type { ConflictWinner } from "./ConflictWinner";

export interface ConflictListItem {
  readonly id: string;
  readonly workspace_id: string;
  readonly kind: ConflictKind;
  readonly record_id: string;
  readonly name: string | null;
  readonly local_rev: number;
  readonly cloud_rev: number;
  readonly winner: ConflictWinner | null;
  readonly created_at: string;
  readonly resolved_at?: string | null;
}
