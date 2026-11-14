import type { BrowserNodeData } from "./BrowserNodeData";

export interface BrowserOutputPanelProps {
  output: BrowserNodeData["executionResult"] | null;
  executionStatus?: string | undefined;
  /** Reads the failed step's screenshot; absent outside a workspace. */
  workspaceId?: string | null | undefined;
}
