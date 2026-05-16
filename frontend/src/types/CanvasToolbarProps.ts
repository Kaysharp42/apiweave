export interface CanvasToolbarProps {
  onSave: () => void;
  onHistory: () => void;
  onJsonEditor: () => void;
  onImport: () => void;
  onRun: () => void;
  onRunFromLastFailed?: () => void;
  onRunAllFailed?: () => void;
  onRunFromFailedNode?: (nodeId: string) => void;
  isRunning?: boolean;
  environments: Array<{ environmentId: string; name: string }>;
  selectedEnvironment?: string;
  onEnvironmentChange: (value: string) => void;
  onRefreshSwagger?: () => void;
  isSwaggerRefreshing?: boolean;
  workflowId?: string;
  resumeOptions?: Array<{ nodeId: string; label: string }>;
  isResumeLoading?: boolean;
}
