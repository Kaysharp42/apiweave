import type { SecretMetadata, SecretMetadataStore, SecretScopeType } from "./scoped_secret_resolver"

/**
 * Sealed secret material handed to {@link SecretWriteStore.put}. The value is ALREADY
 * sealed by the client (per-scope sealed box, Task 7) — the store never sees
 * plaintext. `sealed` is opaque bytes persisted verbatim.
 */
export interface SecretUpsert {
  readonly name: string
  readonly scopeType: SecretScopeType
  readonly scopeId: string
  readonly keyId: string
  readonly sealed: Uint8Array
  readonly label?: string
}

/**
 * Write seam for stored secrets. Extends the metadata-read store with the small
 * mutation surface the service needs. The concrete SQLite-backed implementation
 * is wired at the repository layer (Task 6/13); tests pass a fake. Implementations
 * MUST persist `sealed` opaquely and MUST NEVER return it (or any plaintext) from
 * a read method — the metadata contract carries no secret material.
 */
export interface SecretWriteStore extends SecretMetadataStore {
  put(input: SecretUpsert): SecretMetadata | Promise<SecretMetadata>
  remove(scopeType: SecretScopeType, scopeId: string, name: string): boolean | Promise<boolean>
  listByScope(scopeType: SecretScopeType, scopeId: string): SecretMetadata[] | Promise<SecretMetadata[]>
  // Trusted runtime read of the sealed ciphertext. Backs executor substitution only;
  // never exposed to a read API. See SecretRepository.getCiphertext.
  getCiphertext(scopeType: SecretScopeType, scopeId: string, name: string): Uint8Array | null | Promise<Uint8Array | null>
}
