export interface ConfirmDialogProps {
  open?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: string | React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  intent?: "error" | "warning" | "info";
  /**
   * A third, non-default way out between Cancel and Confirm — e.g. "Discard"
   * beside "Save". Shown only when both the label and the handler are given.
   */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Extra controls rendered under the message, e.g. an opt-in checkbox. */
  children?: React.ReactNode;
}
