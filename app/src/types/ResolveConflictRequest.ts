import type { ConflictWinner } from "./ConflictWinner";

export interface ResolveConflictRequest {
  readonly conflict_id: string;
  readonly winner: ConflictWinner;
  readonly device_id: string;
}
