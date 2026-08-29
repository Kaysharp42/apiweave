import { useState, useEffect } from "react";
import { toast } from "sonner";
import { KeyRound, Layers, Plus } from "lucide-react";
import { Button } from "../components/atoms/Button";
import { DetailsPanel } from "../components/molecules/DetailsPanel";
import { EmptyState } from "../components/molecules/EmptyState";
import { ErrorBanner } from "../components/molecules/ErrorBanner";
import { Modal } from "../components/molecules/Modal";
import { SecretForm } from "../components/SecretForm";
import { SecretDetailsCard } from "../components/organisms/SecretDetailsCard";
import { WorkspacePageHeader } from "../components/organisms/WorkspacePageHeader";
import { WorkspaceSecretGroups } from "../components/organisms/WorkspaceSecretGroups";
import { DuplicateItemDialog } from "../components/organisms/DuplicateItemDialog";
import { MoveToWorkspaceDialog } from "../components/organisms/MoveToWorkspaceDialog";
import { useParams } from "react-router-dom";
import { useWorkspace } from "../contexts/WorkspaceContext";
import { Spinner } from "../components/atoms/Spinner";
import { apiweave } from "../utils/apiweaveClient";
import type { SecretTarget, WorkspaceOption } from "../types";

/** The workspace scope of `workspaceId` — the destination every action here targets. */
const workspaceScope = (workspaceId: string, name?: string) => ({
  workspaceId,
  scopeType: "workspace" as const,
  scopeId: workspaceId,
  ...(name ? { name } : {}),
});

/**
 * The move warnings for a workspace-scoped secret, phrased for the user: the
 * value leaves the workspace, and requests there go out with the placeholder
 * unresolved. The mirror of `environmentMoveWarnings` on the environments page.
 */
const secretMoveWarnings = (secretName: string): readonly string[] => [
  "The encrypted value moves with it — it stops resolving in the workspace it leaves.",
  "Any request there referencing {{secrets." +
    secretName +
    "}} will go out with the placeholder unresolved.",
];

/**
 * The workspace list that drives the groups, active workspace first — it is the
 * one the user can act on in full.
 *
 * Each group fetches its own secrets, so there is no list-every-secret read to
 * add and every list call stays authorized against the workspace that owns the
 * scope it names; this hook only supplies the group headings.
 */
function useWorkspaceOptions(activeWorkspaceId: string): WorkspaceOption[] {
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
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
            .sort((a, b) =>
              a.workspaceId === activeWorkspaceId
                ? -1
                : b.workspaceId === activeWorkspaceId
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
  }, [activeWorkspaceId]);
  return workspaces;
}

// fallow-ignore-next-line complexity -- the page is the coordinator: it wires the workspace groups, the add-secret modal, the duplicate and move dialogs and the details panel to one refresh and one error strip, and every remaining branch is one of those dialog/action states. The lists themselves live in WorkspaceSecretGroups and ScopedSecretList, the row in SecretRow, the details card in SecretDetailsCard
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

  const scopeType = "workspace" as const;
  const scopeId = currentWorkspace?.workspaceId ?? "";
  const workspaces = useWorkspaceOptions(scopeId);

  const [duplicating, setDuplicating] = useState<SecretTarget | null>(null);
  const [moving, setMoving] = useState<SecretTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  const handleSecretCreated = () => {
    setShowAddForm(false);
    setSelectedSecret(null);
    refresh();
  };

  const handleChanged = () => {
    setSelectedSecret(null);
    refresh();
  };

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
    <WorkspacePageHeader
      icon={
        <KeyRound
          className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark"
          aria-hidden="true"
        />
      }
      title="Secrets"
      orgSlug={orgSlug}
      workspaceSlug={workspaceSlug}
      fallbackSubtitle="Each secret belongs to one workspace"
    />
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

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

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

          <DetailsPanel
            title={secret?.name ?? ""}
            hasItem={selectedSecret !== null}
            empty={
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
            }
          >
            {selectedSecret && (
              <SecretDetailsCard
                secret={selectedSecret.secret}
                workspaceName={
                  workspaces.find(
                    (w) => w.workspaceId === selectedSecret.workspaceId,
                  )?.name ?? "Unknown workspace"
                }
              />
            )}
          </DetailsPanel>
        </div>
      </div>

      <DuplicateItemDialog
        open={duplicating !== null}
        kind="secret"
        sourceName={duplicating?.secret.name ?? ""}
        sourceWorkspaceId={duplicating?.workspaceId ?? ""}
        onClose={() => setDuplicating(null)}
        onConfirm={handleDuplicate}
      />

      <MoveToWorkspaceDialog
        open={moving !== null}
        itemKind="secret"
        itemName={moving?.secret.name ?? ""}
        currentWorkspaceId={moving?.workspaceId ?? ""}
        warnings={secretMoveWarnings(moving?.secret.name ?? "NAME")}
        onClose={() => setMoving(null)}
        onConfirm={handleMove}
      />
    </div>
  );
}
