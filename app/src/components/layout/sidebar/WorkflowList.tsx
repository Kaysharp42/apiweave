import { FileText } from "lucide-react";
import { Skeleton } from "../../atoms/Skeleton";
import { SidebarListEmptyState } from "./SidebarListEmptyState";
import { WorkflowItem } from "./WorkflowItem";
import type { WorkflowListProps } from "../../../types";

/**
 * Renders the workflow list section of the sidebar.
 * Handles loading skeletons, empty state and the filtered list.
 */
export function WorkflowList({
  workflows,
  collections,
  environments,
  selectedWorkflowId,
  isRefreshing,
  searchQuery,
  onWorkflowClick,
  onExportWorkflow,
  onDeleteWorkflow,
  onRenameWorkflow,
  onMoveWorkflowToProject,
  onMoveWorkflowToWorkspace,
  onCreateWorkflow,
}: WorkflowListProps) {
  if (workflows.length === 0 && isRefreshing) {
    return (
      <div className="p-3 space-y-3" aria-label="Loading workflows">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton variant="circle" width={24} height={24} />
            <Skeleton variant="text" className="flex-1" height={14} />
            <Skeleton variant="text" width={32} height={14} />
          </div>
        ))}
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <SidebarListEmptyState
        icon={FileText}
        items="workflows"
        emptyDescription="Create your first workflow to get started"
        createLabel="Create Workflow"
        searchQuery={searchQuery}
        onCreate={onCreateWorkflow}
      />
    );
  }

  return (
    <>
      <ul className="w-full list-none space-y-0.5 p-1.5 font-sans">
        {workflows.map((workflow) => (
          <WorkflowItem
            key={workflow.workflowId}
            workflow={workflow}
            isActive={selectedWorkflowId === workflow.workflowId}
            collections={collections}
            environments={environments}
            onWorkflowClick={onWorkflowClick}
            onExportWorkflow={onExportWorkflow}
            onDeleteWorkflow={onDeleteWorkflow}
            onRenameWorkflow={onRenameWorkflow}
            onMoveWorkflowToProject={onMoveWorkflowToProject}
            onMoveWorkflowToWorkspace={onMoveWorkflowToWorkspace}
          />
        ))}
      </ul>
    </>
  );
}
