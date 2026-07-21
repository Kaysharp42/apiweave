export type CloudSyncState =
  | "idle"
  | "initializing"
  | "syncing"
  | "conflict"
  | "error"
  | "offline";
