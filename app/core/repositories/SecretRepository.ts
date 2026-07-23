import type { KVStore, SqliteRow } from "../db"
import type { SecretWriteStore, SecretUpsert } from "../secrets/SecretStore"
import type { SecretMetadata, SecretScopeType } from "../secrets/scoped_secret_resolver"
import { generateId } from "../id"
import { mustExist } from "./helpers"

interface SecretRow extends SqliteRow {
  readonly id: string
  readonly scopeType: string
  readonly scopeId: string
  readonly key: string
  readonly label: string
  readonly key_id: string
  readonly createdAt: string
  readonly updatedAt: string
}

const COLUMNS = "id, scopeType, scopeId, key, label, key_id, createdAt, updatedAt"

/**
 * SQLite-backed write-only secret store. Persists the sealed ciphertext verbatim
 * and NEVER returns it (or any plaintext) — every read method yields metadata
 * only, matching {@link SecretWriteStore}. The sealing/opening of the box lives in
 * the secrets crypto subsystem (Task 7), never here.
 *
 * The FK `workspace_id` binds to {@link SecretUpsert.workspaceId} — the owning
 * workspace threaded from the service — never to scopeId, which for
 * scopeType='environment' is an environmentId and would FK-fail.
 */
export class SecretRepository implements SecretWriteStore {
  public constructor(private readonly store: KVStore) {}

  public put(input: SecretUpsert): SecretMetadata {
    const sealed = Buffer.from(input.sealed)
    const existing = this.store.get<{ id: string }>(
      "SELECT id FROM secrets_metadata WHERE scopeType = ? AND scopeId = ? AND key = ?",
      [input.scopeType, input.scopeId, input.name],
    )
    if (existing !== undefined) {
      this.store.set("UPDATE secrets_metadata SET label = ?, key_id = ?, sealed = ? WHERE id = ?", [
        input.label ?? "",
        input.keyId,
        sealed,
        existing.id,
      ])
      return mustExist(this.getById(existing.id), `secret ${existing.id} missing after update`)
    }
    const id = generateId()
    this.store.set(
      "INSERT INTO secrets_metadata (id, workspace_id, scopeType, scopeId, key, label, key_id, sealed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, input.workspaceId, input.scopeType, input.scopeId, input.name, input.label ?? "", input.keyId, sealed],
    )
    return mustExist(this.getById(id), `secret ${id} missing after insert`)
  }

  public remove(scopeType: SecretScopeType, scopeId: string, name: string): boolean {
    return (
      this.store.delete("DELETE FROM secrets_metadata WHERE scopeType = ? AND scopeId = ? AND key = ?", [
        scopeType,
        scopeId,
        name,
      ]).changes > 0
    )
  }

  public listByScope(scopeType: SecretScopeType, scopeId: string): SecretMetadata[] {
    return this.store
      .query<SecretRow>(
        `SELECT ${COLUMNS} FROM secrets_metadata WHERE scopeType = ? AND scopeId = ? ORDER BY key ASC`,
        [scopeType, scopeId],
      )
      .map(rowToMetadata)
  }

  public getByScopeAndName(scopeType: SecretScopeType, scopeId: string, name: string): SecretMetadata | null {
    const row = this.store.get<SecretRow>(
      `SELECT ${COLUMNS} FROM secrets_metadata WHERE scopeType = ? AND scopeId = ? AND key = ?`,
      [scopeType, scopeId, name],
    )
    return row === undefined ? null : rowToMetadata(row)
  }

  /**
   * Trusted main-process read of the sealed ciphertext for a secret. This is the
   * ONLY read path for secret material — it backs runtime substitution, never a
   * user-facing API. The renderer seals against the scope's public key; the
   * runtime opens the box with the matching private seed (see SecretService).
   */
  public getCiphertext(scopeType: SecretScopeType, scopeId: string, name: string): Uint8Array | null {
    const row = this.store.get<{ sealed: Buffer }>(
      `SELECT sealed FROM secrets_metadata WHERE scopeType = ? AND scopeId = ? AND key = ?`,
      [scopeType, scopeId, name],
    )
    if (row === undefined || row.sealed === undefined || row.sealed === null) return null
    return new Uint8Array(row.sealed)
  }

  private getById(id: string): SecretMetadata | undefined {
    const row = this.store.get<SecretRow>(`SELECT ${COLUMNS} FROM secrets_metadata WHERE id = ?`, [id])
    return row === undefined ? undefined : rowToMetadata(row)
  }
}

function rowToMetadata(row: SecretRow): SecretMetadata {
  return {
    secretId: row.id,
    name: row.key,
    scopeType: row.scopeType as SecretScopeType,
    scopeId: row.scopeId,
    keyId: row.key_id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.label ? { label: row.label } : {}),
  }
}
