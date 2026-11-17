import type { ReactNode } from "react";

export interface NodeOutputPanelProps {
  output: unknown | null;
  executionStatus?: string | undefined;
  /** Shown above the output when there is one: the node type's own review of its result. */
  review?: ReactNode;
}
