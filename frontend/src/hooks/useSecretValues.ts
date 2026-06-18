/**
 * useSecretValues — API hook for scoped secret operations.
 *
 * POSTs sealed-box ciphertext (never plaintext) to the scoped backend.
 * DELETEs a secret by ID from the scope.
 * GETs metadata only — no ciphertext or plaintext is ever returned.
 *
 * All routes use `/api/scopes/{scope_type}/{scope_id}/secrets`.
 */

import { useCallback } from 'react';
import { authenticatedJson } from '../utils/authenticatedApi';
import { secretsUrl, publicKeyUrl } from '../utils/scopedApi';
import type { EncryptedSecretValue, PublicKey, SecretScopeType, SecretMetadata } from '../types';

/**
 * Fetch the scope's sealed-box public key.
 * Called lazily when the value editor modal opens.
 */
export async function fetchScopedPublicKey(
  scopeType: SecretScopeType,
  scopeId: string,
): Promise<PublicKey> {
  return authenticatedJson<PublicKey>(publicKeyUrl(scopeType, scopeId));
}

/**
 * POST an encrypted secret value to the scoped backend.
 * The body contains only ciphertext + keyId — never plaintext.
 */
export async function postScopedEncryptedSecret(
  payload: EncryptedSecretValue,
): Promise<SecretMetadata> {
  return authenticatedJson<SecretMetadata>(
    secretsUrl({ scopeType: payload.scopeType, scopeId: payload.scopeId }),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: payload.name,
        ciphertext: payload.ciphertext,
        keyId: payload.keyId,
      }),
    },
  );
}

/**
 * DELETE a secret by ID from the scope.
 */
export async function deleteScopedSecret(
  scopeType: SecretScopeType,
  scopeId: string,
  secretId: string,
): Promise<void> {
  await authenticatedJson(
    secretsUrl({ scopeType, scopeId }, secretId),
    { method: 'DELETE' },
  );
}

/**
 * GET secret metadata list for a scope.
 * Returns metadata only — no ciphertext or plaintext values.
 */
export async function listScopedSecrets(
  scopeType: SecretScopeType,
  scopeId: string,
): Promise<SecretMetadata[]> {
  const response = await authenticatedJson<{ secrets: SecretMetadata[]; total: number }>(
    secretsUrl({ scopeType, scopeId }),
  );
  return response.secrets;
}

/**
 * React hook wrapping scoped secret API calls.
 */
export function useSecretValues(scopeType: SecretScopeType, scopeId: string | undefined) {
  const setSecretValue = useCallback(
    async (payload: EncryptedSecretValue) => {
      await postScopedEncryptedSecret(payload);
    },
    [],
  );

  const removeSecretValue = useCallback(
    async (secretId: string) => {
      if (!scopeId) throw new Error('No active scope');
      await deleteScopedSecret(scopeType, scopeId, secretId);
    },
    [scopeType, scopeId],
  );

  const getPublicKey = useCallback(async () => {
    if (!scopeId) throw new Error('No active scope');
    return fetchScopedPublicKey(scopeType, scopeId);
  }, [scopeType, scopeId]);

  const listSecrets = useCallback(async () => {
    if (!scopeId) throw new Error('No active scope');
    return listScopedSecrets(scopeType, scopeId);
  }, [scopeType, scopeId]);

  return { setSecretValue, removeSecretValue, getPublicKey, listSecrets };
}
