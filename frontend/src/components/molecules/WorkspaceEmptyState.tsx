import { LayoutGrid, Plus, Upload, FolderOpen } from 'lucide-react';
import { Button } from '../atoms/Button';

export interface WorkspaceEmptyStateProps {
  onNewWorkflow?: () => void;
  onImport?: () => void;
  onOpenCollection?: () => void;
}

export function WorkspaceEmptyState({ onNewWorkflow, onImport, onOpenCollection }: WorkspaceEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 select-none px-6">
      <div className="flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/10 dark:bg-primary-dark/20">
        <LayoutGrid className="w-10 h-10 text-primary dark:text-primary-dark" strokeWidth={1.4} />
      </div>

      <div className="text-center space-y-2">
        <h2 className="text-2xl font-display font-semibold text-text-primary dark:text-text-primary-dark">
          Welcome to APIWeave
        </h2>
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark max-w-md">
          Build, chain, and test your APIs visually. Open a workflow from the sidebar or create a new one to get started.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
        {onNewWorkflow && (
          <Button variant="primary" size="sm" onClick={onNewWorkflow}>
            <Plus className="w-4 h-4" />
            New Workflow
          </Button>
        )}
        {onImport && (
          <Button variant="ghost" size="sm" onClick={onImport}>
            <Upload className="w-4 h-4" />
            Import Workflow
          </Button>
        )}
        {onOpenCollection && (
          <Button variant="ghost" size="sm" onClick={onOpenCollection}>
            <FolderOpen className="w-4 h-4" />
            Open Collection
          </Button>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-text-muted dark:text-text-muted-dark">
        <span>
          <kbd className="kbd kbd-xs">Ctrl</kbd> + <kbd className="kbd kbd-xs">N</kbd> New workflow
        </span>
        <span>
          <kbd className="kbd kbd-xs">Ctrl</kbd> + <kbd className="kbd kbd-xs">Tab</kbd> Cycle tabs
        </span>
        <span>
          <kbd className="kbd kbd-xs">Ctrl</kbd> + <kbd className="kbd kbd-xs">W</kbd> Close tab
        </span>
        <span>
          <kbd className="kbd kbd-xs">?</kbd> All shortcuts
        </span>
      </div>
    </div>
  );
}
