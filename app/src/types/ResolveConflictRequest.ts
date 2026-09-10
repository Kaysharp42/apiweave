import type { ConflictWinner } from "./ConflictWinner";

export interface ResolveConflictRequest {
  readonly conflict_id: string;
  readonly winner: ConflictWinner;
  readonly device_id: string;
  // Per-leaf picks for a "merged" resolution. Entries can settle an overlapping
  // path or override an otherwise automatic merge choice. Ignored for
  // keep-local/keep-cloud.
  readonly resolutions?: readonly {
    readonly path: string;
    readonly side: "local" | "cloud";
  }[];
  // When true the resolution writes to the local store and marks the conflict
  // resolved, but does not trigger a cloud push. The merged result stays local
  // until the user explicitly syncs from the Cloud Sync page.
  readonly defer_push?: boolean;
}
