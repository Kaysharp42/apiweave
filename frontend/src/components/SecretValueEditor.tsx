import { useState, useCallback } from 'react';
import { Lock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from './molecules/Modal';
import { Button } from './atoms/Button';
import { Input } from './atoms/Input';
import { encryptSecretValue } from '../utils/encryptSecretValue';
import { fetchScopedPublicKey, postScopedEncryptedSecret } from '../hooks/useSecretValues';
import type { PublicKey, SecretScopeType } from '../types';

export interface SecretValueEditorProps {
  isOpen: boolean;
  scopeType: SecretScopeType;
  scopeId: string;
  secretName: string;
  /** Optional existing secret ID for update mode. */
  secretId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SecretValueEditor({
  isOpen,
  scopeType,
  scopeId,
  secretName,
  onClose,
  onSuccess,
}: SecretValueEditorProps) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fetchingKey, setFetchingKey] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!value.trim()) return;

    setSubmitting(true);
    setFetchingKey(true);
    try {
      const publicKeyInfo: PublicKey = await fetchScopedPublicKey(scopeType, scopeId);
      setFetchingKey(false);

      const ciphertext = await encryptSecretValue(value, {
        keyId: publicKeyInfo.keyId,
        publicKey: publicKeyInfo.publicKey,
        algorithm: 'libsodium-sealed-box',
      });

      // Clear plaintext from state immediately
      setValue('');

      await postScopedEncryptedSecret({
        scopeType,
        scopeId,
        name: secretName,
        ciphertext,
        keyId: publicKeyInfo.keyId,
      });

      toast.success(`Secret "${secretName}" saved`);
      onSuccess();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to save secret: ${message}`);
    } finally {
      setSubmitting(false);
      setFetchingKey(false);
    }
  }, [value, scopeType, scopeId, secretName, onClose, onSuccess]);

  const handleClose = useCallback(() => {
    setValue('');
    onClose();
  }, [onClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Set value: ${secretName}`}
      size="sm"
      footer={() => (
        <>
          <Button variant="ghost" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={!value.trim() || submitting}
            loading={submitting}
          >
            <Lock className="w-3.5 h-3.5" />
            {submitting ? 'Encrypting...' : 'Save encrypted'}
          </Button>
        </>
      )}
    >
      <div className="p-5 space-y-4">
        <div className="p-3 bg-primary/5 dark:bg-primary/10 rounded border border-primary/20">
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            The value is encrypted in your browser before being sent. It is never stored in plaintext.
          </p>
        </div>

        <div className="space-y-1">
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`Enter value for ${secretName}`}
            aria-label={`Value for ${secretName}`}
            disabled={submitting}
          />
        </div>

        {fetchingKey && (
          <div className="flex items-center gap-2 text-sm text-text-muted dark:text-text-muted-dark">
            <Loader2 className="w-4 h-4 animate-spin" />
            Fetching encryption key...
          </div>
        )}
      </div>
    </Modal>
  );
}
