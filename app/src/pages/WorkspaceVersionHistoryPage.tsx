import { GitBranch } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Spinner } from "../components/atoms/Spinner";
import { VersionHistoryPanel } from "../components/organisms/VersionHistoryPanel";
import { WorkspacePageHeader } from "../components/organisms/WorkspacePageHeader";
import { useWorkspace } from "../contexts/WorkspaceContext";
import { routeRepositoryDraft } from "../types";

/** Workspace settings > Version history: the workspace's git history. */
export function WorkspaceVersionHistoryPage() {
  const { currentWorkspace, isLoading } = useWorkspace();
  // Create workspace hands on the repository its sync was going to make, when it stopped.
  const handedOn = routeRepositoryDraft(useLocation().state);

  return (
    <div className="flex flex-col h-full">
      <WorkspacePageHeader
        icon={
          <GitBranch
            className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark"
            aria-hidden="true"
          />
        }
        title="Version history (git)"
        fallbackSubtitle="This workspace's history in git"
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl">
          {isLoading || currentWorkspace === null ? (
            <Spinner size="lg" />
          ) : (
            <VersionHistoryPanel workspaceId={currentWorkspace.workspaceId} workspaceSlug={currentWorkspace.slug} handedOn={handedOn} />
          )}
        </div>
      </div>
    </div>
  );
}
