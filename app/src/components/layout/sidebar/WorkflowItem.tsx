import { FileText, Download, Trash2 } from "lucide-react";
import { SidebarAction } from "./SidebarAction";
import { WorkflowItemBadges } from "./WorkflowItemBadges";
import { ContextMenu } from "../../molecules/ContextMenu";
import { useContextMenu } from "../../../hooks/useContextMenu";
import { workflowRowMenuItems } from "./rowContextMenus";
import { workflowRowLabels } from "../../../utils/workflowRowLabels";
import type { WorkflowItemProps } from "../../../types";

/**
 * Renders a single workflow item in the sidebar list.
 * Shows workflow name, node count, collection badge, environment badge,
 * action buttons (export, delete) visible on hover/focus, and a right-click
 * menu carrying the actions that need a name or a target picked (rename, move).
 */
export function WorkflowItem({
  workflow,
  isActive,
  collections,
  environments,
  onWorkflowClick,
  onExportWorkflow,
  onDeleteWorkflow,
  onRenameWorkflow,
  onMoveWorkflowToProject,
  onMoveWorkflowToWorkspace,
}: WorkflowItemProps) {
  const contextMenu = useContextMenu();
  const labels = workflowRowLabels(workflow, collections, environments);

  const handleActivate = () => onWorkflowClick(workflow);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleActivate();
    }
  };

  return (
    <li>
      <div
        onContextMenu={contextMenu.openAt}
        className={[
          "group relative flex w-full items-start gap-2 rounded border border-l-2 px-2 py-1.5 text-xs transition-colors duration-150 motion-reduce:transition-none",
          isActive
            ? "border-y-border border-r-border border-l-primary bg-primary/10 dark:border-y-border-dark dark:border-r-border-dark dark:border-l-primary-light dark:bg-primary-light/10"
            : "border-transparent hover:border-border hover:bg-surface-overlay dark:hover:border-border-dark dark:hover:bg-surface-dark-overlay",
        ].join(" ")}
      >
        <button
          type="button"
          aria-current={isActive ? "page" : undefined}
          onClick={handleActivate}
          onKeyDown={handleKeyDown}
          className={[
            "flex min-w-0 flex-1 items-start gap-2 text-left",
            "focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 dark:focus-visible:outline-primary-light",
            "cursor-pointer rounded",
          ].join(" ")}
        >
          <FileText
            className={[
              "mt-0.5 h-3.5 w-3.5 flex-shrink-0",
              isActive
                ? "text-primary dark:text-primary-light"
                : "text-text-muted dark:text-text-muted-dark",
            ].join(" ")}
          />

          <div className="min-w-0 flex-1 text-left overflow-hidden">
            <div
              className={[
                "truncate font-medium",
                isActive
                  ? "text-primary dark:text-primary-light"
                  : "text-text-primary dark:text-text-primary-dark",
              ].join(" ")}
              title={labels.name.fullLabel}
            >
              {labels.name.label}
            </div>

            <WorkflowItemBadges
              nodeCount={workflow.nodes?.length ?? 0}
              labels={labels}
            />
          </div>
        </button>

        {/* Overlaid rather than inline so the workflow name gets the full row
            width; the gradient keeps long names legible underneath. */}
        <div
          className={[
            "absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded pl-6",
            "bg-gradient-to-l from-surface-overlay from-70% to-transparent dark:from-surface-dark-overlay",
            "opacity-0 transition-opacity duration-150 motion-reduce:transition-none",
            "group-hover:opacity-100 group-focus-within:opacity-100",
          ].join(" ")}
        >
          <SidebarAction
            icon={Download}
            label="Export workflow"
            onClick={(event) => {
              event.stopPropagation();
              onExportWorkflow(workflow);
            }}
          />

          <SidebarAction
            icon={Trash2}
            label="Delete workflow permanently"
            destructive
            onClick={(event) => {
              event.stopPropagation();
              onDeleteWorkflow(workflow.workflowId, workflow.name);
            }}
          />
        </div>
      </div>

      {contextMenu.origin && (
        <ContextMenu
          x={contextMenu.origin.x}
          y={contextMenu.origin.y}
          label={`Workflow "${workflow.name}"`}
          onClose={contextMenu.close}
          items={workflowRowMenuItems(workflow, {
            onRenameWorkflow,
            onMoveWorkflowToProject,
            onMoveWorkflowToWorkspace,
            onExportWorkflow,
            onDeleteWorkflow,
          })}
        />
      )}
    </li>
  );
}
