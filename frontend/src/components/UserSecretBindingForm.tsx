import { useState, useEffect, useCallback } from "react";
import { Link2, Unlink } from "lucide-react";
import { Button } from "./atoms/Button";
import { EmptyState } from "./molecules/EmptyState";
import { ConfirmDialog } from "./molecules/ConfirmDialog";
import { authenticatedJson } from "../utils/apiweaveClient";
import API_BASE_URL from "../utils/apiweaveClient";
import type { Secret, SecretBinding } from "../types";

export interface UserSecretBindingFormProps {
  /** The target scope type (workspace or environment). */
  targetScopeType: "workspace" | "environment";
  /** The target scope ID. */
  targetScopeId: string;
  className?: string;
}

interface BindingListResponse {
  bindings: SecretBinding[];
  total: number;
}

interface SecretListResponse {
  secrets: Secret[];
  total: number;
}

/**
 * UserSecretBindingForm — lists user-scoped secrets and allows binding
 * them to a workspace or environment target.
 */
export function UserSecretBindingForm({
  targetScopeType,
  targetScopeId,
  className = "",
}: UserSecretBindingFormProps) {
  const [userSecrets, setUserSecrets] = useState<Secret[]>([]);
  const [bindings, setBindings] = useState<SecretBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unbindTarget, setUnbindTarget] = useState<SecretBinding | null>(null);
  const [unbinding, setUnbinding] = useState(false);
  const [bindingSecretId, setBindingSecretId] = useState("");
  const [bindingInProgress, setBindingInProgress] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch user-scoped secrets
      const secretsData = await authenticatedJson<SecretListResponse>(
        `${API_BASE_URL}/api/scopes/user/me/secrets`,
      );
      setUserSecrets(secretsData.secrets);

      // Fetch existing bindings for this target
      const bindingsData = await authenticatedJson<BindingListResponse>(
        `${API_BASE_URL}/api/scopes/${encodeURIComponent(targetScopeType)}/${encodeURIComponent(targetScopeId)}/secrets/bindings`,
      );
      setBindings(bindingsData.bindings);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load bindings";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [targetScopeType, targetScopeId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const boundSecretIds = new Set(bindings.map((b) => b.secretId));
  const availableSecrets = userSecrets.filter(
    (s) => !boundSecretIds.has(s.secretId),
  );

  const handleBind = useCallback(async () => {
    if (!bindingSecretId) return;
    setBindingInProgress(true);
    setError(null);
    try {
      await authenticatedJson(
        `${API_BASE_URL}/api/scopes/${encodeURIComponent(targetScopeType)}/${encodeURIComponent(targetScopeId)}/secrets/bindings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secretId: bindingSecretId,
            targetScopeType,
            targetScopeId,
          }),
        },
      );
      setBindingSecretId("");
      await fetchData();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to bind secret";
      setError(message);
    } finally {
      setBindingInProgress(false);
    }
  }, [bindingSecretId, targetScopeType, targetScopeId, fetchData]);

  const handleUnbind = useCallback(async () => {
    if (!unbindTarget) return;
    setUnbinding(true);
    try {
      await authenticatedJson(
        `${API_BASE_URL}/api/scopes/${encodeURIComponent(targetScopeType)}/${encodeURIComponent(targetScopeId)}/secrets/bindings/${encodeURIComponent(unbindTarget.bindingId)}`,
        { method: "DELETE" },
      );
      setUnbindTarget(null);
      await fetchData();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to unbind secret";
      setError(message);
    } finally {
      setUnbinding(false);
    }
  }, [unbindTarget, targetScopeType, targetScopeId, fetchData]);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center py-8"
        aria-label="Loading bindings"
      >
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {error && (
        <div className="text-sm text-status-error" role="alert">
          {error}
        </div>
      )}

      {/* Bind form */}
      {availableSecrets.length > 0 && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="label py-1 px-0">
              <span className="label-text text-xs font-medium text-text-primary dark:text-text-primary-dark">
                Bind a user secret
              </span>
            </label>
            <select
              className={[
                "select select-bordered w-full px-3",
                "bg-surface-raised dark:bg-surface-dark-raised",
                "text-text-primary dark:text-text-primary-dark",
                "border-border dark:border-border-dark",
                "text-sm",
              ].join(" ")}
              value={bindingSecretId}
              onChange={(e) => setBindingSecretId(e.target.value)}
              disabled={bindingInProgress}
            >
              <option value="">Select a user secret...</option>
              {availableSecrets.map((s) => (
                <option key={s.secretId} value={s.secretId}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="primary"
            intent="success"
            size="sm"
            loading={bindingInProgress}
            disabled={!bindingSecretId || bindingInProgress}
            onClick={handleBind}
          >
            <Link2 className="w-4 h-4" aria-hidden="true" />
            Bind
          </Button>
        </div>
      )}

      {/* Existing bindings */}
      {bindings.length === 0 ? (
        <EmptyState
          icon={
            <Link2
              className="w-10 h-10 text-text-muted dark:text-text-muted-dark"
              strokeWidth={1.5}
            />
          }
          title="No bindings"
          description="Bind user-scoped secrets to this target to make them available."
        />
      ) : (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider">
            Bound secrets ({bindings.length})
          </h4>
          {bindings.map((binding) => {
            const secret = userSecrets.find(
              (s) => s.secretId === binding.secretId,
            );
            return (
              <div
                key={binding.bindingId}
                className="flex items-center justify-between px-3 py-2 rounded border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised"
              >
                <span className="font-mono text-sm text-text-primary dark:text-text-primary-dark">
                  {secret?.name ?? binding.secretId}
                </span>
                <Button
                  variant="ghost"
                  intent="error"
                  size="xs"
                  onClick={() => setUnbindTarget(binding)}
                >
                  <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
                  Unbind
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!unbindTarget}
        onClose={() => setUnbindTarget(null)}
        onConfirm={handleUnbind}
        title="Remove binding"
        message="This secret will no longer be available to the target scope. The secret itself is not deleted."
        confirmLabel={unbinding ? "Removing..." : "Remove"}
        intent="warning"
      />
    </div>
  );
}
