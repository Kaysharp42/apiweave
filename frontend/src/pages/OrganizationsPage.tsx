import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Building2, Plus } from "lucide-react";
import { Button } from "../components/atoms/Button";
import { EmptyState } from "../components/molecules/EmptyState";
import { CreateOrganizationModal } from "../components/organisms/CreateOrganizationModal";
import { useAuth } from "../auth/useAuth";
import { useWorkspace } from "../contexts/WorkspaceContext";
import type { Organization } from "../types";

export default function OrganizationsPage() {
  const { isSingleUser } = useAuth();
  const { orgs, availableWorkspaces, refresh } = useWorkspace();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  if (isSingleUser) {
    return <Navigate to="/app" replace />;
  }

  const firstWorkspaceByOrg = new Map(
    availableWorkspaces
      .filter((entry) => entry.org)
      .map((entry) => [entry.org!.orgId, entry.workspace]),
  );

  const handleCreated = async (_organization: Organization): Promise<void> => {
    await refresh();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-6 py-6 dark:border-border-dark dark:bg-surface-dark">
        <div className="flex min-w-0 items-center gap-3">
          <Building2
            className="h-5 w-5 flex-shrink-0 text-text-secondary dark:text-text-secondary-dark"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h1 className="truncate font-display text-3xl font-bold tracking-tight text-text-primary dark:text-text-primary-dark">
              Organizations
            </h1>
            <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
              Create and manage team-owned spaces for hosted APIWeave.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          icon={<Plus className="h-4 w-4" aria-hidden="true" />}
          onClick={() => setCreateOpen(true)}
        >
          New organization
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">
          {orgs.length === 0 ? (
            <EmptyState
              icon={
                <Building2
                  className="h-12 w-12 text-text-muted dark:text-text-muted-dark"
                  strokeWidth={1.5}
                />
              }
              title="No organizations yet"
              description="Create an organization when you are ready to add team-owned workspaces and invite collaborators."
              action={
                <Button
                  size="sm"
                  icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => setCreateOpen(true)}
                >
                  Create organization
                </Button>
              }
            />
          ) : (
            <div className="overflow-hidden rounded border border-border bg-surface-raised dark:border-border-dark dark:bg-surface-dark-raised">
              {orgs.map((org) => {
                const workspace = firstWorkspaceByOrg.get(org.orgId);
                return (
                  <div
                    key={org.orgId}
                    className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0 dark:border-border-dark"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-text-primary dark:text-text-primary-dark">
                        {org.name}
                      </p>
                      <p className="truncate text-xs text-text-secondary dark:text-text-secondary-dark">
                        /{org.slug}
                        {org.description ? ` · ${org.description}` : ""}
                      </p>
                    </div>
                    {workspace ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          navigate(
                            `/${org.slug}/${workspace.slug}/settings/org`,
                          )
                        }
                      >
                        Settings
                      </Button>
                    ) : (
                      <span className="text-xs text-text-muted dark:text-text-muted-dark">
                        Create a workspace next
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <CreateOrganizationModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
