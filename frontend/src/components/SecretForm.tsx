import { useState, useCallback } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from './atoms/Button';
import { Input } from './atoms/Input';
import { FormField } from './molecules/FormField';
import { Spinner } from './atoms/Spinner';
import { encryptSecretValue } from '../utils/encryptSecretValue';
import { authenticatedJson } from '../utils/authenticatedApi';
import API_BASE_URL from '../utils/api';
import type { PublicKey, SecretScopeType } from '../types';

export interface SecretFormProps {
  /** The scope type this secret belongs to. */
  scopeType: SecretScopeType;
  /** The scope ID (e.g., workspace ID). */
  scopeId: string;
  /** Called after a secret is successfully created. */
  onCreated: () => void;
  /** Optional existing secret name for update mode. */
  existingSecretId?: string;
  className?: string;
}

/**
 * SecretForm — fetches the scope's public key, encrypts the value with
 * libsodium sealed-box, and POSTs the ciphertext.
 *
 * The plaintext value is cleared from state immediately after submission.
 */
export function SecretForm({
  scopeType,
  scopeId,
  onCreated,
  existingSecretId,
  className = '',
}: SecretFormProps) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [valueError, setValueError] = useState<string | null>(null);

  const isUpdate = !!existingSecretId;

  const validate = useCallback((): boolean => {
    let valid = true;
    setNameError(null);
    setValueError(null);

    if (!name.trim()) {
      setNameError('Secret name is required');
      valid = false;
    } else if (!/^[A-Z0-9_]+$/.test(name.trim())) {
      setNameError('Use uppercase letters, digits, and underscores only');
      valid = false;
    }

    if (!value) {
      setValueError('Secret value is required');
      valid = false;
    }

    return valid;
  }, [name, value]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setError(null);

    try {
      // 1. Fetch the scope's public key
      const publicKeyInfo = await authenticatedJson<PublicKey>(
        `${API_BASE_URL}/api/secrets/public-key?scope=${encodeURIComponent(scopeType)}&id=${encodeURIComponent(scopeId)}`,
      );

      // 2. Encrypt the value using libsodium sealed-box
      const ciphertext = await encryptSecretValue(value, {
        keyId: publicKeyInfo.keyId,
        publicKey: publicKeyInfo.publicKey,
        algorithm: 'libsodium-sealed-box',
      });

      // 3. Clear plaintext from state immediately
      setValue('');

      // 4. POST the ciphertext
      const url = isUpdate
        ? `${API_BASE_URL}/api/scopes/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}/secrets/${encodeURIComponent(existingSecretId)}`
        : `${API_BASE_URL}/api/scopes/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}/secrets`;

      const method = isUpdate ? 'PUT' : 'POST';

      await authenticatedJson(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          ciphertext,
          keyId: publicKeyInfo.keyId,
        }),
      });

      // 5. Clear form and notify parent
      setName('');
      setValue('');
      onCreated();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save secret';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [validate, scopeType, scopeId, name, value, isUpdate, existingSecretId, onCreated]);

  return (
    <form onSubmit={handleSubmit} className={`space-y-4 ${className}`}>
      <FormField label="Secret name" required {...(nameError && { error: nameError })} hint="UPPERCASE_LETTERS, digits, underscores">
        <Input
          type="text"
          placeholder="API_TOKEN"
          value={name}
          onChange={(e) => setName((e.target as HTMLInputElement).value)}
          disabled={submitting}
          className="font-mono"
        />
      </FormField>

      <FormField label="Secret value" required {...(valueError && { error: valueError })} hint="Encrypted client-side before sending">
        <Input
          type="password"
          placeholder="Enter secret value"
          value={value}
          onChange={(e) => setValue((e.target as HTMLInputElement).value)}
          disabled={submitting}
          autoComplete="new-password"
        />
      </FormField>

      {error && (
        <div className="text-sm text-status-error flex items-center gap-1.5" role="alert">
          <KeyRound className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="submit"
          variant="primary"
          intent="success"
          size="sm"
          loading={submitting}
          disabled={submitting}
        >
          {submitting ? <Spinner size="sm" /> : null}
          {isUpdate ? 'Update secret' : 'Add secret'}
        </Button>
      </div>
    </form>
  );
}
