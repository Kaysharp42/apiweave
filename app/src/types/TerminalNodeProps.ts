import type { ReactNode } from "react";
import type { NodeHandleConfig } from "./NodeHandleConfig";

export interface TerminalNodeProps {
  nodeId: string;
  selected: boolean;
  title: string;
  icon: ReactNode;
  /** Token reference for the icon tile — `var(--aw-status-success)` and such. */
  tileHue: string;
  /** The collapsed identity line: `entry point`, `final step`. */
  restLine: string;
  /** Prose shown once the node is expanded. */
  description: string;
  handleLeft?: NodeHandleConfig | false;
  handleRight?: NodeHandleConfig | false;
}
