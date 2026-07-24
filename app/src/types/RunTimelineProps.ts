export interface RunTimelineProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string | null;
  runId: string | null;
}