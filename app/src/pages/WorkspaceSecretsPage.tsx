import { useState, useCallback } from "react";
import { KeyRound, Layers, Plus } from "lucide-react";
import { Button } from "../components/atoms/Button";
import { Card } from "../components/molecules/Card";
import { EmptyState } from "../components/molecules/EmptyState";
import { Modal } from "../components/molecules/Modal";
import { SecretForm } from "../components/SecretForm";
import { ScopedSecretList } from "../components/ScopedSecretList";
import { useParams } from "react-router-dom";
import { useWorkspace } from "../contexts/WorkspaceContext";
import { Spinner } from "../components/atoms/Spinner";
import type { Secret } from "../types";

function formatDate(iso: string): string {
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

export function WorkspaceSecretsPage() {
  const { orgSlug, workspaceSlug } = useParams<{
    orgSlug: string;
    workspaceSlug: string;
  }>();
  const { currentWorkspace, isLoading: isWorkspaceLoading } = useWorkspace();
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedSecret, setSelectedSecret] = useState<Secret | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const scopeType = "workspace" as const;
  const scopeId = currentWorkspace?.workspaceId ?? "";

  const handleSecretCreated = useCallback(() => {
    setShowAddForm(false);
    setSelectedSecret(null);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleChanged = useCallback(() => {
    setSelectedSecret(null);
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
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-6 border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
          <KeyRound
            className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark"
            aria-hidden="true"
          />
          <div>
            <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark">
              Secrets
            </h1>
            <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
              {orgSlug && workspaceSlug
                ? `${orgSlug} / ${workspaceSlug}`
                : "Manage workspace secrets"}
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <EmptyState
            icon={
              <Layers className="w-12 h-12 text-text-muted" strokeWidth={1.5} />
            }
            title="Workspace unavailable"
            description="This workspace could not be resolved. It may not exist, or you may not have access to it."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-6 border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
        <KeyRound
          className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark"
          aria-hidden="true"
        />
        <div>
          <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark">
            Secrets
          </h1>
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            {orgSlug && workspaceSlug
              ? `${orgSlug} / ${workspaceSlug}`
              : "Manage workspace secrets and user bindings"}
          </p>
        </div>
      </div>

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

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="flex justify-end gap-2">
              <Button
                variant="primary"
                intent="success"
                size="sm"
                icon={<Plus className="w-4 h-4" aria-hidden="true" />}
                onClick={() => setShowAddForm(true)}
              >
                Add secret
              </Button>
            </div>

            <Card title="Workspace secrets" collapsible defaultExpanded>
              <ScopedSecretList
                key={refreshKey}
                scopeType={scopeType}
                scopeId={scopeId}
                onChanged={handleChanged}
                onSelect={setSelectedSecret}
                {...(selectedSecret
                  ? { selectedId: selectedSecret.secretId }
                  : {})}
              />
            </Card>
          </div>

          <div className="space-y-4">
            {selectedSecret ? (
              <Card title={selectedSecret.name}>
                <div className="space-y-3">
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Key name
                    </span>
                    <p className="text-sm font-mono text-text-primary dark:text-text-primary-dark">
                      {selectedSecret.name}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Scope
                    </span>
                    <p className="text-sm capitalize text-text-primary dark:text-text-primary-dark">
                      {selectedSecret.scopeType}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Status
                    </span>
                    <p className="text-sm text-text-primary dark:text-text-primary-dark">
                      Set · encrypted and write-only
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Created
                    </span>
                    <p className="text-sm text-text-primary dark:text-text-primary-dark">
                      {formatDate(selectedSecret.createdAt)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Updated
                    </span>
                    <p className="text-sm text-text-primary dark:text-text-primary-dark">
                      {formatDate(selectedSecret.updatedAt)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Key ID
                    </span>
                    <p className="break-all text-sm font-mono text-text-primary dark:text-text-primary-dark">
                      {selectedSecret.keyId}
                    </p>
                  </div>
                </div>
              </Card>
            ) : (
              <EmptyState
                icon={
                  <KeyRound
                    className="w-12 h-12 text-text-muted"
                    strokeWidth={1.5}
                  />
                }
                title="Select a secret"
                description="Choose a secret from the list to view details."
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
