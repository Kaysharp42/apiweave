import React, { Fragment, useRef, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { FileText } from "lucide-react";
import { Button } from "../atoms/Button";
import type { PromptDialogProps } from "../../types";

export function PromptDialog({
  open = false,
  onClose,
  onSubmit,
  title = "Enter a name",
  message,
  placeholder = "",
  defaultValue = "",
  submitLabel = "Create",
  cancelLabel = "Cancel",
}: PromptDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);

  const handleSubmit = (e: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = value.trim();
    if (trimmed) {
      onSubmit(trimmed);
      onClose();
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
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div
            className="fixed inset-0 bg-text-primary/30 dark:bg-surface-dark/80"
            aria-hidden="true"
          />
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
                <div className="flex-shrink-0 rounded-full bg-primary/10 p-1 dark:bg-primary-light/10">
                  <FileText className="h-5 w-5 text-primary dark:text-primary-light" />
                </div>
                <div className="flex-1 min-w-0">
                  <Dialog.Title className="truncate text-sm font-semibold text-text-primary dark:text-text-primary-dark">
                    {title}
                  </Dialog.Title>
                  {message && (
                    <Dialog.Description className="mt-1 text-sm text-text-secondary dark:text-text-secondary-dark">
                      {message}
                    </Dialog.Description>
                  )}
                </div>
              </div>

              <form onSubmit={handleSubmit} className="p-5">
                <input
                  ref={inputRef}
                  type="text"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={placeholder}
                  aria-label={title}
                  className="h-8 w-full rounded-sm border border-border bg-surface-raised px-2.5 text-sm text-text-primary placeholder:text-text-muted transition-[border-color,outline] duration-[var(--aw-transition-fast)] focus:border-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark dark:placeholder:text-text-muted-dark dark:focus:border-primary-light"
                />

                <div className="flex justify-end gap-2 mt-4">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onClose}
                  >
                    {cancelLabel}
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={!value.trim()}
                  >
                    {submitLabel}
                  </Button>
                </div>
              </form>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
