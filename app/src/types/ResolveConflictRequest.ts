import type { ConflictWinner } from "./ConflictWinner";

export interface ResolveConflictRequest {
  readonly conflict_id: string;
  readonly winner: ConflictWinner;
  readonly device_id: string;
  // Per-leaf picks for a "merged" resolution: one entry per overlapping path in
  // the conflict's merge_residual_paths. Ignored for keep-local/keep-cloud.
  readonly resolutions?: readonly { readonly path: string; readonly side: "local" | "cloud" }[];
}
