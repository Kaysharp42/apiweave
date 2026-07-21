import type { SyncMutation, SyncProvider } from "./SyncProvider"

export class LocalOnlySyncProvider implements SyncProvider {
  public recordMutation(_mutation: SyncMutation): void {}

  public async pull(): Promise<void> {}

  public async push(): Promise<void> {}
}
