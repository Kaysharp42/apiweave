import React from 'react';
import { Dialog, Transition, TransitionChild } from '@headlessui/react';
import { X } from 'lucide-react';

/**
 * SlidePanel — an accessible side-sheet built on Headless UI Dialog.
 *
 * Props:
 *  - open        : boolean — whether the panel is visible
 *  - onClose     : () => void — called when the user clicks the backdrop / presses Escape
 *  - title       : ReactNode — panel heading
 *  - children    : ReactNode — panel body
 *  - footer      : ReactNode (optional) — sticky footer area
 *  - side        : 'left' | 'right' (default 'right')
 *  - size        : 'sm' | 'md' | 'lg' (default 'md')  →  320 / 400 / 512 px
 *  - showClose   : boolean (default true)
 *  - className   : string  — extra classes for the panel body
 */
const SIZE_MAP = {
  sm: 'max-w-xs',   // 320px
  md: 'max-w-md',   // 448px (28rem)
  lg: 'max-w-lg',   // 512px
};

const SlidePanel = ({
  open,
  onClose,
  title,
  children,
  footer,
  side = 'right',
  size = 'md',
  showClose = true,
  className = '',
}) => {
  const isRight = side === 'right';

  return (
    <Transition show={open}>
      <Dialog onClose={onClose} className="relative z-50">
        {/* Backdrop */}
        <TransitionChild
          enter="transition-opacity duration-200 ease-out"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="transition-opacity duration-150 ease-in"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-surface-overlay" />
        </TransitionChild>

        {/* Panel wrapper */}
        <div className="fixed inset-0 overflow-hidden">
          <div
            className={`absolute inset-y-0 flex ${
              isRight ? 'right-0 justify-end' : 'left-0 justify-start'
            }`}
          >
            <TransitionChild
              enter="transition-transform duration-250 ease-out"
              enterFrom={isRight ? 'translate-x-full' : '-translate-x-full'}
              enterTo="translate-x-0"
              leave="transition-transform duration-200 ease-in"
              leaveFrom="translate-x-0"
              leaveTo={isRight ? 'translate-x-full' : '-translate-x-full'}
            >
              <Dialog.Panel
                className={`w-screen ${SIZE_MAP[size] || SIZE_MAP.md} h-full flex flex-col
                  bg-surface dark:bg-surface-dark border-border dark:border-border-dark
                  ${isRight ? 'border-l' : 'border-r'} shadow-xl`}
              >
                {/* ── Header ── */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised">
                  <Dialog.Title className="text-base font-semibold text-text-primary dark:text-text-primary-dark">
                    {title}
                  </Dialog.Title>
                  {showClose && (
                    <button
                      onClick={onClose}
                      className="btn btn-ghost btn-sm btn-square"
                      aria-label="Close panel"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>

                {/* ── Body ── */}
                <div className={`flex-1 overflow-y-auto px-4 py-3 ${className}`}>
                  {children}
                </div>

                {/* ── Footer (optional) ── */}
                {footer && (
                  <div className="px-4 py-3 border-t border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised">
                    {footer}
                  </div>
                )}
              </Dialog.Panel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};

export default SlidePanel;
