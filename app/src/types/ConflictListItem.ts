import type { ConflictKind } from "./ConflictKind";
import type { ConflictWinner } from "./ConflictWinner";
import type { ConflictWriter } from "./ConflictWriter";

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
  readonly cloud_writer?: ConflictWriter | null;
  // The server reported this conflict as cleanly 3-way auto-mergeable, so the
  // UI may offer a one-click Auto-merge. Absent on legacy/pull conflicts.
  readonly auto_mergeable?: boolean;
}
