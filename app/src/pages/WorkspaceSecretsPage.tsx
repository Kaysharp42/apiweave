import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { KeyRound, Layers, Plus } from "lucide-react";
import { Button } from "../components/atoms/Button";
import { Card } from "../components/molecules/Card";
import { EmptyState } from "../components/molecules/EmptyState";
import { Modal } from "../components/molecules/Modal";
import { SecretForm } from "../components/SecretForm";
import { WorkspaceSecretGroups } from "../components/organisms/WorkspaceSecretGroups";
import { DuplicateSecretDialog } from "../components/organisms/DuplicateSecretDialog";
import { MoveToWorkspaceDialog } from "../components/organisms/MoveToWorkspaceDialog";
import { useParams } from "react-router-dom";
import { useWorkspace } from "../contexts/WorkspaceContext";
import { Spinner } from "../components/atoms/Spinner";
import { apiweave } from "../utils/apiweaveClient";
import type { SecretTarget } from "../components/organisms/WorkspaceSecretGroups";
import type { WorkspaceOption } from "../types";

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

/** The workspace scope of `workspaceId` — the destination every action here targets. */
const workspaceScope = (workspaceId: string, name?: string) => ({
  workspaceId,
  scopeType: "workspace" as const,
  scopeId: workspaceId,
  ...(name ? { name } : {}),
});

export function WorkspaceSecretsPage() {
  const { orgSlug, workspaceSlug } = useParams<{
    orgSlug: string;
    workspaceSlug: string;
  }>();
  const { currentWorkspace, isLoading: isWorkspaceLoading } = useWorkspace();
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedSecret, setSelectedSecret] = useState<SecretTarget | null>(
    null,
  );
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [duplicating, setDuplicating] = useState<SecretTarget | null>(null);
  const [moving, setMoving] = useState<SecretTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const scopeType = "workspace" as const;
  const scopeId = currentWorkspace?.workspaceId ?? "";

  /**
   * The workspace list drives the groups; each group fetches its own secrets, so
   * there is no list-every-secret read to add and every list call stays
   * authorized against the workspace that owns the scope it names.
   */
  useEffect(() => {
    let cancelled = false;
    void apiweave.workspaces
      .list()
      .then((all) => {
        if (cancelled) return;
        setWorkspaces(
          all
            .map((w) => ({
              workspaceId: w.workspaceId,
              name: w.name,
              slug: w.slug,
            }))
            // Active workspace first — it is the one the user can act on in full.
            .sort((a, b) =>
              a.workspaceId === scopeId
                ? -1
                : b.workspaceId === scopeId
                  ? 1
                  : a.name.localeCompare(b.name),
            ),
        );
      })
      .catch(() => {
        if (!cancelled) setWorkspaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, [scopeId]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const handleSecretCreated = useCallback(() => {
    setShowAddForm(false);
    setSelectedSecret(null);
    refresh();
  }, [refresh]);

  const handleChanged = useCallback(() => {
    setSelectedSecret(null);
    refresh();
  }, [refresh]);

  async function handleDuplicate(name: string, targetWorkspaceId: string) {
    if (!duplicating) return;
    try {
      await apiweave.secrets.duplicate(
        duplicating.workspaceId,
        "workspace",
        duplicating.workspaceId,
        duplicating.secret.name,
        workspaceScope(targetWorkspaceId, name),
      );
      setDuplicating(null);
      refresh();
      toast.success(`Duplicated as "${name}"`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to duplicate secret",
      );
    }
  }

  async function handleMove(targetWorkspaceId: string) {
    if (!moving) return;
    try {
      await apiweave.secrets.moveToScope(
        moving.workspaceId,
        "workspace",
        moving.workspaceId,
        moving.secret.name,
        workspaceScope(targetWorkspaceId),
      );
      if (selectedSecret?.secret.secretId === moving.secret.secretId) {
        setSelectedSecret(null);
      }
      setMoving(null);
      refresh();
      toast.success(`Moved "${moving.secret.name}"`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move secret");
    }
  }

  const header = (
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
            : "Each secret belongs to one workspace"}
        </p>
      </div>
    </div>
  );

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
        {header}
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

  const secret = selectedSecret?.secret ?? null;

  return (
    <div className="flex flex-col h-full">
      {header}

      {error && (
        <div className="mx-6 mt-4 p-3 rounded bg-status-error/10 dark:bg-status-error/20 border border-status-error/30 text-sm text-status-error">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 underline cursor-pointer text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

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

            <WorkspaceSecretGroups
              workspaces={workspaces}
              activeWorkspaceId={scopeId}
              refreshKey={refreshKey}
              selectedId={secret?.secretId}
              onSelect={(picked, workspaceId) =>
                setSelectedSecret({ secret: picked, workspaceId })
              }
              onChanged={handleChanged}
              onDuplicate={setDuplicating}
              onMove={setMoving}
            />
          </div>

          <div className="space-y-4">
            {secret && selectedSecret ? (
              <Card title={secret.name}>
                <div className="space-y-3">
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Workspace
                    </span>
                    <p className="text-sm text-text-primary dark:text-text-primary-dark">
                      {workspaces.find(
                        (w) => w.workspaceId === selectedSecret.workspaceId,
                      )?.name ?? "Unknown workspace"}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Key name
                    </span>
                    <p className="text-sm font-mono text-text-primary dark:text-text-primary-dark">
                      {secret.name}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Scope
                    </span>
                    <p className="text-sm capitalize text-text-primary dark:text-text-primary-dark">
                      {secret.scopeType}
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
                      {formatDate(secret.createdAt)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Updated
                    </span>
                    <p className="text-sm text-text-primary dark:text-text-primary-dark">
                      {formatDate(secret.updatedAt)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Key ID
                    </span>
                    <p className="break-all text-sm font-mono text-text-primary dark:text-text-primary-dark">
                      {secret.keyId}
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

      <DuplicateSecretDialog
        open={duplicating !== null}
        secret={duplicating?.secret ?? null}
        sourceWorkspaceId={duplicating?.workspaceId ?? ""}
        onClose={() => setDuplicating(null)}
        onConfirm={handleDuplicate}
      />

      <MoveToWorkspaceDialog
        open={moving !== null}
        itemKind="secret"
        itemName={moving?.secret.name ?? ""}
        currentWorkspaceId={moving?.workspaceId ?? ""}
        warnings={[
          "The encrypted value moves with it — it stops resolving in the workspace it leaves.",
          "Any request there referencing {{secrets." +
            (moving?.secret.name ?? "NAME") +
            "}} will go out with the placeholder unresolved.",
        ]}
        onClose={() => setMoving(null)}
        onConfirm={(targetWorkspaceId) => handleMove(targetWorkspaceId)}
      />
    </div>
  );
}
