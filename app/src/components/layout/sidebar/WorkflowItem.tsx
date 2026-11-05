import { FileText } from "lucide-react";
import { SidebarContextMenu } from "./SidebarContextMenu";
import { SidebarExportAction } from "./SidebarExportAction";
import { SidebarRowActions } from "./SidebarRowActions";
import { WorkflowItemBadges } from "./WorkflowItemBadges";
import { useContextMenu } from "../../../hooks/useContextMenu";
import { contextMenuKeyPoint, workflowRowMenuItems } from "./rowContextMenus";
import { rowIconColor, rowNameColor, rowSurface } from "./rowStyles";
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
    const point = contextMenuKeyPoint(event);
    if (point !== null) contextMenu.openAt(point);
  };

  return (
    <li>
      <div
        onContextMenu={contextMenu.openAt}
        className={[
          "group relative flex w-full items-start gap-2 rounded-sm border px-2 py-1.5 text-xs transition-colors duration-150 motion-reduce:transition-none",
          rowSurface(isActive, contextMenu.isOpen),
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
              rowIconColor(isActive),
            ].join(" ")}
          />

          <div className="min-w-0 flex-1 text-left overflow-hidden">
            <div
              className={["truncate font-medium", rowNameColor(isActive)].join(
                " ",
              )}
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
          <SidebarExportAction
            label="Export workflow"
            onExport={() => onExportWorkflow(workflow)}
          />
        </SidebarRowActions>
      </div>

      {contextMenu.origin && (
        <SidebarContextMenu
          menu={contextMenu}
          label={`Workflow "${workflow.name}"`}
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
