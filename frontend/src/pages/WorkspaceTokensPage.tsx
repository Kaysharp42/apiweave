import { useState, useCallback } from 'react';
import { Shield, Plus } from 'lucide-react';
import { Button } from '../components/atoms/Button';
import { Card } from '../components/molecules/Card';
import { Modal } from '../components/molecules/Modal';
import { ServiceTokenCreateForm } from '../components/ServiceTokenCreateForm';
import { ServiceTokenList } from '../components/ServiceTokenList';
import { TokenValueDisplay } from '../components/TokenValueDisplay';
import { useParams } from 'react-router-dom';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { Spinner } from '../components/atoms/Spinner';
import type { ServiceTokenCreateResponse } from '../types';

export function WorkspaceTokensPage() {
  const { orgSlug, workspaceSlug } = useParams<{ orgSlug: string; workspaceSlug: string }>();
  const { currentWorkspace, isLoading: isWorkspaceLoading } = useWorkspace();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newToken, setNewToken] = useState<ServiceTokenCreateResponse | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const scopeType = 'workspace' as const;
  const scopeId = currentWorkspace?.workspaceId ?? '';

  const handleTokenCreated = useCallback((response: ServiceTokenCreateResponse) => {
    setShowCreateForm(false);
    setNewToken(response);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleDismissToken = useCallback(() => {
    setNewToken(null);
  }, []);

  const handleChanged = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  if (isWorkspaceLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between pb-6 border-b border-border dark:border-border-dark">
        <div>
          <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" aria-hidden="true" />
            Service Tokens
          </h1>
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark mt-1">
            {orgSlug}/{workspaceSlug} — Manage tokens for CI/CD, MCP, and integrations.
          </p>
        </div>
        <Button
          variant="primary"
          intent="success"
          size="sm"
          onClick={() => setShowCreateForm(true)}
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Create token
        </Button>
      </div>

      {/* One-time token display after creation */}
      {newToken && (
        <TokenValueDisplay
          tokenValue={newToken.token}
          onDismiss={handleDismissToken}
        />
      )}

      {/* Create token modal */}
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

      {/* Token list */}
      <Card title="Active tokens" collapsible defaultExpanded>
        <ServiceTokenList
          key={refreshKey}
          scopeType={scopeType}
          scopeId={scopeId}
          onChanged={handleChanged}
        />
      </Card>
    </div>
  );
}
