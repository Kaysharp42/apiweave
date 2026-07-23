import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Settings, Plus, Layers } from "lucide-react";
import { Button } from "../components/atoms/Button";
import { Spinner } from "../components/atoms/Spinner";
import { Card } from "../components/molecules/Card";
import { EmptyState } from "../components/molecules/EmptyState";
import { ScopedEnvironmentList } from "../components/organisms/ScopedEnvironmentList";
import { EnvironmentForm } from "../components/organisms/EnvironmentForm";
import { authenticatedJson } from "../utils/apiweaveClient";
import { useWorkspace } from "../contexts/WorkspaceContext";
import useEnvironmentStore from "../stores/EnvironmentStore";
import type {
  ScopedEnvironment,
  EnvironmentFormData,
  WorkspaceOption,
} from "../types";

type ViewMode = "list" | "create" | "edit";

export default function WorkspaceEnvironmentsPage() {
  const { orgSlug, workspaceSlug } = useParams<{
    orgSlug: string;
    workspaceSlug: string;
  }>();
  const {
    currentOrg,
    currentWorkspace,
    isLoading: isWorkspaceLoading,
  } = useWorkspace();

  const environments = useEnvironmentStore((s) => s.environments);
  const storeIsLoading = useEnvironmentStore((s) => s.isLoading);

  const [orgWorkspaces, setOrgWorkspaces] = useState<WorkspaceOption[]>([]);

  const [selectedEnv, setSelectedEnv] = useState<ScopedEnvironment | null>(
    null,
  );
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orgId = currentOrg?.orgId ?? "";
  const workspaceId = currentWorkspace?.workspaceId ?? "";

  const refreshEnvironments = useCallback(async () => {
    if (!workspaceId) {
      if (!isWorkspaceLoading) setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await useEnvironmentStore.getState().fetchEnvironments(workspaceId);

      // Fetch org workspaces for allowed-workspace selector
      if (orgId) {
        const wsList = await authenticatedJson<
          Array<{ workspaceId: string; name: string; slug: string }>
        >(`/api/orgs/${orgId}/workspaces`).catch(() => []);
        setOrgWorkspaces(
          wsList.map((w) => ({
            workspaceId: w.workspaceId,
            name: w.name,
            slug: w.slug,
          })),
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load environments",
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceId, orgId, isWorkspaceLoading]);

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

  if (!workspaceId) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-6 border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
          <Settings className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark" />
          <div>
            <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark">
              Environments
            </h1>
            <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
              {orgSlug && workspaceSlug
                ? `${orgSlug} / ${workspaceSlug}`
                : "Manage scoped environments and protection policies"}
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
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-6 border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
        <Settings className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark" />
        <div>
          <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark">
            Environments
          </h1>
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            {orgSlug && workspaceSlug
              ? `${orgSlug} / ${workspaceSlug}`
              : "Manage scoped environments and protection policies"}
          </p>
        </div>
      </div>

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
          />
        )}

        {/* List mode */}
        {viewMode === "list" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Environment list */}
            <div className="lg:col-span-2 space-y-6">
              {/* Create button */}
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

              <ScopedEnvironmentList
                environments={environments}
                scopeType="workspace"
                title="Workspace Environments"
                onSelect={handleSelectEnv}
                onCreate={() => setViewMode("create")}
                onEdit={(env) => {
                  setSelectedEnv(env);
                  setViewMode("edit");
                }}
                onDelete={handleDeleteEnv}
                selectedId={selectedEnv?.environmentId}
              />
            </div>

            {/* Right: Selected env details */}
            <div className="space-y-4">
              {selectedEnv ? (
                <Card title={selectedEnv.name}>
                  <div className="space-y-3">
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
                    {selectedEnv.allowedWorkspaceIds.length > 0 && (
                      <div>
                        <span className="text-xs text-text-muted dark:text-text-muted-dark">
                          Allowed Workspaces
                        </span>
                        <p className="text-sm text-text-primary dark:text-text-primary-dark">
                          {selectedEnv.allowedWorkspaceIds.length} workspace
                          {selectedEnv.allowedWorkspaceIds.length !== 1
                            ? "s"
                            : ""}
                        </p>
                      </div>
                    )}
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
    </div>
  );
}
