import type { RunStatus } from "./RunStatus";
import type { RunResult } from "./RunResult";

export interface Run {
  runId: string;
  workflowId: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  results: RunResult[];
  environmentId?: string;
  triggeredBy?: string;
}
