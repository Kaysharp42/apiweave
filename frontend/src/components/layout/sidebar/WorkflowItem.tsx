import { FileText, Download, Trash2, Globe } from 'lucide-react';
import { Badge } from '../../atoms/Badge';
import { SidebarAction } from './SidebarAction';
import { getSidebarItemLabel } from '../../../utils/sidebarItemLabel';
import type { WorkflowItemProps } from '../../../types';

/**
 * Renders a single workflow item in the sidebar list.
 * Shows workflow name, node count, collection badge, environment badge,
 * and action buttons (export, delete) visible on hover/focus.
 */
export function WorkflowItem({
  workflow,
  isActive,
  collections,
  environments,
  onWorkflowClick,
  onExportWorkflow,
  onDeleteWorkflow,
}: WorkflowItemProps) {
  const envId = localStorage.getItem(`selectedEnvironment_${workflow.workflowId}`);
  const env = envId ? environments.find((e) => e.environmentId === envId) : null;
  const envName = env ? env.name : null;
  const workflowLabel = getSidebarItemLabel(workflow.name, 46, 'Untitled workflow');
  const collectionName = workflow.collectionId
    ? collections.find((c) => c.collectionId === workflow.collectionId)?.name
    : null;
  const collectionLabel = collectionName
    ? getSidebarItemLabel(collectionName, 18, 'Collection')
    : null;
  const environmentLabel = envName
    ? getSidebarItemLabel(envName, 16, 'Environment')
    : null;

  const handleActivate = () => onWorkflowClick(workflow);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleActivate();
    }
  };

  return (
    <li>
      <div
        className={[
          'group flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-sm transition-all duration-150 border',
          isActive
            ? 'bg-[var(--aw-primary)]/10 border-[var(--aw-primary)]/30 shadow-[var(--aw-shadow-node)]'
            : 'border-transparent hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:border-[var(--aw-border)]/70',
        ].join(' ')}
      >
        <button
          type="button"
          aria-current={isActive ? 'page' : undefined}
          onClick={handleActivate}
          onKeyDown={handleKeyDown}
          className={[
            'flex min-w-0 flex-1 items-start gap-2 text-left',
            'focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]',
            'cursor-pointer rounded',
          ].join(' ')}
        >
          <FileText className="mt-0.5 h-4 w-4 text-text-muted dark:text-text-muted-dark flex-shrink-0" />

          <div className="min-w-0 flex-1 text-left overflow-hidden">
            <div
              className="font-medium text-text-primary dark:text-text-primary-dark truncate"
              title={workflowLabel.fullLabel}
            >
              {workflowLabel.label}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-text-secondary dark:text-text-secondary-dark overflow-hidden">
              <Badge variant="ghost" size="xs">{workflow.nodes?.length ?? 0} nodes</Badge>

              {collectionLabel && (
                <Badge
                  variant="info"
                  size="xs"
                  className="max-w-[9.5rem] min-w-0 truncate"
                  title={collectionLabel.fullLabel}
                >
                  {collectionLabel.label}
                </Badge>
              )}

              {environmentLabel && (
                <Badge
                  variant="secondary"
                  size="xs"
                  className="max-w-[9rem] min-w-0 truncate"
                  title={environmentLabel.fullLabel}
                >
                  <Globe className="w-2.5 h-2.5 mr-0.5 flex-shrink-0" />
                  {environmentLabel.label}
                </Badge>
              )}
            </div>
          </div>
        </button>

        <div className="ml-1 flex w-[64px] shrink-0 items-center justify-end gap-1">
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
    </li>
  );
}