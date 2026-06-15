/**
 * useSecretValues — API hook for setting and deleting encrypted secret values.
 *
 * POSTs sealed-box ciphertext (never plaintext) to the backend.
 * DELETEs a secret key from the environment.
 */

import { useCallback } from 'react';
import { authenticatedJson } from '../utils/authenticatedApi';
import API_BASE_URL from '../utils/api';
import type { EncryptedSecretValue, SecretPublicKey } from '../types';

/**
 * Fetch the environment's sealed-box public key.
 * Called lazily when the value editor modal opens.
 */
export async function fetchSecretPublicKey(
  environmentId: string,
): Promise<SecretPublicKey> {
  return authenticatedJson<SecretPublicKey>(
    `${API_BASE_URL}/api/environments/${environmentId}/secrets/public-key`,
  );
}

/**
 * POST an encrypted secret value to the backend.
 * The body contains only ciphertext + keyId — never plaintext.
 */
export async function postEncryptedSecret(
  payload: EncryptedSecretValue,
): Promise<void> {
  await authenticatedJson(
    `${API_BASE_URL}/api/environments/${payload.environmentId}/secrets`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: payload.key,
        encrypted_value: payload.encryptedValue,
        key_id: payload.keyId,
      }),
    },
  );
}

/**
 * DELETE a secret key from the environment.
 */
export async function deleteSecret(
  environmentId: string,
  key: string,
): Promise<void> {
  await authenticatedJson(
    `${API_BASE_URL}/api/environments/${environmentId}/secrets/${encodeURIComponent(key)}`,
    { method: 'DELETE' },
  );
}

/**
 * React hook wrapping the secret value API calls.
 */
export function useSecretValues(environmentId: string | undefined) {
  const setSecretValue = useCallback(
    async (payload: EncryptedSecretValue) => {
      await postEncryptedSecret(payload);
    },
    [],
  );

  const removeSecretValue = useCallback(
    async (key: string) => {
      if (!environmentId) throw new Error('No active environment');
      await deleteSecret(environmentId, key);
    },
    [environmentId],
  );

  const getPublicKey = useCallback(async () => {
    if (!environmentId) throw new Error('No active environment');
    return fetchSecretPublicKey(environmentId);
  }, [environmentId]);

  return { setSecretValue, removeSecretValue, getPublicKey };
}
