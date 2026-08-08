import type { ReactNode } from "react";
import type { NodeHandleConfig } from "./NodeHandleConfig";
import type { NodeStatus } from "./NodeStatus";

export interface TerminalNodeProps {
  nodeId: string;
  selected: boolean;
  /**
   * Where the run got to. A terminal node executes nothing, but control still
   * passes through it and the runner reports that — the entry point the moment
   * a run begins, an end node when a branch reaches it.
   */
  status?: NodeStatus;
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
