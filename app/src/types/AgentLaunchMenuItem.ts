import type { LucideIcon } from "lucide-react";

/** One row in the agent launch menu — an agent, or a folder action. */
export interface AgentLaunchMenuItem {
  readonly key: string;
  readonly icon: LucideIcon;
  readonly label: string;
  /** Rendered with a divider above it — the first action after the agents. */
  readonly separated?: boolean;
  readonly onSelect: () => void;
}
