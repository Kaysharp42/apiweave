import type { ReactNode } from "react";

export interface WorkflowProviderProps {
  children: ReactNode;
  workflowId: string | undefined;
  initialWorkflow?: unknown;
}
