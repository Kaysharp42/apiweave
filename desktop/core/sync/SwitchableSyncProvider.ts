import { LocalOnlySyncProvider } from "./LocalOnlySyncProvider"
import type { SyncMutation, SyncProvider } from "./SyncProvider"

/**
 * Stable SyncProvider reference for services constructed before cloud login.
 * The service layer keeps this object, while cloud linking swaps the target.
 */
export class SwitchableSyncProvider implements SyncProvider {
  private target: SyncProvider

  public constructor(initial: SyncProvider = new LocalOnlySyncProvider()) {
    this.target = initial
  }

  public setTarget(provider: SyncProvider): void {
    this.target = provider
  }

  public reset(): void {
    this.target = new LocalOnlySyncProvider()
  }

  public recordMutation(mutation: SyncMutation): void {
    this.target.recordMutation(mutation)
  }

  public pull(): Promise<void> {
    return this.target.pull()
  }

  public async push(): Promise<void> {
    try {
      await this.target.push()
    } catch {
      // Local writes are already committed and cloud mutations remain in the
      // durable outbox. The concrete provider reports its own sync state.
    }
  }
}
