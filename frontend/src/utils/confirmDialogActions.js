const VALID_CONFIRM_INTENTS = new Set(['error', 'warning', 'info']);

export const resolveConfirmDialogIntent = (intent) => {
  if (typeof intent !== 'string') return 'default';
  const normalized = intent.trim().toLowerCase();
  return VALID_CONFIRM_INTENTS.has(normalized) ? normalized : 'default';
};

export const runConfirmDialogAction = ({ onConfirm, onClose } = {}) => {
  onConfirm?.();
  onClose?.();
};
