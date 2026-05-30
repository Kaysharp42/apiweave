import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { X } from 'lucide-react';
import type { ModalProps } from '../../types';

export interface ModalInternalProps extends ModalProps {
  headerExtra?: React.ReactNode;
  showClose?: boolean;
  scrollable?: boolean;
  initialFocus?: React.MutableRefObject<HTMLElement | null>;
  className?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  headerExtra,
  size = 'md',
  className = '',
  showClose = true,
  scrollable = true,
  initialFocus,
}: ModalInternalProps) {
  const sizeClasses: Record<string, string> = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl',
    fullscreen: 'max-w-[95vw] max-h-[95vh]',
  };

  const panelSize = sizeClasses[size] ?? sizeClasses.md;

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-50"
        onClose={onClose}
        {...(initialFocus && { initialFocus })}
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
          <div className="fixed inset-0 bg-slate-950/40" aria-hidden="true" />
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
            <Dialog.Panel
              className={[
                'w-full rounded-lg bg-surface-raised dark:bg-surface-dark-raised',
                'shadow-xl border border-border dark:border-border-dark',
                'flex flex-col',
                size === 'fullscreen' ? 'h-[90vh]' : 'max-h-[90vh]',
                panelSize,
                className,
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {title && (
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-border dark:border-border-dark flex-shrink-0">
                  <Dialog.Title className="text-base font-semibold text-text-primary dark:text-text-primary-dark truncate">
                    {title}
                  </Dialog.Title>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {headerExtra}
                    {showClose && (
                      <button
                        type="button"
                        onClick={onClose}
                        className="p-1 rounded text-text-secondary dark:text-text-secondary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors"
                        aria-label="Close"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div
                className={[
                  'flex-1 min-h-0',
                  scrollable && 'overflow-y-auto',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {children}
              </div>

              {footer && (
                <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border dark:border-border-dark flex-shrink-0">
                  {typeof footer === 'function' ? footer() : footer}
                </div>
              )}
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
