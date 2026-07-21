export interface PromptDialogProps {
  open?: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
  title?: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  submitLabel?: string;
  cancelLabel?: string;
}
