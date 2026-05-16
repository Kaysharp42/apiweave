type ConfirmIntent = 'error' | 'warning' | 'info' | 'default';

const VALID_CONFIRM_INTENTS = new Set<ConfirmIntent>(['error', 'warning', 'info']);

export const resolveConfirmDialogIntent = (intent: unknown): ConfirmIntent => {
  if (typeof intent !== 'string') return 'default';
  const normalized = intent.trim().toLowerCase() as ConfirmIntent;
  return VALID_CONFIRM_INTENTS.has(normalized) ? normalized : 'default';
};

export const runConfirmDialogAction = ({ onConfirm, onClose }: { onConfirm?: () => void; onClose?: () => void } = {}): void => {
  onConfirm?.();
  onClose?.();
};
