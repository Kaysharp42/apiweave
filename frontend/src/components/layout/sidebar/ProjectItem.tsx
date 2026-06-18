import { useState } from 'react';
import { ChevronDown, ChevronRight, FolderKanban, Download, Trash2, Plus, FilePlus } from 'lucide-react';
import { Badge } from '../../atoms/Badge';
import { IconButton } from '../../atoms/IconButton';
import { SidebarAction } from './SidebarAction';
import { WorkflowItem } from './WorkflowItem';
import { getSidebarItemLabel } from '../../../utils/sidebarItemLabel';
import type { ProjectItemProps } from '../../../types';
import type { Collection } from '../../../types/Collection';

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
  onExportWorkflow,
  onDeleteWorkflow,
  onAddWorkflowToProject,
  onAssignWorkflowToProject,
}: ProjectItemProps) {
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);
  const projectId = project.projectId ?? project.collectionId;
  const projectWorkflows = Array.isArray(workflows)
    ? workflows.filter((wf) => (wf.projectId ?? wf.collectionId) === projectId)
    : [];
  const unassignedWorkflows = Array.isArray(workflows)
    ? workflows.filter((wf) => !wf.collectionId || wf.collectionId !== projectId)
    : [];
  const projectLabel = getSidebarItemLabel(project.name, 40, 'Untitled project');

  return (
    <li>
      <div className="group flex items-center gap-2 rounded border border-transparent px-2.5 py-2 transition-colors duration-150 hover:border-border hover:bg-surface-overlay dark:hover:border-border-dark dark:hover:bg-surface-dark-overlay motion-reduce:transition-none">
        <button
          type="button"
          className={[
            'flex min-w-0 flex-1 items-center gap-2 text-left',
            'focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 dark:focus-visible:outline-primary-light',
            'cursor-pointer rounded',
          ].join(' ')}
          onClick={() => onToggle(projectId)}
          aria-expanded={isExpanded}
        >
          {isExpanded
            ? <ChevronDown className="w-3.5 h-3.5 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
            : <ChevronRight className="w-3.5 h-3.5 text-text-muted dark:text-text-muted-dark flex-shrink-0" />}
          <FolderKanban className="w-4 h-4 flex-shrink-0 text-primary dark:text-primary-light" />
          <span
            className="font-medium text-text-primary dark:text-text-primary-dark truncate"
            title={projectLabel.fullLabel}
          >
            {projectLabel.label}
          </span>
          <Badge variant="ghost" size="xs">{projectWorkflows.length}</Badge>
        </button>

        <div className="ml-1 flex w-[64px] shrink-0 items-center justify-end gap-1">
          <SidebarAction
            icon={Download}
            label="Export project"
            onClick={(event) => {
              event.stopPropagation();
              onExportProject(project);
            }}
          />

          <SidebarAction
            icon={Trash2}
            label="Delete project permanently"
            destructive
            onClick={(event) => {
              event.stopPropagation();
              onDeleteProject(projectId, project.name);
            }}
          />
        </div>
      </div>

      {isExpanded && (
        <ul className="relative ml-3 mt-0.5 space-y-1 pl-3 before:absolute before:bottom-0 before:left-0 before:top-0 before:w-px before:bg-border dark:before:bg-border-dark">
          {projectWorkflows.length === 0 && (
            <li className="py-2 text-center">
              <span className="text-xs text-text-muted dark:text-text-muted-dark block mb-2">
                No workflows in this project
              </span>
            </li>
          )}

          {projectWorkflows.map((workflow) => (
            <WorkflowItem
              key={workflow.workflowId}
              workflow={workflow}
              isActive={selectedWorkflowId === workflow.workflowId}
              collections={projects.map((p) => ({
                collectionId: p.projectId ?? p.collectionId,
                name: p.name,
              })) as Collection[]}
              environments={environments}
              onWorkflowClick={onWorkflowClick}
              onExportWorkflow={onExportWorkflow}
              onDeleteWorkflow={onDeleteWorkflow}
            />
          ))}

          <li className="flex items-center gap-1 py-1">
            <IconButton
              variant="ghost"
              size="xs"
              tooltip="Create a new workflow in this project"
              onClick={() => onAddWorkflowToProject(projectId)}
            >
              <Plus className="w-3.5 h-3.5" />
            </IconButton>
            <button
              type="button"
                className="cursor-pointer rounded text-xs text-text-secondary transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 dark:text-text-secondary-dark dark:hover:text-primary-light dark:focus-visible:outline-primary-light"
              onClick={() => onAddWorkflowToProject(projectId)}
            >
              Add workflow
            </button>

            {unassignedWorkflows.length > 0 && (
              <button
                type="button"
                className="ml-auto flex cursor-pointer items-center gap-0.5 rounded text-xs text-text-muted transition-colors hover:text-text-secondary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 dark:text-text-muted-dark dark:hover:text-text-secondary-dark dark:focus-visible:outline-primary-light"
                onClick={() => setShowAssignDropdown(!showAssignDropdown)}
              >
                <FilePlus className="w-3 h-3" />
                Assign
                <ChevronDown className={`w-2.5 h-2.5 transition-transform ${showAssignDropdown ? 'rotate-180' : ''}`} />
              </button>
            )}
          </li>

          {showAssignDropdown && unassignedWorkflows.length > 0 && (
            <li className="py-1">
              <div className="max-h-40 overflow-y-auto rounded border border-border bg-surface-raised dark:border-border-dark dark:bg-surface-dark-raised">
                {unassignedWorkflows.map((wf) => (
                  <button
                    key={wf.workflowId}
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface-overlay focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-[-2px] dark:hover:bg-surface-dark-overlay dark:focus-visible:outline-primary-light"
                    onClick={() => {
                      onAssignWorkflowToProject(projectId, wf.workflowId);
                      setShowAssignDropdown(false);
                    }}
                  >
                    <FilePlus className="w-3 h-3 flex-shrink-0 text-text-muted dark:text-text-muted-dark" />
                    <span className="truncate text-text-primary dark:text-text-primary-dark">{wf.name}</span>
                  </button>
                ))}
              </div>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
