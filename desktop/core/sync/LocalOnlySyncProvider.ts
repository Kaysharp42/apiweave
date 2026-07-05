import type { SyncProvider } from "./SyncProvider"

export class LocalOnlySyncProvider implements SyncProvider {
  public async pull(): Promise<void> {}

  public async push(): Promise<void> {}
}
