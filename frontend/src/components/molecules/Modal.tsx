import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { X } from 'lucide-react';
import type { ModalInternalProps } from '../../types';

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
          <div className="fixed inset-0 bg-text-primary/40 dark:bg-surface-dark/80" aria-hidden="true" />
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
                'w-full rounded-sm bg-surface-raised dark:bg-surface-dark-raised',
                'border border-border shadow-modal dark:border-border-dark',
                'flex flex-col',
                size === 'fullscreen' ? 'h-[90vh]' : 'max-h-[90vh]',
                panelSize,
                className,
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {title && (
                <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-3 dark:border-border-dark">
                  <Dialog.Title className="truncate text-sm font-semibold text-text-primary dark:text-text-primary-dark">
                    {title}
                  </Dialog.Title>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {headerExtra}
                    {showClose && (
                      <button
                        type="button"
                        onClick={onClose}
                        className="cursor-pointer rounded-sm border border-transparent p-1 text-text-secondary transition-colors hover:border-border hover:bg-surface-overlay hover:text-text-primary focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:text-text-secondary-dark dark:hover:border-border-dark dark:hover:bg-surface-dark-overlay dark:hover:text-text-primary-dark"
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
                <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3 dark:border-border-dark">
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
