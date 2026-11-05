// fallow-ignore-file code-duplication -- the export SidebarAction here still mirrors WorkflowItem's; it predates this file's changes and is only re-flagged because AgentLaunchButton's insertion shifted its line numbers
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
} from "@headlessui/react";
import {
  ChevronDown,
  ChevronRight,
  FolderKanban,
  Download,
  Plus,
  FilePlus,
} from "lucide-react";
import { Badge } from "../../atoms/Badge";
import { IconButton } from "../../atoms/IconButton";
import { AgentLaunchButton } from "../../organisms/AgentLaunchButton";
import { SidebarAction } from "./SidebarAction";
import { SidebarRowActions } from "./SidebarRowActions";
import { WorkflowItem } from "./WorkflowItem";
import { ContextMenu } from "../../molecules/ContextMenu";
import { useContextMenu } from "../../../hooks/useContextMenu";
import { projectRowMenuItems } from "./rowContextMenus";
import { getSidebarItemLabel } from "../../../utils/sidebarItemLabel";
import type { ProjectItemProps } from "../../../types";
import type { Project } from "../../../types/Project";

export function ProjectItem({
  project,
  isExpanded,
  workflows,
  projects,
  environments,
  selectedWorkflowId,
  onToggle,
  onWorkflowClick,
  onExportProject,
  onDeleteProject,
  onRenameProject,
  onMoveProjectToWorkspace,
  onExportWorkflow,
  onDeleteWorkflow,
  onRenameWorkflow,
  onMoveWorkflowToProject,
  onMoveWorkflowToWorkspace,
  onAddWorkflowToProject,
  onAssignWorkflowToProject,
}: ProjectItemProps) {
  const contextMenu = useContextMenu();
  const projectId = project.projectId ?? project.collectionId;
  const projectWorkflows = Array.isArray(workflows)
    ? workflows.filter((wf) => wf.collectionId === projectId)
    : [];
  const unassignedWorkflows = Array.isArray(workflows)
    ? workflows.filter(
        (wf) => !wf.collectionId || wf.collectionId !== projectId,
      )
    : [];
  const projectLabel = getSidebarItemLabel(project.name, "Untitled project");

  const handleRowKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    // Shift+F10 and the dedicated ContextMenu key are the keyboard equivalent
    // of a right-click. Anchor the menu to the focused row button: there is no
    // pointer position to use.
    if (
      event.key !== "ContextMenu" &&
      !(event.shiftKey && event.key === "F10")
    ) {
      return;
    }
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    contextMenu.openAt({ x: rect.left, y: rect.bottom });
  };

  return (
    <li>
      <div
        onContextMenu={contextMenu.openAt}
        className={[
          "group relative flex items-center gap-2 rounded-sm border px-2.5 py-2 transition-colors duration-150 motion-reduce:transition-none",
          contextMenu.isOpen
            ? "border-border bg-surface-overlay dark:border-border-dark dark:bg-surface-dark-overlay"
            : "border-transparent hover:border-border hover:bg-surface-overlay dark:hover:border-border-dark dark:hover:bg-surface-dark-overlay",
        ].join(" ")}
      >
        <button
          type="button"
          className={[
            "flex min-w-0 flex-1 items-center gap-2 text-left",
            "focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-2",
            "cursor-pointer rounded-sm",
          ].join(" ")}
          onClick={() => onToggle(projectId)}
          onKeyDown={handleRowKeyDown}
          aria-expanded={isExpanded}
        >
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-text-muted dark:text-text-muted-dark shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-text-muted dark:text-text-muted-dark shrink-0" />
          )}
          <FolderKanban className="w-4 h-4 shrink-0 text-primary dark:text-primary-light" />
          <span
            className="font-medium text-text-primary dark:text-text-primary-dark truncate"
            title={projectLabel}
          >
            {projectLabel}
          </span>
          <Badge variant="ghost" size="xs" className="shrink-0">
            {projectWorkflows.length}
          </Badge>
        </button>

        {/* Overlaid rather than inline so the project name gets the full row
            width; the gradient keeps long names legible underneath. */}
        <SidebarRowActions>
          {/*
            Where the Agents section says agents are launched from. It renders
            nothing outside the desktop app, and `collectionId` rather than the
            `projectId` alias because the local-path table keys on the DB
            primary key — the same id `CollectionManager` passes.

            Compact: the row has room for one icon and the name needs the rest,
            so this is the launch on its own. Choosing another agent or
            repointing the folder stays in the Projects dialog and the canvas
            toolbar.

            ponytail: one path resolution per row on mount (the roster fetch
            beside it is already cached in the service for 30s). Lift it to a
            single batched read if a workspace with many projects makes the
            Projects tab feel slow to open.
          */}
          <AgentLaunchButton
            scopeKind="project"
            scopeId={project.collectionId}
            showLabel={false}
            compact
          />

          <SidebarAction
            icon={Download}
            label="Export project"
            onClick={(event) => {
              event.stopPropagation();
              onExportProject(project);
            }}
          />
        </SidebarRowActions>
      </div>

      {contextMenu.origin && (
        <ContextMenu
          x={contextMenu.origin.x}
          y={contextMenu.origin.y}
          label={`Project "${project.name}"`}
          onClose={contextMenu.close}
          items={projectRowMenuItems(project, projectId, {
            onRenameProject,
            onMoveProjectToWorkspace,
            onAddWorkflowToProject,
            onExportProject,
            onDeleteProject,
          })}
        />
      )}

      {isExpanded && (
        <ul className="relative ml-3 mt-0.5 space-y-1 overflow-x-hidden pl-3 before:absolute before:bottom-0 before:left-0 before:top-0 before:w-px before:bg-border dark:before:bg-border-dark">
          {projectWorkflows.map((workflow) => (
            <WorkflowItem
              key={workflow.workflowId}
              workflow={workflow}
              isActive={selectedWorkflowId === workflow.workflowId}
              hideProject
              collections={
                projects.map((p) => ({
                  collectionId: p.projectId ?? p.collectionId,
                  name: p.name,
                })) as Project[]
              }
              environments={environments}
              onWorkflowClick={onWorkflowClick}
              onExportWorkflow={onExportWorkflow}
              onDeleteWorkflow={onDeleteWorkflow}
              onRenameWorkflow={onRenameWorkflow}
              onMoveWorkflowToProject={onMoveWorkflowToProject}
              onMoveWorkflowToWorkspace={onMoveWorkflowToWorkspace}
            />
          ))}

          {/* One row whether or not the project has workflows: an empty-project
              message above a separate Add row said the same thing twice. */}
          <li className="flex min-w-0 items-center gap-1 py-1">
            {projectWorkflows.length === 0 && (
              <>
                <span className="min-w-0 truncate text-xs text-text-secondary dark:text-text-secondary-dark">
                  No workflows yet
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-xs text-text-secondary dark:text-text-secondary-dark"
                >
                  ·
                </span>
              </>
            )}

            {projectWorkflows.length > 0 && (
              <IconButton
                variant="ghost"
                size="xs"
                tooltip="Create a new workflow in this project"
                onClick={() => onAddWorkflowToProject(projectId)}
              >
                <Plus className="w-3.5 h-3.5" />
              </IconButton>
            )}

            <button
              type="button"
              className="shrink-0 cursor-pointer whitespace-nowrap rounded-sm text-xs text-text-secondary transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-2 dark:text-text-secondary-dark dark:hover:text-primary-light"
              onClick={() => onAddWorkflowToProject(projectId)}
            >
              Add workflow
            </button>

            {unassignedWorkflows.length > 0 && (
              <Menu as="div" className="relative ml-auto">
                <MenuButton className="flex shrink-0 cursor-pointer items-center gap-0.5 whitespace-nowrap rounded-sm text-xs text-text-secondary transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-2 dark:text-text-secondary-dark dark:hover:text-primary-light">
                  <FilePlus className="w-3 h-3" />
                  Assign
                  <ChevronDown className="w-2.5 h-2.5" />
                </MenuButton>

                <MenuItems
                  anchor={{ to: "bottom end", gap: 4, padding: 8 }}
                  className="z-50 w-56 overflow-y-auto rounded-sm border border-border bg-surface-raised py-1 shadow-overlay [--anchor-max-height:10rem] focus:outline-hidden dark:border-border-dark dark:bg-surface-dark-raised"
                >
                  {unassignedWorkflows.map((wf) => (
                    <MenuItem key={wf.workflowId}>
                      <button
                        type="button"
                        className="flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-xs text-text-primary transition-colors data-focus:bg-surface-overlay dark:text-text-primary-dark dark:data-focus:bg-surface-dark-overlay"
                        onClick={() =>
                          onAssignWorkflowToProject(projectId, wf.workflowId)
                        }
                      >
                        <FilePlus className="w-3 h-3 shrink-0 text-text-muted dark:text-text-muted-dark" />
                        <span className="truncate">{wf.name}</span>
                      </button>
                    </MenuItem>
                  ))}
                </MenuItems>
              </Menu>
            )}
          </li>
        </ul>
      )}
    </li>
  );
}
