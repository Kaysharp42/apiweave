import { LayoutGrid, Plus, Upload, FolderOpen, ArrowRight } from 'lucide-react';
import { Button } from '../atoms/Button';
import type { WorkspaceEmptyStateProps } from '../../types';

export function WorkspaceEmptyState({ onNewWorkflow, onImport, onOpenCollection }: WorkspaceEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 select-none px-6 motion-reduce:animate-none">
      {/* Icon */}
      <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--aw-primary)]/10 dark:bg-[var(--aw-primary)]/20 shadow-[var(--aw-shadow-raised)]">
        <LayoutGrid className="w-8 h-8 text-[var(--aw-primary)] dark:text-[var(--aw-primary-light)]" strokeWidth={1.5} />
      </div>

      {/* Text */}
      <div className="text-center space-y-2 max-w-sm">
        <h2 className="text-xl font-display font-semibold text-text-primary dark:text-text-primary-dark">
          Welcome to APIWeave
        </h2>
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark leading-relaxed">
          Build visual API test flows, chain requests with variables, and run them on demand or via CI/CD webhooks.
        </p>
      </div>

      {/* Primary action */}
      <div className="flex flex-col items-center gap-3 w-full max-w-xs">
        {onNewWorkflow && (
          <Button variant="primary" size="sm" fullWidth onClick={onNewWorkflow} className="group">
            <Plus className="w-4 h-4" />
            New Workflow
            <ArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200 motion-reduce:transition-none" />
          </Button>
        )}

        <div className="flex items-center justify-center gap-2 w-full">
          {onImport && (
            <Button variant="ghost" size="xs" onClick={onImport} className="flex-1">
              <Upload className="w-3.5 h-3.5" />
              Import Workflow
            </Button>
          )}
          {onOpenCollection && (
            <Button variant="ghost" size="xs" onClick={onOpenCollection} className="flex-1">
              <FolderOpen className="w-3.5 h-3.5" />
              Open Collection
            </Button>
          )}
        </div>
      </div>

      {/* Shortcuts */}
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] text-text-muted dark:text-text-muted-dark">
        <span className="inline-flex items-center gap-1">
          <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-surface-overlay dark:bg-surface-dark-overlay border border-border dark:border-border-dark font-mono text-[10px] text-text-secondary dark:text-text-secondary-dark">
            Ctrl
          </kbd>
          <span>+</span>
          <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-surface-overlay dark:bg-surface-dark-overlay border border-border dark:border-border-dark font-mono text-[10px] text-text-secondary dark:text-text-secondary-dark">
            N
          </kbd>
          <span className="ml-0.5">New</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-surface-overlay dark:bg-surface-dark-overlay border border-border dark:border-border-dark font-mono text-[10px] text-text-secondary dark:text-text-secondary-dark">
            Ctrl
          </kbd>
          <span>+</span>
          <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-surface-overlay dark:bg-surface-dark-overlay border border-border dark:border-border-dark font-mono text-[10px] text-text-secondary dark:text-text-secondary-dark">
            Tab
          </kbd>
          <span className="ml-0.5">Cycle</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-surface-overlay dark:bg-surface-dark-overlay border border-border dark:border-border-dark font-mono text-[10px] text-text-secondary dark:text-text-secondary-dark">
            Ctrl
          </kbd>
          <span>+</span>
          <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-surface-overlay dark:bg-surface-dark-overlay border border-border dark:border-border-dark font-mono text-[10px] text-text-secondary dark:text-text-secondary-dark">
            W
          </kbd>
          <span className="ml-0.5">Close</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-surface-overlay dark:bg-surface-dark-overlay border border-border dark:border-border-dark font-mono text-[10px] text-text-secondary dark:text-text-secondary-dark">
            ?
          </kbd>
          <span className="ml-0.5">Shortcuts</span>
        </span>
      </div>
    </div>
  );
}
