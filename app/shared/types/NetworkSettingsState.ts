import type { NetworkSettings } from "./NetworkSettings"

/** What Settings > Network shows. Says whether a credential is stored, never what it is. */
export interface NetworkSettingsState {
  readonly settings: NetworkSettings
  readonly proxyPasswordSet: boolean
  /** Ids of the client certificates that have a stored passphrase. */
  readonly passphraseSet: readonly string[]
  /** Why the saved settings cannot be applied right now (a file that moved), or null. */
  readonly problem: string | null
}
