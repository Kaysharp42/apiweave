import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { Settings, Plus, Layers } from "lucide-react";
import { Button } from "../components/atoms/Button";
import { Spinner } from "../components/atoms/Spinner";
import { Card } from "../components/molecules/Card";
import { EmptyState } from "../components/molecules/EmptyState";
import { WorkspaceEnvironmentGroups } from "../components/organisms/WorkspaceEnvironmentGroups";
import { DuplicateEnvironmentDialog } from "../components/organisms/DuplicateEnvironmentDialog";
import { MoveToWorkspaceDialog } from "../components/organisms/MoveToWorkspaceDialog";
import { EnvironmentForm } from "../components/organisms/EnvironmentForm";
import { apiweave, authenticatedJson } from "../utils/apiweaveClient";
import { environmentMoveWarnings } from "../utils/workspaceMoveWarnings";
import { useWorkspace } from "../contexts/WorkspaceContext";
import useEnvironmentStore from "../stores/EnvironmentStore";
import type { WorkspaceEnvironmentGroup } from "../components/organisms/WorkspaceEnvironmentGroups";
import type {
  ScopedEnvironment,
  EnvironmentFormData,
  WorkspaceOption,
  Workflow,
} from "../types";

type ViewMode = "list" | "create" | "edit";

/** An environment plus the workspace it belongs to — the pair every action needs. */
interface EnvironmentTarget {
  readonly environment: ScopedEnvironment;
  readonly workspaceId: string;
}

export default function WorkspaceEnvironmentsPage() {
  const { orgSlug, workspaceSlug } = useParams<{
    orgSlug: string;
    workspaceSlug: string;
  }>();
  const { currentWorkspace, isLoading: isWorkspaceLoading } = useWorkspace();

  const environments = useEnvironmentStore((s) => s.environments);
  const storeIsLoading = useEnvironmentStore((s) => s.isLoading);

  const [orgWorkspaces, setOrgWorkspaces] = useState<WorkspaceOption[]>([]);
  const [groups, setGroups] = useState<WorkspaceEnvironmentGroup[]>([]);

  const [selectedEnv, setSelectedEnv] = useState<ScopedEnvironment | null>(
    null,
  );
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState<EnvironmentTarget | null>(
    null,
  );
  const [moving, setMoving] = useState<EnvironmentTarget | null>(null);
  const [moveWarnings, setMoveWarnings] = useState<string[]>([]);

  const workspaceId = currentWorkspace?.workspaceId ?? "";

  /**
   * One group per workspace, fetched a workspace at a time.
   *
   * There is no list-every-environment read on purpose. `environments.list` is
   * workspace-scoped and authorized per workspace, which is exactly the boundary
   * this page is here to make visible; fanning out over the workspace list keeps
   * that boundary in the read path instead of adding an endpoint that steps
   * around it. Every call is local SQLite over IPC and a desktop install has a
   * handful of workspaces.
   */
  const refreshEnvironments = useCallback(async () => {
    if (!workspaceId) {
      if (!isWorkspaceLoading) setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // The store holds the ACTIVE workspace only — it is what the run-time
      // environment picker reads, and it must never see another workspace's
      // environments. The grouped view below is a separate, read-only fan-out.
      await useEnvironmentStore.getState().fetchEnvironments(workspaceId);

      const workspaces = await apiweave.workspaces.list();
      setOrgWorkspaces(
        workspaces.map((w) => ({
          workspaceId: w.workspaceId,
          name: w.name,
          slug: w.slug,
        })),
      );

      const loaded = await Promise.all(
        workspaces.map(async (workspace) => {
          const result = await apiweave.environments
            .list(workspace.workspaceId)
            .catch(() => ({ items: [] as ScopedEnvironment[] }));
          return {
            workspaceId: workspace.workspaceId,
            name: workspace.name,
            environments: [...result.items] as ScopedEnvironment[],
          };
        }),
      );
      // Active workspace first — it is the one the user can act on in full.
      setGroups(
        loaded.sort((a, b) =>
          a.workspaceId === workspaceId
            ? -1
            : b.workspaceId === workspaceId
              ? 1
              : a.name.localeCompare(b.name),
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load environments",
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceId, isWorkspaceLoading]);

  useEffect(() => {
    void refreshEnvironments();
  }, [refreshEnvironments]);

  // ---- CRUD Handlers ----

  async function handleCreateEnv(data: EnvironmentFormData) {
    if (!workspaceId) return;
    setSaving(true);
    try {
      await authenticatedJson<ScopedEnvironment>(
        `/api/workspaces/${workspaceId}/environments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: data.name,
            description: data.description || undefined,
            swaggerDocUrl: data.swaggerDocUrl || undefined,
            baseEnvironmentId: data.baseEnvironmentId,
            variables: data.variables,
          }),
        },
      );
      setViewMode("list");
      await refreshEnvironments();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create environment",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateEnv(data: EnvironmentFormData) {
    if (!selectedEnv || !workspaceId) return;
    setSaving(true);
    try {
      await authenticatedJson<ScopedEnvironment>(
        `/api/workspaces/${workspaceId}/environments/${selectedEnv.environmentId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: data.name,
            description: data.description || undefined,
            swaggerDocUrl: data.swaggerDocUrl || undefined,
            baseEnvironmentId: data.baseEnvironmentId,
            variables: data.variables,
          }),
        },
      );
      setViewMode("list");
      setSelectedEnv(null);
      await refreshEnvironments();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update environment",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteEnv(env: ScopedEnvironment) {
    if (!workspaceId) return;
    if (env.isDefault) {
      setError("Cannot delete the default workspace environment");
      return;
    }
    try {
      await authenticatedJson(
        `/api/workspaces/${workspaceId}/environments/${env.environmentId}`,
        { method: "DELETE" },
      );
      if (selectedEnv?.environmentId === env.environmentId) {
        setSelectedEnv(null);
        setViewMode("list");
      }
      await refreshEnvironments();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete environment",
      );
    }
  }

  async function handleDuplicateEnv(name: string, targetWorkspaceId: string) {
    if (!duplicating) return;
    try {
      const copy = await apiweave.environments.duplicate(
        duplicating.workspaceId,
        duplicating.environment.environmentId,
        targetWorkspaceId,
        name,
      );
      setDuplicating(null);
      await refreshEnvironments();
      toast.success(`Duplicated as "${copy.name}"`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to duplicate environment",
      );
    }
  }

  /**
   * Warnings are computed against the environment's OWN workspace, not the
   * active one — this page can move an environment that lives elsewhere, and
   * the references that get cleared are the ones in the workspace it leaves.
   */
  async function openMoveDialog(
    env: ScopedEnvironment,
    envWorkspaceId: string,
  ) {
    setMoving({ environment: env, workspaceId: envWorkspaceId });
    setMoveWarnings([]);
    const workflows = await apiweave.workflows
      .list(envWorkspaceId, true)
      .then((result) => result.items as Workflow[])
      .catch(() => [] as Workflow[]);
    const siblings =
      groups.find((group) => group.workspaceId === envWorkspaceId)
        ?.environments ?? [];
    setMoveWarnings(environmentMoveWarnings(env, workflows, siblings));
  }

  async function handleMoveEnv(targetWorkspaceId: string) {
    if (!moving) return;
    try {
      await apiweave.environments.moveToWorkspace(
        moving.workspaceId,
        moving.environment.environmentId,
        targetWorkspaceId,
      );
      if (selectedEnv?.environmentId === moving.environment.environmentId) {
        setSelectedEnv(null);
      }
      setMoving(null);
      await refreshEnvironments();
      toast.success(`Moved "${moving.environment.name}"`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to move environment",
      );
    }
  }

  function handleSelectEnv(env: ScopedEnvironment) {
    setSelectedEnv(env);
    setViewMode("list");
  }

  // ---- Render ----

  if (isWorkspaceLoading || loading || storeIsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  const header = (
    <div className="flex items-center gap-3 px-6 py-6 border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
      <Settings className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark" />
      <div>
        <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark">
          Environments
        </h1>
        <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
          {orgSlug && workspaceSlug
            ? `${orgSlug} / ${workspaceSlug}`
            : "Each environment belongs to one workspace"}
        </p>
      </div>
    </div>
  );

  if (!workspaceId) {
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

  return (
    <div className="flex flex-col h-full">
      {header}

      {/* Error banner */}
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Create mode */}
        {viewMode === "create" && (
          <EnvironmentForm
            onSubmit={handleCreateEnv}
            onCancel={() => setViewMode("list")}
            submitting={saving}
            availableWorkspaces={orgWorkspaces}
            showAllowedWorkspaces={false}
            availableEnvironments={environments}
          />
        )}

        {/* Edit mode */}
        {viewMode === "edit" && selectedEnv && (
          <EnvironmentForm
            environment={selectedEnv}
            onSubmit={handleUpdateEnv}
            onCancel={() => setViewMode("list")}
            submitting={saving}
            availableWorkspaces={orgWorkspaces}
            showAllowedWorkspaces={false}
            availableEnvironments={environments}
          />
        )}

        {/* List mode */}
        {viewMode === "list" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: environments grouped by the workspace that owns them */}
            <div className="lg:col-span-2 space-y-6">
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  intent="success"
                  size="sm"
                  icon={<Plus className="w-4 h-4" />}
                  onClick={() => setViewMode("create")}
                >
                  New Environment
                </Button>
              </div>

              <WorkspaceEnvironmentGroups
                groups={groups}
                activeWorkspaceId={workspaceId}
                selectedId={selectedEnv?.environmentId}
                onSelect={handleSelectEnv}
                onCreate={() => setViewMode("create")}
                onEdit={(env) => {
                  setSelectedEnv(env);
                  setViewMode("edit");
                }}
                onDelete={handleDeleteEnv}
                onDuplicate={(env, envWorkspaceId) =>
                  setDuplicating({
                    environment: env,
                    workspaceId: envWorkspaceId,
                  })
                }
                onMove={(env, envWorkspaceId) =>
                  void openMoveDialog(env, envWorkspaceId)
                }
              />
            </div>

            {/* Right: Selected env details */}
            <div className="space-y-4">
              {selectedEnv ? (
                <Card title={selectedEnv.name}>
                  <div className="space-y-3">
                    <div>
                      <span className="text-xs text-text-muted dark:text-text-muted-dark">
                        Workspace
                      </span>
                      <p className="text-sm text-text-primary dark:text-text-primary-dark">
                        {orgWorkspaces.find(
                          (w) => w.workspaceId === selectedEnv.scopeId,
                        )?.name ?? "Unknown workspace"}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-text-muted dark:text-text-muted-dark">
                        Description
                      </span>
                      <p className="text-sm text-text-primary dark:text-text-primary-dark">
                        {selectedEnv.description || "No description"}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-text-muted dark:text-text-muted-dark">
                        Variables
                      </span>
                      <p className="text-sm text-text-primary dark:text-text-primary-dark">
                        {Object.keys(selectedEnv.variables).length} variable
                        {Object.keys(selectedEnv.variables).length !== 1
                          ? "s"
                          : ""}
                      </p>
                    </div>
                  </div>
                </Card>
              ) : (
                <EmptyState
                  icon={
                    <Layers
                      className="w-12 h-12 text-text-muted"
                      strokeWidth={1.5}
                    />
                  }
                  title="Select an environment"
                  description="Choose an environment from the list to view details."
                />
              )}
            </div>
          </div>
        )}
      </div>

      <DuplicateEnvironmentDialog
        open={duplicating !== null}
        environment={duplicating?.environment ?? null}
        sourceWorkspaceId={duplicating?.workspaceId ?? ""}
        onClose={() => setDuplicating(null)}
        onConfirm={handleDuplicateEnv}
      />

      <MoveToWorkspaceDialog
        open={moving !== null}
        itemKind="environment"
        itemName={moving?.environment.name ?? ""}
        currentWorkspaceId={moving?.workspaceId ?? ""}
        warnings={moveWarnings}
        onClose={() => setMoving(null)}
        onConfirm={(targetWorkspaceId) => handleMoveEnv(targetWorkspaceId)}
      />
    </div>
  );
}
