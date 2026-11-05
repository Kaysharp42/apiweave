import { FileText, Download } from "lucide-react";
import { SidebarAction } from "./SidebarAction";
import { SidebarRowActions } from "./SidebarRowActions";
import { WorkflowItemBadges } from "./WorkflowItemBadges";
import { ContextMenu } from "../../molecules/ContextMenu";
import { useContextMenu } from "../../../hooks/useContextMenu";
import { workflowRowMenuItems } from "./rowContextMenus";
import { workflowRowLabels } from "../../../utils/workflowRowLabels";
import type { WorkflowItemProps } from "../../../types";

/**
 * Renders a single workflow item in the sidebar list.
 * Shows workflow name, node count, collection badge, environment badge, an
 * export button visible on hover/focus, and a right-click menu carrying the
 * actions that need a name or a target picked (rename, move) plus the
 * destructive delete, which is deliberately not one click away.
 */
export function WorkflowItem({
  workflow,
  isActive,
  hideProject = false,
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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleActivate();
      return;
    }
    // Shift+F10 and the dedicated ContextMenu key are the keyboard equivalent
    // of a right-click. Anchor the menu to the focused row button: there is no
    // pointer position to use.
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      contextMenu.openAt({ x: rect.left, y: rect.bottom });
    }
  };

  return (
    <li>
      <div
        onContextMenu={contextMenu.openAt}
        className={[
          "group relative flex w-full items-start gap-2 rounded-sm border px-2 py-1.5 text-xs transition-colors duration-150 motion-reduce:transition-none",
          isActive
            ? "border-border bg-primary/10 dark:border-border-dark dark:bg-primary-light/10"
            : contextMenu.isOpen
              ? "border-border bg-surface-overlay dark:border-border-dark dark:bg-surface-dark-overlay"
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
            "focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-2",
            "cursor-pointer rounded-sm",
          ].join(" ")}
        >
          <FileText
            className={[
              "mt-0.5 h-3.5 w-3.5 shrink-0",
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
              title={labels.name}
            >
              {labels.name}
            </div>

            <WorkflowItemBadges
              nodeCount={workflow.nodes?.length ?? 0}
              labels={labels}
              hideProject={hideProject}
            />
          </div>
        </button>

        {/* Overlaid rather than inline so the workflow name gets the full row
            width; the gradient keeps long names legible underneath. */}
        <SidebarRowActions active={isActive}>
          <SidebarAction
            icon={Download}
            label="Export workflow"
            onClick={(event) => {
              event.stopPropagation();
              onExportWorkflow(workflow);
            }}
          />
        </SidebarRowActions>
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
