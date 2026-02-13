import React, { Fragment, useRef, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { AlertTriangle } from 'lucide-react';

/**
 * ConfirmDialog — Replaces all `window.confirm()` / `window.alert()` with
 * a styled, accessible DaisyUI modal powered by Headless UI Dialog.
 *
 * @param {boolean} open
 * @param {function} onClose      — called on cancel / backdrop click / Escape
 * @param {function} onConfirm    — called on confirm button click
 * @param {string} title
 * @param {string|React.ReactNode} message
 * @param {string} confirmLabel   — confirm button text (default: "Confirm")
 * @param {string} cancelLabel    — cancel button text (default: "Cancel")
 * @param {'error'|'warning'|'info'} intent — affects confirm button color
 */
export default function ConfirmDialog({
  open = false,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  intent = 'error',
}) {
  const cancelRef = useRef(null);

  const confirmBtnClass = {
    error: 'btn-error',
    warning: 'btn-warning',
    info: 'btn-info',
  }[intent] ?? 'btn-error';

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-50"
        onClose={onClose}
        initialFocus={cancelRef}
      >
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        </Transition.Child>

        {/* Panel */}
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
            <Dialog.Panel className="w-full max-w-md rounded-lg bg-surface-raised dark:bg-surface-dark-raised p-6 shadow-xl border border-border dark:border-border-dark">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 p-1 rounded-full bg-status-error/10">
                  <AlertTriangle className="w-5 h-5 text-status-error" />
                </div>
                <div className="flex-1">
                  <Dialog.Title className="text-base font-semibold text-text-primary dark:text-text-primary-dark">
                    {title}
                  </Dialog.Title>
                  {message && (
                    <Dialog.Description className="mt-2 text-sm text-text-secondary dark:text-text-secondary-dark">
                      {message}
                    </Dialog.Description>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button
                  ref={cancelRef}
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={onClose}
                >
                  {cancelLabel}
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${confirmBtnClass}`}
                  onClick={() => {
                    onConfirm?.();
                    onClose?.();
                  }}
                >
                  {confirmLabel}
                </button>
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
