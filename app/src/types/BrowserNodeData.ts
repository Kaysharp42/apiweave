import type { NodeStatus } from "./NodeStatus";
import type { BrowserStepResult } from "@shared/types/BrowserStepResult";

/** A `browser` node's canvas data: its step config as stored, and the last run's result. */
export interface BrowserNodeData {
  label?: string;
  executionStatus?: NodeStatus;
  executionResult?: {
    duration?: number;
    error?: string | null;
    browser?: BrowserStepResult;
  };
  config?: Record<string, unknown>;
}
