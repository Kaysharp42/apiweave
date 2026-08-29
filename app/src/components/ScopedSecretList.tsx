import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeftRight, Copy, Trash2, KeyRound } from "lucide-react";
import { IconButton } from "./atoms/IconButton";
import { EmptyState } from "./molecules/EmptyState";
import { ConfirmDialog } from "./molecules/ConfirmDialog";
import { ScopeBadge } from "./ScopeBadge";
import { SecretOverrideIndicator } from "./SecretOverrideIndicator";
import { authenticatedJson } from "../utils/apiweaveClient";
import API_BASE_URL from "../utils/apiweaveClient";
import { formatTimestamp } from "../utils/formatTimestamp";
import type { Secret } from "../types";
import type { ScopedSecretListProps } from "../types/ScopedSecretListProps";

interface SecretListResponse {
  secrets: Secret[];
  total: number;
}

interface SecretRowProps {
  readonly secret: Secret;
  readonly selectedId?: string | undefined;
  readonly onSelect?: ((secret: Secret) => void) | undefined;
  readonly onDuplicate?: ((secret: Secret) => void) | undefined;
  readonly onMove?: ((secret: Secret) => void) | undefined;
  readonly readOnly: boolean;
  /** Delete is a two-step: the row only nominates the target, the list confirms. */
  readonly onRequestDelete: (secret: Secret) => void;
}

/** One secret's metadata row. Never shows a value or ciphertext. */
function SecretRow({
  secret,
  selectedId,
  onSelect,
  onDuplicate,
  onMove,
  readOnly,
  onRequestDelete,
}: SecretRowProps) {
  const isSelected = secret.secretId === selectedId;

  return (
    <tr
      className={[
        "border-b border-border/50 dark:border-border-dark/50 transition-colors",
        onSelect ? "cursor-pointer" : "",
        isSelected
          ? "bg-[var(--aw-primary)]/5 dark:bg-[var(--aw-primary)]/10"
          : "hover:bg-surface-overlay/50 dark:hover:bg-surface-dark-overlay/50",
      ].join(" ")}
      onClick={() => onSelect?.(secret)}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={(e) => {
        if (!onSelect) return;
        if (e.key === "Enter" || e.key === " ") {
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
        {formatTimestamp(secret.updatedAt)}
      </td>
      <td className="py-2.5 px-3 text-right">
        <div className="flex items-center justify-end gap-1">
          {onDuplicate && (
            <IconButton
              tooltip="Duplicate to another scope"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate(secret);
              }}
            >
              <Copy className="w-4 h-4" aria-hidden="true" />
            </IconButton>
          )}
          {onMove && (
            <IconButton
              tooltip="Move to another workspace"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                onMove(secret);
              }}
            >
              <ArrowLeftRight className="w-4 h-4" aria-hidden="true" />
            </IconButton>
          )}
          {!readOnly && (
            <IconButton
              tooltip="Delete secret"
              size="xs"
              variant="error"
              onClick={(e) => {
                e.stopPropagation();
                onRequestDelete(secret);
              }}
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </IconButton>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * The data side of the list: fetch the scope's secret metadata, keep delete
 * confirmation state, and re-fetch after a confirmed delete.
 */
function useScopedSecrets(
  scopeType: ScopedSecretListProps["scopeType"],
  scopeId: string,
  onChanged: () => void,
) {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Secret | null>(null);
  const [deleting, setDeleting] = useState(false);

  /**
   * The scope the in-flight request belongs to.
   *
   * A secret name belongs to exactly one scope, and this list is rendered once
   * per workspace on the secrets page — so several fetches are in flight at
   * once and they do not finish in order. Without this, a slow response for one
   * workspace installs its secret names under another workspace's heading, and
   * every action offered on that row then names the wrong scope.
   */
  const inFlight = useRef("");

  const fetchSecrets = useCallback(async () => {
    const scopeKey = `${scopeType}:${scopeId}`;
    inFlight.current = scopeKey;
    setSecrets([]);
    setLoading(true);
    setError(null);
    try {
      const data = await authenticatedJson<SecretListResponse>(
        `${API_BASE_URL}/api/scopes/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}/secrets`,
      );
      if (inFlight.current !== scopeKey) return;
      setSecrets(data.secrets);
    } catch (err) {
      if (inFlight.current !== scopeKey) return;
      const message =
        err instanceof Error ? err.message : "Failed to load secrets";
      setError(message);
    } finally {
      if (inFlight.current === scopeKey) setLoading(false);
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
        `${API_BASE_URL}/api/scopes/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}/secrets/${encodeURIComponent(deleteTarget.name)}`,
        { method: "DELETE" },
      );
      setDeleteTarget(null);
      onChanged();
      await fetchSecrets();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to delete secret";
      setError(message);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, scopeType, scopeId, onChanged, fetchSecrets]);

  return { secrets, loading, error, deleteTarget, setDeleteTarget, deleting, handleDelete };
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
  onDuplicate,
  onMove,
  readOnly = false,
  selectedId,
  className = "",
}: ScopedSecretListProps) {
  const { secrets, loading, error, deleteTarget, setDeleteTarget, deleting, handleDelete } =
    useScopedSecrets(scopeType, scopeId, onChanged);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center py-8"
        aria-label="Loading secrets"
      >
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
        icon={
          <KeyRound
            className="w-10 h-10 text-text-muted dark:text-text-muted-dark"
            strokeWidth={1.5}
          />
        }
        title="No secrets yet"
        description={
          readOnly
            ? "This workspace has no secrets of its own."
            : "Add a secret using the form above. Values are encrypted client-side."
        }
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
          {secrets.map((secret) => (
            <SecretRow
              key={secret.secretId}
              secret={secret}
              selectedId={selectedId}
              onSelect={onSelect}
              onDuplicate={onDuplicate}
              onMove={onMove}
              readOnly={readOnly}
              onRequestDelete={setDeleteTarget}
            />
          ))}
        </tbody>
      </table>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete secret"
        message={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.name}"? This action cannot be undone.`
            : ""
        }
        confirmLabel={deleting ? "Deleting..." : "Delete"}
        intent="error"
      />
    </div>
  );
}
