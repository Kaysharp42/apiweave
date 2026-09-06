import type { ComponentType } from "react";
import {
  Bot,
  MousePointer2,
  Plug,
  RefreshCw,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { Navigate, useParams } from "react-router-dom";
import { AgentsSettingsPanel } from "../components/organisms/AgentsSettingsPanel";
import { CanvasSettingsPanel } from "../components/organisms/CanvasSettingsPanel";
import { McpSetupPanel } from "../components/organisms/McpSetupPanel";
import { PrivateNetworksPanel } from "../components/organisms/PrivateNetworksPanel";
import { UpdateSettingsPanel } from "../components/organisms/UpdateSettingsPanel";

interface SettingsSection {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly subtitle: string;
  /** Forms read better narrow; the agent roster needs the room. */
  readonly width: string;
  readonly Panel: ComponentType;
}

/**
 * The app-scoped settings, keyed by the last URL segment. These used to be
 * modals opened from the sidebar, which put a dialog over the page the user was
 * already on — see `SettingsContent`, which now just navigates here.
 */
export const APP_SETTINGS_SECTIONS: Record<string, SettingsSection> = {
  agents: {
    icon: Bot,
    title: "Agents",
    subtitle: "Launch a coding agent in your project folder",
    width: "max-w-4xl",
    Panel: AgentsSettingsPanel,
  },
  canvas: {
    icon: MousePointer2,
    title: "Canvas",
    subtitle: "Drag, zoom and snap behaviour",
    width: "max-w-2xl",
    Panel: CanvasSettingsPanel,
  },
  "private-networks": {
    icon: Shield,
    title: "Private networks",
    subtitle: "Allow requests to LAN devices (e.g. 192.168.x.x)",
    width: "max-w-2xl",
    Panel: PrivateNetworksPanel,
  },
  "mcp-server": {
    icon: Plug,
    title: "MCP Server",
    subtitle: "Let agents drive your workflows",
    width: "max-w-2xl",
    Panel: McpSetupPanel,
  },
  updates: {
    icon: RefreshCw,
    title: "Updates",
    subtitle: "Check for and install new versions",
    width: "max-w-2xl",
    Panel: UpdateSettingsPanel,
  },
};

export function AppSettingsPage() {
  const { orgSlug, workspaceSlug, section } = useParams<{
    orgSlug: string;
    workspaceSlug: string;
    section: string;
  }>();
  const entry =
    section === undefined ? undefined : APP_SETTINGS_SECTIONS[section];

  // An unknown /settings/* segment lands on the first settings page rather than
  // a 404 inside the shell — the sidebar it arrived from is still standing.
  if (!entry) {
    return (
      <Navigate
        to={`/${orgSlug}/${workspaceSlug}/settings/environments`}
        replace
      />
    );
  }

  const { icon: Icon, title, subtitle, width, Panel } = entry;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-6 border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
        <Icon
          className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark"
          aria-hidden="true"
        />
        <div>
          <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark">
            {title}
          </h1>
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            {subtitle}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className={width}>
          <Panel />
        </div>
      </div>
    </div>
  );
}
