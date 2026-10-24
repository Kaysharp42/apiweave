import { GitBranch } from "lucide-react";
import { useParams } from "react-router-dom";
import { Spinner } from "../components/atoms/Spinner";
import { VersionHistoryPanel } from "../components/organisms/VersionHistoryPanel";
import { WorkspacePageHeader } from "../components/organisms/WorkspacePageHeader";
import { useWorkspace } from "../contexts/WorkspaceContext";

/** Workspace settings > Version history: the workspace's git history. */
export function WorkspaceVersionHistoryPage() {
  const { orgSlug, workspaceSlug } = useParams<{
    orgSlug: string;
    workspaceSlug: string;
  }>();
  const { currentWorkspace, isLoading } = useWorkspace();

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
        orgSlug={orgSlug}
        workspaceSlug={workspaceSlug}
        fallbackSubtitle="This workspace's history in git"
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl">
          {isLoading || currentWorkspace === null ? (
            <Spinner size="lg" />
          ) : (
            <VersionHistoryPanel workspaceId={currentWorkspace.workspaceId} workspaceSlug={currentWorkspace.slug} />
          )}
        </div>
      </div>
    </div>
  );
}
