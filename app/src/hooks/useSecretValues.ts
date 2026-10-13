/**
 * Scoped secret operations over the write-only `secrets` IPC domain.
 *
 * Writes carry sealed-box bytes (never plaintext); reads return metadata only —
 * no sealed bytes or plaintext ever come back.
 */

import { apiweave, IpcError } from "../utils/apiweaveClient";
import type {
  EncryptedSecretValue,
  PublicKey,
  Secret,
  SecretScopeType,
} from "../types";

/**
 * The workspace a secret scope belongs to.
 *
 * A `workspace` scope IS its workspace. An `environment` scope is not, and
 * there is no safe way to guess it: the workspace id is what every secret call
 * is authorized against, so a placeholder would be an authorization check
 * against a workspace nobody named. Fail closed and make the caller pass it.
 */
function scopeWorkspaceId(
  scopeType: SecretScopeType,
  scopeId: string,
  workspaceId?: string,
): string {
  if (scopeType === "workspace") return scopeId;
  if (workspaceId) return workspaceId;
  throw new IpcError(
    "validation",
    "missing workspaceId for an environment scope",
  );
}

/** The scope's sealed-box public key. */
export async function fetchScopedPublicKey(
  scopeType: SecretScopeType,
  scopeId: string,
  workspaceId?: string,
): Promise<PublicKey> {
  return apiweave.secrets.publicKey(
    scopeWorkspaceId(scopeType, scopeId, workspaceId),
    scopeType,
    scopeId,
  );
}

/** Store a sealed secret value. Writing an existing name replaces its value. */
export async function postScopedEncryptedSecret(
  payload: EncryptedSecretValue,
): Promise<Secret> {
  return apiweave.secrets.set({
    workspaceId: scopeWorkspaceId(
      payload.scopeType,
      payload.scopeId,
      payload.workspaceId,
    ),
    scopeType: payload.scopeType,
    scopeId: payload.scopeId,
    name: payload.name,
    sealed: payload.sealed,
    keyId: payload.keyId,
  });
}

/** Delete a secret by name from the scope. */
export async function deleteScopedSecret(
  scopeType: SecretScopeType,
  scopeId: string,
  name: string,
  workspaceId?: string,
): Promise<void> {
  await apiweave.secrets.delete(
    scopeWorkspaceId(scopeType, scopeId, workspaceId),
    scopeType,
    scopeId,
    name,
  );
}

/** Secret metadata for a scope — names only, never values. */
export async function listScopedSecrets(
  scopeType: SecretScopeType,
  scopeId: string,
  workspaceId?: string,
): Promise<Secret[]> {
  return [
    ...(await apiweave.secrets.list(
      scopeWorkspaceId(scopeType, scopeId, workspaceId),
      scopeType,
      scopeId,
    )),
  ];
}
