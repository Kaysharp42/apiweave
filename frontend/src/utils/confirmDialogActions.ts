import type { ButtonIntent } from '../types/ButtonIntent';

const VALID_CONFIRM_INTENTS = new Set(['error', 'warning', 'info']);

export const resolveConfirmDialogIntent = (intent: string): ButtonIntent => {
  if (typeof intent !== 'string') return 'default';
  const normalized = intent.trim().toLowerCase();
  return VALID_CONFIRM_INTENTS.has(normalized) ? normalized as ButtonIntent : 'default';
};

export const runConfirmDialogAction = ({ onConfirm, onClose }: { onConfirm?: () => void; onClose?: () => void } = {}): void => {
  onConfirm?.();
  onClose?.();
};
