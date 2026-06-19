import { useState, useCallback } from 'react';
import { KeyRound, Layers, Plus } from 'lucide-react';
import { Button } from '../components/atoms/Button';
import { Card } from '../components/molecules/Card';
import { EmptyState } from '../components/molecules/EmptyState';
import { Modal } from '../components/molecules/Modal';
import { SecretForm } from '../components/SecretForm';
import { ScopedSecretList } from '../components/ScopedSecretList';
import { UserSecretBindingForm } from '../components/UserSecretBindingForm';
import { useParams } from 'react-router-dom';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { Spinner } from '../components/atoms/Spinner';

export function WorkspaceSecretsPage() {
  const { orgSlug, workspaceSlug } = useParams<{ orgSlug: string; workspaceSlug: string }>();
  const { currentWorkspace, isLoading: isWorkspaceLoading } = useWorkspace();
  const [showAddForm, setShowAddForm] = useState(false);
  const [showBindings, setShowBindings] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const scopeType = 'workspace' as const;
  const scopeId = currentWorkspace?.workspaceId ?? '';

  const handleSecretCreated = useCallback(() => {
    setShowAddForm(false);
    setRefreshKey((k) => k + 1);
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

  if (!scopeId) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-8">
        <div className="flex items-center gap-2 pb-6 border-b border-border dark:border-border-dark">
          <KeyRound className="w-6 h-6 text-primary" aria-hidden="true" />
          <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark">
            Secrets
          </h1>
        </div>
        <EmptyState
          icon={<Layers className="w-12 h-12 text-text-muted" strokeWidth={1.5} />}
          title="Workspace unavailable"
          description="This workspace could not be resolved. It may not exist, or you may not have access to it."
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between pb-6 border-b border-border dark:border-border-dark">
        <div>
          <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark flex items-center gap-2">
            <KeyRound className="w-6 h-6 text-primary" aria-hidden="true" />
            Secrets
          </h1>
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark mt-1">
            {orgSlug}/{workspaceSlug} — Manage scoped secrets. Values are encrypted client-side.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowBindings(!showBindings)}
          >
            {showBindings ? 'Hide bindings' : 'User bindings'}
          </Button>
          <Button
            variant="primary"
            intent="success"
            size="sm"
            onClick={() => setShowAddForm(true)}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add secret
          </Button>
        </div>
      </div>

      {/* Add secret modal */}
      <Modal
        isOpen={showAddForm}
        onClose={() => setShowAddForm(false)}
        title="Add workspace secret"
        size="sm"
      >
        <div className="p-5">
          <SecretForm
            scopeType={scopeType}
            scopeId={scopeId}
            onCreated={handleSecretCreated}
          />
        </div>
      </Modal>

      {/* User-secret bindings */}
      {showBindings && (
        <Card title="User-secret bindings" collapsible defaultExpanded>
          <UserSecretBindingForm
            targetScopeType="workspace"
            targetScopeId={scopeId}
          />
        </Card>
      )}

      {/* Secret list */}
      <Card title="Workspace secrets" collapsible defaultExpanded>
        <ScopedSecretList
          key={refreshKey}
          scopeType={scopeType}
          scopeId={scopeId}
          onChanged={handleChanged}
        />
      </Card>
    </div>
  );
}
