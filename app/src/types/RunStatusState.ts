import type { RunTerminalStatus } from "@shared/types/RunProgressEvent";
import type { FooterRunState } from "./FooterRunState";

export interface RunStatusState {
  /**
   * The latest run of each workflow this session has watched, keyed by
   * workflow id. The canvas owns run narration; this is the one app-level fact
   * other chrome (the status bar) is allowed to read from it.
   */
  byWorkflow: Record<string, FooterRunState>;
  begin: (workflowId: string, runId: string) => void;
  finish: (
    workflowId: string,
    runId: string,
    phase: RunTerminalStatus,
  ) => void;
  setDuration: (
    workflowId: string,
    runId: string,
    durationMs: number | null,
  ) => void;
  forget: (workflowId: string) => void;
}
