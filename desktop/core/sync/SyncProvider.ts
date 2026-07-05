export interface SyncProvider {
  pull(): Promise<void>
  push(): Promise<void>
}
