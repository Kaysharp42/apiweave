export interface CloudUnlinkOptions {
  /**
   * Disconnect even though the device could not be revoked in the cloud
   * (typically because the machine is offline).
   */
  readonly localOnly?: boolean;
  /**
   * Also delete every local workspace belonging to the account being
   * disconnected. Destructive and irreversible — always an explicit,
   * per-disconnect choice, never a default.
   */
  readonly purgeLocalData?: boolean;
}
