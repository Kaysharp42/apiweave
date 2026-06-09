export interface WorkflowJsonEditorProps {
  open: boolean;
  workflowJson: Record<string, unknown> | null;
  onApply: (json: Record<string, unknown>) => void;
  onClose: () => void;
}
