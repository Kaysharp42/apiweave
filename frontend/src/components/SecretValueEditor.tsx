import { useState, useCallback } from 'react';
import { Lock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from './molecules/Modal';
import { Button } from './atoms/Button';
import { Input } from './atoms/Input';
import { encryptSecretValue } from '../utils/encryptSecretValue';
import { fetchSecretPublicKey, postEncryptedSecret } from '../hooks/useSecretValues';
import type { SecretPublicKey } from '../types';

export interface SecretValueEditorProps {
  isOpen: boolean;
  environmentId: string;
  secretKey: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SecretValueEditor({
  isOpen,
  environmentId,
  secretKey,
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
      const publicKeyInfo: SecretPublicKey = await fetchSecretPublicKey(environmentId);
      setFetchingKey(false);

      const encryptedValue = await encryptSecretValue(value, publicKeyInfo);

      setValue('');

      await postEncryptedSecret({
        environmentId,
        key: secretKey,
        encryptedValue,
        keyId: publicKeyInfo.keyId,
      });

      toast.success(`Secret "${secretKey}" saved`);
      onSuccess();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to save secret: ${message}`);
    } finally {
      setSubmitting(false);
      setFetchingKey(false);
    }
  }, [value, environmentId, secretKey, onClose, onSuccess]);

  const handleClose = useCallback(() => {
    setValue('');
    onClose();
  }, [onClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Set value: ${secretKey}`}
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
            placeholder={`Enter value for ${secretKey}`}
            aria-label={`Value for ${secretKey}`}
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
