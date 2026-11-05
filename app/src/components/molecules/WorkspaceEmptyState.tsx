import {
  GitBranch,
  Plus,
  Upload,
  FolderOpen,
  ArrowRight,
  BookOpen,
  FileText,
} from "lucide-react";
import { Fragment } from "react";
import { Button } from "../atoms/Button";
import { shortcutKeys } from "../../constants/keyboardShortcuts";
import type { ShortcutAction, WorkspaceEmptyStateProps } from "../../types";

const EMPTY_STATE_SHORTCUTS: ReadonlyArray<[ShortcutAction, string]> = [
  ["newWorkflow", "New"],
  ["nextTab", "Cycle"],
  ["closeTab", "Close"],
  ["showShortcutsHelp", "Shortcuts"],
];

export function WorkspaceEmptyState({
  onNewWorkflow,
  onImport,
  onOpenCollection,
  onOpenFromGit,
  onOpenTutorials,
  tutorialsLabel = "Start tutorial",
  recentWorkflows = [],
  onOpenWorkflow,
}: WorkspaceEmptyStateProps) {
  return (
    <div className="flex h-full select-none flex-col items-center justify-center gap-6 px-6 py-12 motion-reduce:animate-none">
      <img
        src="/apiweave.png"
        alt=""
        aria-hidden="true"
        className="h-16 w-16 rounded-sm object-cover"
      />

      {/* Text */}
      <div className="text-center space-y-2 max-w-sm">
        <h2 className="font-sans text-2xl font-semibold text-text-primary dark:text-text-primary-dark">
          Welcome to APIWeave
        </h2>
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark leading-relaxed">
          Build visual API test flows, chain requests with variables, and run
          them against the environment you choose.
        </p>
      </div>

      {recentWorkflows.length > 0 && onOpenWorkflow && (
        <section className="w-full max-w-xs">
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-secondary-dark">
            Recent
          </h3>
          <ul
            aria-label="Recent workflows"
            className="space-y-0.5 rounded-sm border border-border bg-surface-raised p-1 dark:border-border-dark dark:bg-surface-dark-raised"
          >
            {recentWorkflows.map((workflow) => (
              <li key={workflow.workflowId}>
                <button
                  type="button"
                  onClick={() => onOpenWorkflow(workflow)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-text-primary transition-colors hover:bg-surface-overlay focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-(--aw-focus-ring-offset) motion-reduce:transition-none dark:text-text-primary-dark dark:hover:bg-surface-dark-overlay"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted dark:text-text-muted-dark" />
                  <span className="truncate">{workflow.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Actions: one primary, everything else the same outline size */}
      <div className="flex w-full max-w-xs flex-col items-stretch gap-2">
        {onNewWorkflow && (
          <Button
            variant="primary"
            size="sm"
            fullWidth
            onClick={onNewWorkflow}
            className="group"
          >
            <Plus className="w-4 h-4" />
            New Workflow
            <ArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200 motion-reduce:transition-none" />
          </Button>
        )}

        {onOpenTutorials && (
          <Button
            variant="outline"
            size="sm"
            fullWidth
            onClick={onOpenTutorials}
            icon={<BookOpen className="w-4 h-4" />}
          >
            {tutorialsLabel}
          </Button>
        )}

        {onImport && (
          <Button
            variant="outline"
            size="sm"
            fullWidth
            onClick={onImport}
            icon={<Upload className="w-4 h-4" />}
          >
            Import Workflow
          </Button>
        )}

        {onOpenCollection && (
          <Button
            variant="outline"
            size="sm"
            fullWidth
            onClick={onOpenCollection}
            icon={<FolderOpen className="w-4 h-4" />}
          >
            Open Project
          </Button>
        )}

        {onOpenFromGit && (
          <Button
            variant="outline"
            size="sm"
            fullWidth
            onClick={onOpenFromGit}
            icon={<GitBranch className="w-4 h-4" />}
          >
            Open from git…
          </Button>
        )}
      </div>

      {/* Shortcuts */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-2xs text-text-muted dark:text-text-muted-dark">
        {EMPTY_STATE_SHORTCUTS.map(([action, label]) => (
          <span
            key={action}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap"
          >
            {shortcutKeys(action).map((key, index) => (
              <Fragment key={key}>
                {index > 0 && <span>+</span>}
                <kbd className="inline-flex items-center justify-center rounded-xs border border-border bg-surface-overlay px-1.5 py-0.5 font-mono text-2xs text-text-secondary dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-secondary-dark">
                  {key}
                </kbd>
              </Fragment>
            ))}
            <span className="ml-0.5">{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
