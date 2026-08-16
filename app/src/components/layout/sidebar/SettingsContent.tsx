import { useState, type ReactNode } from "react";
import {
  Bot,
  FolderKanban,
  Key,
  Globe,
  Plug,
  RefreshCw,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { useParams } from "react-router-dom";
import type { UpdateStatus } from "@shared/types/UpdateStatus";
import type { SettingsContentProps } from "../../../types";
import { useWorkspace } from "../../../contexts/WorkspaceContext";
import { AgentsSettingsModal } from "../../organisms/AgentsSettingsModal";
import { McpSetupModal } from "../../organisms/McpSetupModal";
import { UpdateSettingsModal } from "../../organisms/UpdateSettingsModal";
import { PrivateNetworksModal } from "../../organisms/PrivateNetworksModal";
import { useUpdateStatus } from "../../../contexts/UpdateStatusContext";

const settingItemClass = [
  "flex w-full items-center gap-3 rounded border border-transparent px-3 py-2 text-left",
  "hover:border-border hover:bg-surface-overlay dark:hover:border-border-dark dark:hover:bg-surface-dark-overlay",
  "focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 dark:focus-visible:outline-primary-light",
  "cursor-pointer transition-colors",
].join(" ");

/** What the Updates row says it can do for you right now. */
function updateDescription(
  pending: boolean,
  status: UpdateStatus | null,
): string {
  if (!pending) return "Check for and install new versions";
  if (status?.state === "downloaded") {
    return `v${status.latestVersion} is ready — restart to install`;
  }
  return `v${status?.latestVersion} is available`;
}

interface SettingItemProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: ReactNode;
  readonly onClick: () => void;
  /** A marker at the far end — the update panel's "something is waiting" dot. */
  readonly marker?: boolean;
}

/** One row of the settings list: icon, title, and a line saying what it is for. */
function SettingItem({
  icon: Icon,
  title,
  description,
  onClick,
  marker = false,
}: SettingItemProps) {
  return (
    <li>
      <button type="button" className={settingItemClass} onClick={onClick}>
        <Icon className="w-4 h-4 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
        <div className="min-w-0 text-left">
          <div className="font-medium text-text-primary dark:text-text-primary-dark text-sm">
            {title}
          </div>
          <div className="text-xs text-text-secondary dark:text-text-secondary-dark">
            {description}
          </div>
        </div>
        {marker && (
          <span className="ml-auto h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary dark:bg-primary-light" />
        )}
      </button>
    </li>
  );
}

/**
 * Renders the settings section of the sidebar.
 * Shows workspace-scoped settings (Projects, Environments, Secrets).
 */
export function SettingsContent({
  onNavigate,
  onSwitchNav,
}: SettingsContentProps) {
  const { currentOrg, currentWorkspace } = useWorkspace();
  const params = useParams<{ orgSlug?: string; workspaceSlug?: string }>();
  const [mcpOpen, setMcpOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [privateNetworksOpen, setPrivateNetworksOpen] = useState(false);
  const { pending: updatePending, status: updateStatus } = useUpdateStatus();

  const orgSlug = currentOrg?.slug ?? params.orgSlug ?? "personal";
  const workspaceSlug = currentWorkspace?.slug ?? params.workspaceSlug ?? "personal";
  const wsBase = `/${orgSlug}/${workspaceSlug}`;

  return (
    <div className="h-full overflow-auto bg-surface-raised dark:bg-surface-dark-raised">
      {/* Workspace-scoped settings */}
      <div className="px-3 pt-3 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
          Workspace
        </span>
      </div>
      <ul className="w-full px-2 space-y-1">
        <SettingItem
          icon={FolderKanban}
          title="Projects"
          description="Organize workflows into projects"
          onClick={() => {
            onSwitchNav("projects");
            onNavigate(`${wsBase}/workflows`);
          }}
        />
        <SettingItem
          icon={Globe}
          title="Environments"
          description="Manage scoped environments"
          onClick={() => onNavigate(`${wsBase}/settings/environments`)}
        />
        <SettingItem
          icon={Key}
          title="Secrets"
          description="Manage encrypted secrets"
          onClick={() => onNavigate(`${wsBase}/settings/secrets`)}
        />
      </ul>

      {/* App-scoped settings */}
      <div className="px-3 pt-4 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
          App
        </span>
      </div>
      <ul className="w-full px-2 space-y-1">
        <SettingItem
          icon={Bot}
          title="Agents"
          description="Launch a coding agent in your project folder"
          onClick={() => setAgentsOpen(true)}
        />
        <SettingItem
          icon={Shield}
          title="Private networks"
          description="Allow requests to LAN devices (e.g. 192.168.x.x)"
          onClick={() => setPrivateNetworksOpen(true)}
        />
        <SettingItem
          icon={Plug}
          title="MCP Server"
          description="Let agents drive your workflows"
          onClick={() => setMcpOpen(true)}
        />
        <SettingItem
          icon={RefreshCw}
          title="Updates"
          description={updateDescription(updatePending, updateStatus)}
          onClick={() => setUpdatesOpen(true)}
          marker={updatePending}
        />
      </ul>

      <McpSetupModal isOpen={mcpOpen} onClose={() => setMcpOpen(false)} />
      <AgentsSettingsModal
        isOpen={agentsOpen}
        onClose={() => setAgentsOpen(false)}
      />
      <UpdateSettingsModal
        isOpen={updatesOpen}
        onClose={() => setUpdatesOpen(false)}
      />
      <PrivateNetworksModal
        isOpen={privateNetworksOpen}
        onClose={() => setPrivateNetworksOpen(false)}
      />
    </div>
  );
}
