import { useState, useCallback } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import { Button } from '../components/atoms/Button';
import { Card } from '../components/molecules/Card';
import { Modal } from '../components/molecules/Modal';
import { SecretForm } from '../components/SecretForm';
import { ScopedSecretList } from '../components/ScopedSecretList';
import { UserSecretBindingForm } from '../components/UserSecretBindingForm';
import { useParams } from 'react-router-dom';

/**
 * WorkspaceSecretsPage — scoped secret management for a workspace.
 *
 * Provides:
 * - Secret creation form (public-key encrypted write flow)
 * - Metadata-only secret list (no values/ciphertext)
 * - Override indicator for environment scope
 * - Delete confirmation modal
 * - User-secret binding UI
 */
export function WorkspaceSecretsPage() {
  const { orgSlug, workspaceSlug } = useParams<{ orgSlug: string; workspaceSlug: string }>();
  const [showAddForm, setShowAddForm] = useState(false);
  const [showBindings, setShowBindings] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // In a real implementation, these would come from a workspace context or API lookup
  const scopeType = 'workspace' as const;
  const scopeId = workspaceSlug ?? '';

  const handleSecretCreated = useCallback(() => {
    setShowAddForm(false);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleChanged = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-text-primary dark:text-text-primary-dark flex items-center gap-2">
            <KeyRound className="w-6 h-6 text-primary" aria-hidden="true" />
            Secrets
          </h1>
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark mt-1">
            {orgSlug}/{workspaceSlug} — Manage scoped secrets. Values are encrypted client-side.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
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
