import React, { Fragment, useRef, useState, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { FileText } from 'lucide-react';

/**
 * PromptDialog — Replaces `window.prompt()` with a styled, accessible modal.
 *
 * @param {boolean} open
 * @param {function} onClose     — called on cancel / backdrop click / Escape
 * @param {function} onSubmit    — called with the input value on submit
 * @param {string} title         — dialog title
 * @param {string} message       — optional description text
 * @param {string} placeholder   — input placeholder text
 * @param {string} defaultValue  — initial input value
 * @param {string} submitLabel   — submit button text (default: "Create")
 * @param {string} cancelLabel   — cancel button text (default: "Cancel")
 */
export default function PromptDialog({
  open = false,
  onClose,
  onSubmit,
  title = 'Enter a name',
  message,
  placeholder = '',
  defaultValue = '',
  submitLabel = 'Create',
  cancelLabel = 'Cancel',
}) {
  const inputRef = useRef(null);
  const [value, setValue] = useState(defaultValue);

  // Reset value when dialog opens
  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      // Focus the input after transition
      setTimeout(() => inputRef.current?.select(), 100);
    }
  }, [open, defaultValue]);

  const handleSubmit = (e) => {
    e?.preventDefault();
    const trimmed = value.trim();
    if (trimmed) {
      onSubmit?.(trimmed);
      onClose?.();
    }
  };

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-50"
        onClose={onClose}
        initialFocus={inputRef}
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
                <div className="flex-shrink-0 p-1 rounded-full bg-primary/10">
                  <FileText className="w-5 h-5 text-primary dark:text-primary" />
                </div>
                <div className="flex-1">
                  <Dialog.Title className="text-base font-semibold text-text-primary dark:text-text-primary-dark">
                    {title}
                  </Dialog.Title>
                  {message && (
                    <Dialog.Description className="mt-1 text-sm text-text-secondary dark:text-text-secondary-dark">
                      {message}
                    </Dialog.Description>
                  )}
                </div>
              </div>

              <form onSubmit={handleSubmit} className="mt-4">
                <input
                  ref={inputRef}
                  type="text"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={placeholder}
                  className="input input-bordered input-sm w-full bg-surface dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark focus:border-primary dark:focus:border-primary"
                />

                <div className="flex justify-end gap-2 mt-4">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={onClose}
                  >
                    {cancelLabel}
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={!value.trim()}
                  >
                    {submitLabel}
                  </button>
                </div>
              </form>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
