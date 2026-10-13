import type { WorkflowSummary } from "@shared/types/WorkflowSummary";
import type { WorkspaceNodeMatch } from "@shared/types/WorkspaceNodeMatch";
import type { CanvasCommand } from "./CanvasCommand";

/** One row of the command palette: a command, or a workflow or node found by search. */
export type CommandPaletteItem =
  | { kind: "command"; command: CanvasCommand }
  | { kind: "workflow"; workflow: WorkflowSummary }
  | { kind: "node"; node: WorkspaceNodeMatch };
