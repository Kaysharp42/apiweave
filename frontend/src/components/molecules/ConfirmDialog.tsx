import { Fragment, useRef } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { AlertTriangle, Info, XCircle } from 'lucide-react';
import { Button } from '../atoms/Button';
import {
  resolveConfirmDialogIntent,
  runConfirmDialogAction,
} from '../../utils/confirmDialogActions';
import type { ConfirmDialogProps } from '../../types';

export function ConfirmDialog({
  open = false,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  intent = 'error',
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmIntent = resolveConfirmDialogIntent(intent);

  const intentConfig = {
    error: { icon: XCircle, iconBg: 'bg-status-error/10 dark:bg-[var(--aw-status-error)]/10', iconText: 'text-status-error dark:text-[var(--aw-status-error)]' },
    warning: { icon: AlertTriangle, iconBg: 'bg-status-warning/10 dark:bg-[var(--aw-status-warning)]/10', iconText: 'text-status-warning dark:text-[var(--aw-status-warning)]' },
    info: { icon: Info, iconBg: 'bg-status-info/10 dark:bg-[var(--aw-status-info)]/10', iconText: 'text-status-info dark:text-[var(--aw-status-info)]' },
  };

  const config = intentConfig[intent];
  const IntentIcon = config.icon;

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-50"
        onClose={onClose}
        initialFocus={cancelRef}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-text-primary/30 dark:bg-surface-dark/80" aria-hidden="true" />
        </Transition.Child>

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel className="w-full max-w-md rounded-sm border border-border bg-surface-raised shadow-modal dark:border-border-dark dark:bg-surface-dark-raised">
              <div className="flex items-start gap-3 border-b border-border p-5 dark:border-border-dark">
                <div className={`flex-shrink-0 rounded-full p-1 ${config.iconBg}`}>
                  <IntentIcon className={`w-5 h-5 ${config.iconText}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <Dialog.Title className="truncate text-sm font-semibold text-text-primary dark:text-text-primary-dark">
                    {title}
                  </Dialog.Title>
                  {message && (
                    <Dialog.Description className="mt-2 text-sm text-text-secondary dark:text-text-secondary-dark">
                      {message}
                    </Dialog.Description>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-border px-5 py-3 dark:border-border-dark">
                <Button
                  ref={cancelRef}
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                >
                  {cancelLabel}
                </Button>

                <Button
                  variant="primary"
                  size="sm"
                  intent={confirmIntent}
                  onClick={() => runConfirmDialogAction({ onConfirm, onClose })}
                >
                  {confirmLabel}
                </Button>
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
