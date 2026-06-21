import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Key, Plus, Shield } from 'lucide-react';
import { Button } from '../components/atoms/Button';
import { Badge } from '../components/atoms/Badge';
import { Spinner } from '../components/atoms/Spinner';
import { Card } from '../components/molecules/Card';
import { EmptyState } from '../components/molecules/EmptyState';
import { Modal } from '../components/molecules/Modal';
import { ServiceTokenCreateForm } from '../components/ServiceTokenCreateForm';
import { ServiceTokenList } from '../components/ServiceTokenList';
import { TokenValueDisplay } from '../components/TokenValueDisplay';
import { useWorkspace } from '../contexts/WorkspaceContext';
import type { ServiceToken, ServiceTokenCreateResponse } from '../types';

function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
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

function isExpired(expiresAt: string | undefined): boolean {
  return expiresAt ? new Date(expiresAt) < new Date() : false;
}

export function WorkspaceTokensPage() {
  const { orgSlug, workspaceSlug } = useParams<{ orgSlug: string; workspaceSlug: string }>();
  const { currentWorkspace, isLoading: isWorkspaceLoading } = useWorkspace();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newToken, setNewToken] = useState<ServiceTokenCreateResponse | null>(null);
  const [selectedToken, setSelectedToken] = useState<ServiceToken | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const scopeType = 'workspace' as const;
  const scopeId = currentWorkspace?.workspaceId ?? '';

  const handleTokenCreated = useCallback((response: ServiceTokenCreateResponse) => {
    setShowCreateForm(false);
    setNewToken(response);
    setSelectedToken(null);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleDismissToken = useCallback(() => {
    setNewToken(null);
  }, []);

  const handleChanged = useCallback(() => {
    setSelectedToken(null);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleSelectToken = useCallback((token: ServiceToken) => {
    setSelectedToken(token);
  }, []);

  if (isWorkspaceLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!scopeId) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-6 border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
          <Shield className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark" aria-hidden="true" />
          <div>
            <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark">
              Service Tokens
            </h1>
            <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
              {orgSlug && workspaceSlug
                ? `${orgSlug} / ${workspaceSlug}`
                : 'Manage scoped service tokens for MCP and webhooks'}
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <EmptyState
            icon={<Shield className="w-12 h-12 text-text-muted" strokeWidth={1.5} />}
            title="Workspace unavailable"
            description="This workspace could not be resolved. It may not exist, or you may not have access to it."
          />
        </div>
      </div>
    );
  }

  const selectedTokenRevoked = !!selectedToken?.revokedAt;
  const selectedTokenExpired = selectedToken ? isExpired(selectedToken.expiresAt) : false;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-6 border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
        <Shield className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark" aria-hidden="true" />
        <div>
          <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark">
            Service Tokens
          </h1>
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            {orgSlug && workspaceSlug
              ? `${orgSlug} / ${workspaceSlug}`
              : 'Manage scoped service tokens for MCP and webhooks'}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {newToken && (
          <TokenValueDisplay
            tokenValue={newToken.token}
            onDismiss={handleDismissToken}
            className="mb-6"
          />
        )}

        <Modal
          isOpen={showCreateForm}
          onClose={() => setShowCreateForm(false)}
          title="Create service token"
          size="md"
        >
          <div className="p-5">
            <ServiceTokenCreateForm
              scopeType={scopeType}
              scopeId={scopeId}
              onCreated={handleTokenCreated}
            />
          </div>
        </Modal>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="flex justify-end">
              <Button
                variant="primary"
                intent="success"
                size="sm"
                icon={<Plus className="w-4 h-4" aria-hidden="true" />}
                onClick={() => setShowCreateForm(true)}
              >
                Create token
              </Button>
            </div>

            <Card title="Active tokens" collapsible defaultExpanded>
              <ServiceTokenList
                key={refreshKey}
                scopeType={scopeType}
                scopeId={scopeId}
                onChanged={handleChanged}
                onSelect={handleSelectToken}
                selectedId={selectedToken?.tokenId}
              />
            </Card>
          </div>

          <div className="space-y-4">
            {selectedToken ? (
              <Card title={selectedToken.name}>
                <div className="space-y-3">
                  {selectedToken.description && (
                    <div>
                      <span className="text-xs text-text-muted dark:text-text-muted-dark">
                        Description
                      </span>
                      <p className="text-sm text-text-primary dark:text-text-primary-dark">
                        {selectedToken.description}
                      </p>
                    </div>
                  )}
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Scope
                    </span>
                    <p className="text-sm text-text-primary dark:text-text-primary-dark capitalize">
                      {selectedToken.scopeType}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Status
                    </span>
                    <p className="mt-1">
                      {selectedTokenRevoked ? (
                        <Badge variant="error" size="xs">Revoked</Badge>
                      ) : selectedTokenExpired ? (
                        <Badge variant="warning" size="xs">Expired</Badge>
                      ) : (
                        <Badge variant="success" size="xs">Active</Badge>
                      )}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Permissions
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {selectedToken.permissions.map((permission) => (
                        <Badge key={permission} variant="ghost" size="xs">
                          {permission}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Created
                    </span>
                    <p className="text-sm text-text-primary dark:text-text-primary-dark">
                      {formatDate(selectedToken.createdAt)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Last used
                    </span>
                    <p className="text-sm text-text-primary dark:text-text-primary-dark">
                      {formatDate(selectedToken.lastUsedAt)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Expires
                    </span>
                    <p className="text-sm text-text-primary dark:text-text-primary-dark">
                      {formatDate(selectedToken.expiresAt)}
                    </p>
                  </div>
                </div>
              </Card>
            ) : (
              <EmptyState
                icon={<Key className="w-12 h-12 text-text-muted" strokeWidth={1.5} />}
                title="Select a token"
                description="Choose a service token from the list to view details."
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
