export interface ConfirmDialogProps {
  open?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: string | React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  intent?: 'error' | 'warning' | 'info';
}
