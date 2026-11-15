import type { LucideIcon } from "lucide-react";

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
  /** The icon beside the title. Defaults to a document, for the naming prompts this dialog mostly serves. */
  icon?: LucideIcon;
}
