import { useState, useEffect, useCallback } from 'react';
import { Trash2, KeyRound } from 'lucide-react';
import { IconButton } from './atoms/IconButton';
import { EmptyState } from './molecules/EmptyState';
import { ConfirmDialog } from './molecules/ConfirmDialog';
import { ScopeBadge } from './ScopeBadge';
import { SecretOverrideIndicator } from './SecretOverrideIndicator';
import { authenticatedJson } from '../utils/authenticatedApi';
import API_BASE_URL from '../utils/api';
import type { Secret, SecretScopeType } from '../types';

export interface ScopedSecretListProps {
  scopeType: SecretScopeType;
  scopeId: string;
  /** Called after a secret is deleted, to refresh parent state. */
  onChanged: () => void;
  onSelect?: (secret: Secret) => void;
  selectedId?: string;
  className?: string;
}

interface SecretListResponse {
  secrets: Secret[];
  total: number;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/**
 * ScopedSecretList — displays secrets for a scope as a metadata-only table.
 *
 * NEVER shows secret values or ciphertext.
 */
export function ScopedSecretList({
  scopeType,
  scopeId,
  onChanged,
  onSelect,
  selectedId,
  className = '',
}: ScopedSecretListProps) {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Secret | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchSecrets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await authenticatedJson<SecretListResponse>(
        `${API_BASE_URL}/api/scopes/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}/secrets`,
      );
      setSecrets(data.secrets);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load secrets';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [scopeType, scopeId]);

  useEffect(() => {
    void fetchSecrets();
  }, [fetchSecrets]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await authenticatedJson(
        `${API_BASE_URL}/api/scopes/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}/secrets/${encodeURIComponent(deleteTarget.secretId)}`,
        { method: 'DELETE' },
      );
      setDeleteTarget(null);
      onChanged();
      await fetchSecrets();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete secret';
      setError(message);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, scopeType, scopeId, onChanged, fetchSecrets]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8" aria-label="Loading secrets">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-status-error py-4" role="alert">
        {error}
      </div>
    );
  }

  if (secrets.length === 0) {
    return (
      <EmptyState
        icon={<KeyRound className="w-10 h-10 text-text-muted dark:text-text-muted-dark" strokeWidth={1.5} />}
        title="No secrets yet"
        description="Add a secret using the form above. Values are encrypted client-side."
        className={className}
      />
    );
  }

  return (
    <div className={className}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border dark:border-border-dark">
            <th className="text-left py-2 px-3 text-xs font-medium text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider">
              Name
            </th>
            <th className="text-left py-2 px-3 text-xs font-medium text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider">
              Scope
            </th>
            <th className="text-left py-2 px-3 text-xs font-medium text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider">
              Updated
            </th>
            <th className="text-right py-2 px-3 text-xs font-medium text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {secrets.map((secret) => {
            const isSelected = secret.secretId === selectedId;

            return (
              <tr
                key={secret.secretId}
                className={[
                  'border-b border-border/50 dark:border-border-dark/50 transition-colors',
                  onSelect ? 'cursor-pointer' : '',
                  isSelected
                    ? 'bg-[var(--aw-primary)]/5 dark:bg-[var(--aw-primary)]/10'
                    : 'hover:bg-surface-overlay/50 dark:hover:bg-surface-dark-overlay/50',
                ].join(' ')}
                onClick={() => onSelect?.(secret)}
                role={onSelect ? 'button' : undefined}
                tabIndex={onSelect ? 0 : undefined}
                onKeyDown={(e) => {
                  if (!onSelect) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(secret);
                  }
                }}
                aria-selected={onSelect ? isSelected : undefined}
              >
              <td className="py-2.5 px-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-text-primary dark:text-text-primary-dark">
                    {secret.name}
                  </span>
                </div>
              </td>
              <td className="py-2.5 px-3">
                <div className="flex items-center gap-2">
                  <ScopeBadge scopeType={secret.scopeType} />
                  <SecretOverrideIndicator isOverride={false} />
                </div>
              </td>
              <td className="py-2.5 px-3 text-text-secondary dark:text-text-secondary-dark text-xs">
                {formatDate(secret.updatedAt)}
              </td>
              <td className="py-2.5 px-3 text-right">
                <IconButton
                  tooltip="Delete secret"
                  size="xs"
                  variant="error"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(secret);
                  }}
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </IconButton>
              </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete secret"
        message={deleteTarget ? `Are you sure you want to delete "${deleteTarget.name}"? This action cannot be undone.` : ''}
        confirmLabel={deleting ? 'Deleting...' : 'Delete'}
        intent="error"
      />
    </div>
  );
}
