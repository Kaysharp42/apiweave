import { useState, useCallback } from "react";
import { Lock, Trash2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "./molecules/Modal";
import { Button } from "./atoms/Button";
import { IconButton } from "./atoms/IconButton";
import { EmptyState } from "./molecules/EmptyState";
import SecretValueEditor from "./SecretValueEditor";
import { deleteScopedSecret } from "../hooks/useSecretValues";
import type { SecretsPanelProps, SecretScopeType } from "../types";

export default function SecretsPanel({
  isOpen,
  environment,
  onSecretsChange,
  onClose,
}: SecretsPanelProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [unsetting, setUnsetting] = useState<string | null>(null);
  const [secretKeys, setSecretKeys] = useState<string[]>(() =>
    Object.keys(environment?.secrets ?? {}),
  );

  const environmentId = environment?.environmentId ?? "";
  const scopeType: SecretScopeType = "environment";
  const scopeId = environmentId;
  const workspaceId = environment?.scopeType === "workspace" ? environment.scopeId : undefined;

  const refreshKeys = useCallback(() => {
    if (environment?.secrets) {
      setSecretKeys(Object.keys(environment.secrets));
    }
  }, [environment?.secrets]);

  const handleSetValue = useCallback((key: string) => {
    setEditingKey(key);
  }, []);

  const handleEditorSuccess = useCallback(() => {
    refreshKeys();
    onSecretsChange?.(environment?.secrets ?? {}).catch(() => {});
  }, [refreshKeys, onSecretsChange, environment?.secrets]);

  const handleUnset = useCallback(
    async (secretName: string) => {
      setUnsetting(secretName);
      try {
        await deleteScopedSecret(scopeType, scopeId, secretName, workspaceId);
        setSecretKeys((prev) => prev.filter((k) => k !== secretName));
        toast.success(`Secret "${secretName}" removed`);
        onSecretsChange?.(environment?.secrets ?? {}).catch(() => {});
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast.error(`Failed to remove secret: ${message}`);
      } finally {
        setUnsetting(null);
      }
    },
    [scopeId, workspaceId, onSecretsChange, environment?.secrets],
  );

  const hasKeys = secretKeys.length > 0;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={`Secrets: ${environment?.name ?? ""}`}
        size="md"
        footer={() => (
          <Button onClick={onClose} variant="ghost" fullWidth>
            Close
          </Button>
        )}
      >
        <div className="p-5 space-y-4">
          <div className="p-4 bg-surface-overlay dark:bg-surface-dark-overlay rounded border border-border dark:border-border-dark">
            <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
              Secrets are encrypted in your browser before being sent to the
              server. Values are never displayed after saving — only their
              set/unset state is shown.
            </p>
          </div>

          {!hasKeys ? (
            <EmptyState
              icon={
                <KeyRound
                  className="w-12 h-12 text-text-muted dark:text-text-muted-dark"
                  strokeWidth={1.5}
                />
              }
              title="No secrets configured"
              description="Add secret keys in Environment Manager, then set their values here."
            />
          ) : (
            <div className="space-y-2">
              {secretKeys.map((key) => (
                <div
                  key={key}
                  className="flex items-center gap-3 p-3 bg-surface-raised dark:bg-surface-dark-raised rounded border border-border dark:border-border-dark"
                >
                  <Lock className="w-4 h-4 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm text-text-primary dark:text-text-primary-dark break-all">
                      {key}
                    </p>
                    <p className="text-xs text-text-muted dark:text-text-muted-dark mt-0.5">
                      Value is encrypted
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => handleSetValue(key)}
                  >
                    Set value
                  </Button>
                  <IconButton
                    onClick={() => handleUnset(key)}
                    tooltip={`Remove secret ${key}`}
                    variant="error"
                    size="sm"
                    disabled={unsetting === key}
                  >
                    <Trash2 className="w-4 h-4" />
                  </IconButton>
                </div>
              ))}
            </div>
          )}

          <div className="p-4 bg-[var(--aw-status-info)]/5 rounded border border-[var(--aw-status-info)]/20">
            <p className="text-sm font-semibold text-text-primary dark:text-text-primary-dark mb-2">
              Usage in HTTP Requests:
            </p>
            <p className="text-xs font-mono text-text-secondary dark:text-text-secondary-dark bg-surface-raised dark:bg-surface-dark-raised p-2 rounded break-all">
              {"{{"}
              {hasKeys ? secretKeys[0] : "secretName"}
              {"}}"}
            </p>
          </div>
        </div>
      </Modal>

      {editingKey && (
        <SecretValueEditor
          isOpen={!!editingKey}
          scopeType={scopeType}
          scopeId={scopeId}
          {...(workspaceId ? { workspaceId } : {})}
          secretName={editingKey}
          onClose={() => setEditingKey(null)}
          onSuccess={handleEditorSuccess}
        />
      )}
    </>
  );
}
