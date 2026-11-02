import type { WorkflowSummary } from "@shared/types/WorkflowSummary";
import type { WorkflowNodeMatch } from "@shared/types/WorkflowNodeMatch";
import type { CanvasCommand } from "./CanvasCommand";

/** One row of the command palette: a command, or a workflow or node found by search. */
export type CommandPaletteItem =
  | { kind: "command"; command: CanvasCommand }
  | { kind: "workflow"; workflow: WorkflowSummary }
  // A workspace-wide match always names its workflow.
  | { kind: "node"; node: WorkflowNodeMatch & { workflowId: string } };
