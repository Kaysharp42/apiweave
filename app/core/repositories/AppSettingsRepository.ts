import type { KVStore } from "../db"
import { deleteSetting, getSetting, setSetting } from "./helpers"

/**
 * The `app_settings` key/value table, as a repository.
 *
 * Scalar preferences owned by the main process (`http.allow_private_networks`,
 * `mcp.enabled`, `updates.policy`) used to be six inline SQL statements in
 * `electron/main.ts`. Repositories are the only place that speaks SQL, so they
 * live here instead. Keys are namespaced by their owner; `AgentRepository` and
 * `CloudSyncRepository` reach the same table through their own domain methods.
 */
export class AppSettingsRepository {
  public constructor(private readonly store: KVStore) {}

  public get(key: string): string | undefined {
    return getSetting(this.store, key)
  }

  /** Convenience for the boolean settings, which persist as "true"/"false". */
  public getBoolean(key: string): boolean {
    return this.get(key) === "true"
  }

  public set(key: string, value: string): void {
    setSetting(this.store, key, value)
  }

  public setBoolean(key: string, value: boolean): void {
    this.set(key, value ? "true" : "false")
  }

  /** True when a row was actually removed. */
  public delete(key: string): boolean {
    return deleteSetting(this.store, key)
  }
}
