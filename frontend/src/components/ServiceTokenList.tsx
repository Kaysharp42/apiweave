import { useState, useEffect, useCallback } from "react";
import { Ban, RefreshCw, Shield } from "lucide-react";
import { Button } from "./atoms/Button";
import { IconButton } from "./atoms/IconButton";
import { Badge } from "./atoms/Badge";
import { EmptyState } from "./molecules/EmptyState";
import { ConfirmDialog } from "./molecules/ConfirmDialog";
import { Modal } from "./molecules/Modal";
import { TokenValueDisplay } from "./TokenValueDisplay";
import { authenticatedJson } from "../utils/authenticatedApi";
import API_BASE_URL from "../utils/api";
import type { ServiceToken } from "../types";

export interface ServiceTokenListProps {
  scopeType: "workspace" | "organization";
  scopeId: string;
  /** Called after a token action to refresh parent state. */
  onChanged: () => void;
  onSelect?: ((token: ServiceToken) => void) | undefined;
  selectedId?: string | undefined;
  className?: string;
}

interface TokenListResponse {
  tokens: ServiceToken[];
  total: number;
}

interface RotateResponse {
  tokenId: string;
  name: string;
  token: string;
  rotatedAt: string;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function isExpired(expiresAt: string | undefined): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

function isRevoked(revokedAt: string | undefined): boolean {
  return !!revokedAt;
}

/**
 * ServiceTokenList — displays service tokens with metadata only.
 *
 * NEVER shows token values after creation. Supports revoke and rotate actions.
 */
export function ServiceTokenList({
  scopeType,
  scopeId,
  onChanged,
  onSelect,
  selectedId,
  className = "",
}: ServiceTokenListProps) {
  const [tokens, setTokens] = useState<ServiceToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ServiceToken | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [rotateTarget, setRotateTarget] = useState<ServiceToken | null>(null);
  const [rotating, setRotating] = useState(false);
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null);
  const [narrowTarget, setNarrowTarget] = useState<ServiceToken | null>(null);
  const [narrowPermissions, setNarrowPermissions] = useState<string[]>([]);

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await authenticatedJson<TokenListResponse>(
        `${API_BASE_URL}/api/scopes/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}/tokens`,
      );
      setTokens(data.tokens);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load tokens";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [scopeType, scopeId]);

  useEffect(() => {
    void fetchTokens();
  }, [fetchTokens]);

  const handleRevoke = useCallback(async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await authenticatedJson(
        `${API_BASE_URL}/api/scopes/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}/tokens/${encodeURIComponent(revokeTarget.tokenId)}/revoke`,
        { method: "POST" },
      );
      setRevokeTarget(null);
      onChanged();
      await fetchTokens();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to revoke token";
      setError(message);
    } finally {
      setRevoking(false);
    }
  }, [revokeTarget, scopeType, scopeId, onChanged, fetchTokens]);

  const handleRotate = useCallback(async () => {
    if (!rotateTarget) return;
    setRotating(true);
    try {
      const response = await authenticatedJson<RotateResponse>(
        `${API_BASE_URL}/api/scopes/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}/tokens/${encodeURIComponent(rotateTarget.tokenId)}/rotate`,
        { method: "POST" },
      );
      setRotateTarget(null);
      setNewTokenValue(response.token);
      onChanged();
      await fetchTokens();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to rotate token";
      setError(message);
    } finally {
      setRotating(false);
    }
  }, [rotateTarget, scopeType, scopeId, onChanged, fetchTokens]);

  const handleNarrow = useCallback(async () => {
    if (!narrowTarget) return;
    try {
      await authenticatedJson(
        `${API_BASE_URL}/api/scopes/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}/tokens/${encodeURIComponent(narrowTarget.tokenId)}/permissions`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permissions: narrowPermissions }),
        },
      );
      setNarrowTarget(null);
      setNarrowPermissions([]);
      onChanged();
      await fetchTokens();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update permissions";
      setError(message);
    }
  }, [
    narrowTarget,
    narrowPermissions,
    scopeType,
    scopeId,
    onChanged,
    fetchTokens,
  ]);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center py-8"
        aria-label="Loading tokens"
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

  if (tokens.length === 0) {
    return (
      <EmptyState
        icon={
          <Shield
            className="w-10 h-10 text-text-muted dark:text-text-muted-dark"
            strokeWidth={1.5}
          />
        }
        title="No service tokens"
        description="Create a service token for CI/CD, MCP, or webhook integrations."
        className={className}
      />
    );
  }

  return (
    <div className={className}>
      {/* One-time token display after rotation */}
      {newTokenValue && (
        <div className="mb-4">
          <TokenValueDisplay
            tokenValue={newTokenValue}
            onDismiss={() => setNewTokenValue(null)}
          />
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border dark:border-border-dark">
            <th className="text-left py-2 px-3 text-xs font-medium text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider">
              Name
            </th>
            <th className="text-left py-2 px-3 text-xs font-medium text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider">
              Permissions
            </th>
            <th className="text-left py-2 px-3 text-xs font-medium text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider">
              Status
            </th>
            <th className="text-left py-2 px-3 text-xs font-medium text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider">
              Last used
            </th>
            <th className="text-left py-2 px-3 text-xs font-medium text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider">
              Expires
            </th>
            <th className="text-right py-2 px-3 text-xs font-medium text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => {
            const revoked = isRevoked(token.revokedAt);
            const expired = isExpired(token.expiresAt);
            const inactive = revoked || expired;
            const selected = selectedId === token.tokenId;

            return (
              <tr
                key={token.tokenId}
                onClick={() => onSelect?.(token)}
                onKeyDown={(event) => {
                  if (!onSelect) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(token);
                  }
                }}
                tabIndex={onSelect ? 0 : undefined}
                role={onSelect ? "button" : undefined}
                aria-pressed={onSelect ? selected : undefined}
                className={[
                  "border-b border-border/50 dark:border-border-dark/50 transition-colors focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]",
                  onSelect && "cursor-pointer",
                  selected && "bg-primary/5 dark:bg-primary-light/10",
                  inactive
                    ? "opacity-50"
                    : "hover:bg-surface-overlay/50 dark:hover:bg-surface-dark-overlay/50",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <td className="py-2.5 px-3">
                  <div>
                    <span className="text-text-primary dark:text-text-primary-dark font-medium">
                      {token.name}
                    </span>
                    {token.description && (
                      <p className="text-xs text-text-muted dark:text-text-muted-dark mt-0.5 truncate max-w-[200px]">
                        {token.description}
                      </p>
                    )}
                  </div>
                </td>
                <td className="py-2.5 px-3">
                  <div className="flex flex-wrap gap-1">
                    {token.permissions.slice(0, 3).map((perm) => (
                      <Badge key={perm} variant="ghost" size="xs">
                        {perm}
                      </Badge>
                    ))}
                    {token.permissions.length > 3 && (
                      <Badge variant="ghost" size="xs">
                        +{token.permissions.length - 3}
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="py-2.5 px-3">
                  {revoked ? (
                    <Badge variant="error" size="xs">
                      Revoked
                    </Badge>
                  ) : expired ? (
                    <Badge variant="warning" size="xs">
                      Expired
                    </Badge>
                  ) : (
                    <Badge variant="success" size="xs">
                      Active
                    </Badge>
                  )}
                </td>
                <td className="py-2.5 px-3 text-text-secondary dark:text-text-secondary-dark text-xs">
                  {formatDate(token.lastUsedAt)}
                </td>
                <td className="py-2.5 px-3 text-text-secondary dark:text-text-secondary-dark text-xs">
                  {formatDate(token.expiresAt)}
                </td>
                <td className="py-2.5 px-3 text-right">
                  {!inactive && (
                    <div
                      className="flex items-center justify-end gap-1"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <IconButton
                        tooltip="Narrow permissions"
                        size="xs"
                        onClick={() => {
                          setNarrowTarget(token);
                          setNarrowPermissions([...token.permissions]);
                        }}
                      >
                        <Shield className="w-4 h-4" aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        tooltip="Rotate token"
                        size="xs"
                        variant="warning"
                        onClick={() => setRotateTarget(token)}
                      >
                        <RefreshCw className="w-4 h-4" aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        tooltip="Revoke token"
                        size="xs"
                        variant="error"
                        onClick={() => setRevokeTarget(token)}
                      >
                        <Ban className="w-4 h-4" aria-hidden="true" />
                      </IconButton>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Revoke confirmation */}
      <ConfirmDialog
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevoke}
        title="Revoke token"
        message={
          revokeTarget
            ? `Revoke "${revokeTarget.name}"? This immediately invalidates the token for all subsequent calls.`
            : ""
        }
        confirmLabel={revoking ? "Revoking..." : "Revoke"}
        intent="error"
      />

      {/* Rotate confirmation */}
      <ConfirmDialog
        open={!!rotateTarget}
        onClose={() => setRotateTarget(null)}
        onConfirm={handleRotate}
        title="Rotate token"
        message={
          rotateTarget
            ? `Rotate "${rotateTarget.name}"? The old token is immediately invalidated. A new token value will be shown once.`
            : ""
        }
        confirmLabel={rotating ? "Rotating..." : "Rotate"}
        intent="warning"
      />

      {/* Narrow permissions modal */}
      <Modal
        isOpen={!!narrowTarget}
        onClose={() => {
          setNarrowTarget(null);
          setNarrowPermissions([]);
        }}
        title={`Narrow permissions: ${narrowTarget?.name ?? ""}`}
        size="sm"
      >
        <div className="p-5 space-y-4">
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            Remove permissions from this token. You can only reduce access, not
            add new permissions.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {narrowTarget?.permissions.map((perm) => {
              const selected = narrowPermissions.includes(perm);
              return (
                <button
                  key={perm}
                  type="button"
                  onClick={() =>
                    setNarrowPermissions((prev) =>
                      prev.includes(perm)
                        ? prev.filter((p) => p !== perm)
                        : [...prev, perm],
                    )
                  }
                  className={[
                    "px-2 py-1 text-xs rounded border transition-colors cursor-pointer",
                    selected
                      ? "bg-primary/10 dark:bg-primary-light/20 text-primary dark:text-primary-light border-primary/30"
                      : "bg-surface-overlay/50 dark:bg-surface-dark-overlay/50 text-text-muted line-through border-border dark:border-border-dark",
                  ].join(" ")}
                >
                  {perm}
                </button>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setNarrowTarget(null);
                setNarrowPermissions([]);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              intent="warning"
              size="sm"
              onClick={handleNarrow}
              disabled={
                narrowPermissions.length === narrowTarget?.permissions.length
              }
            >
              Apply narrower permissions
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
