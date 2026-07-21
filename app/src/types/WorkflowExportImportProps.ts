import type { WorkflowExportImportTab } from "./WorkflowExportImportTab";

export interface WorkflowExportImportProps {
  workflowId?: string | null;
  workflowName?: string | null;
  onClose: () => void;
  onImportSuccess?: (workflowId: string) => void;
  initialTab?: WorkflowExportImportTab;
  mode?: string;
  workspaceId?: string | null;
}
