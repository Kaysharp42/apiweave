import {
  AppWindow,
  Bot,
  MousePointer2,
  Network,
  Plug,
  RefreshCw,
  UserRound,
} from "lucide-react";
import type { AppSettingsSectionMeta } from "../types/AppSettingsSectionMeta";

/**
 * The app-scoped settings, keyed by the last URL segment.
 *
 * Metadata only — the panel components live behind lazy imports in
 * `AppSettingsPage`. The sidebar renders this list on every session, and
 * importing the panels from here put the agents, MCP, network and update
 * bundles back into the canvas entry no matter how the route was split.
 */
export const APP_SETTINGS_SECTIONS: Readonly<
  Record<string, AppSettingsSectionMeta>
> = {
  agents: {
    icon: Bot,
    title: "Agents",
    subtitle: "Launch a coding agent in your project folder",
    width: "max-w-4xl",
  },
  background: {
    icon: AppWindow,
    title: "Background",
    subtitle: "Tray and start at login",
    width: "max-w-2xl",
  },
  canvas: {
    icon: MousePointer2,
    title: "Canvas",
    subtitle: "Theme, auto-save, drag, zoom and snap behaviour",
    width: "max-w-2xl",
  },
  "git-accounts": {
    icon: UserRound,
    title: "Git accounts",
    subtitle: "GitHub and GitLab accounts your workspaces sync as",
    width: "max-w-2xl",
  },
  "mcp-server": {
    icon: Plug,
    title: "MCP Server",
    subtitle: "Let agents drive your workflows",
    width: "max-w-2xl",
  },
  network: {
    icon: Network,
    title: "Network",
    subtitle: "Proxy, trusted certificates and client certificates",
    width: "max-w-3xl",
  },
  updates: {
    icon: RefreshCw,
    title: "Updates",
    subtitle: "Check for and install new versions",
    width: "max-w-2xl",
  },
};
