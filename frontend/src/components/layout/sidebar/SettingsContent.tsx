import { useState } from "react";
import { FolderKanban, Key, Globe, Plug } from "lucide-react";
import type { SettingsContentProps } from "../../../types";
import { useWorkspace } from "../../../contexts/WorkspaceContext";
import { McpSetupModal } from "../../organisms/McpSetupModal";

/**
 * Renders the settings section of the sidebar.
 * Shows workspace-scoped settings (Projects, Environments, Secrets).
 */
export function SettingsContent({
  onNavigate,
  onSwitchNav,
}: SettingsContentProps) {
  const { currentOrg, currentWorkspace } = useWorkspace();
  const [mcpOpen, setMcpOpen] = useState(false);

  const orgSlug = currentOrg?.slug ?? "personal";
  const workspaceSlug = currentWorkspace?.slug ?? "workflows";
  const wsBase = `/${orgSlug}/${workspaceSlug}`;

  const settingItemClass = [
    "flex w-full items-center gap-3 rounded border border-transparent px-3 py-2 text-left",
    "hover:border-border hover:bg-surface-overlay dark:hover:border-border-dark dark:hover:bg-surface-dark-overlay",
    "focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 dark:focus-visible:outline-primary-light",
    "cursor-pointer transition-colors",
  ].join(" ");

  return (
    <div className="h-full overflow-auto bg-surface-raised dark:bg-surface-dark-raised">
      {/* Workspace-scoped settings */}
      <div className="px-3 pt-3 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
          Workspace
        </span>
      </div>
      <ul className="w-full px-2 space-y-1">
        <li>
          <button
            type="button"
            className={[
              "flex w-full items-center gap-3 rounded border border-transparent px-3 py-2 text-left",
              "hover:border-border hover:bg-surface-overlay dark:hover:border-border-dark dark:hover:bg-surface-dark-overlay",
              "focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 dark:focus-visible:outline-primary-light",
              "cursor-pointer transition-colors",
            ].join(" ")}
            onClick={() => {
              onSwitchNav("projects");
              onNavigate(`${wsBase}/workflows`);
            }}
          >
            <FolderKanban className="w-4 h-4 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
            <div className="min-w-0 text-left">
              <div className="font-medium text-text-primary dark:text-text-primary-dark text-sm">
                Projects
              </div>
              <div className="text-xs text-text-secondary dark:text-text-secondary-dark">
                Organize workflows into projects
              </div>
            </div>
          </button>
        </li>
        <li>
          <button
            type="button"
            className={[
              "flex w-full items-center gap-3 rounded border border-transparent px-3 py-2 text-left",
              "hover:border-border hover:bg-surface-overlay dark:hover:border-border-dark dark:hover:bg-surface-dark-overlay",
              "focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 dark:focus-visible:outline-primary-light",
              "cursor-pointer transition-colors",
            ].join(" ")}
            onClick={() => onNavigate(`${wsBase}/settings/environments`)}
          >
            <Globe className="w-4 h-4 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
            <div className="min-w-0 text-left">
              <div className="font-medium text-text-primary dark:text-text-primary-dark text-sm">
                Environments
              </div>
              <div className="text-xs text-text-secondary dark:text-text-secondary-dark">
                Manage scoped environments
              </div>
            </div>
          </button>
        </li>
        <li>
          <button
            type="button"
            className={[
              "flex w-full items-center gap-3 rounded border border-transparent px-3 py-2 text-left",
              "hover:border-border hover:bg-surface-overlay dark:hover:border-border-dark dark:hover:bg-surface-dark-overlay",
              "focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 dark:focus-visible:outline-primary-light",
              "cursor-pointer transition-colors",
            ].join(" ")}
            onClick={() => onNavigate(`${wsBase}/settings/secrets`)}
          >
            <Key className="w-4 h-4 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
            <div className="min-w-0 text-left">
              <div className="font-medium text-text-primary dark:text-text-primary-dark text-sm">
                Secrets
              </div>
              <div className="text-xs text-text-secondary dark:text-text-secondary-dark">
                Manage encrypted secrets
              </div>
            </div>
          </button>
        </li>
      </ul>

      {/* App-scoped settings */}
      <div className="px-3 pt-4 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
          App
        </span>
      </div>
      <ul className="w-full px-2 space-y-1">
        <li>
          <button
            type="button"
            className={settingItemClass}
            onClick={() => setMcpOpen(true)}
          >
            <Plug className="w-4 h-4 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
            <div className="min-w-0 text-left">
              <div className="font-medium text-text-primary dark:text-text-primary-dark text-sm">
                MCP Server
              </div>
              <div className="text-xs text-text-secondary dark:text-text-secondary-dark">
                Let agents drive your workflows
              </div>
            </div>
          </button>
        </li>
      </ul>

      <McpSetupModal isOpen={mcpOpen} onClose={() => setMcpOpen(false)} />
    </div>
  );
}
