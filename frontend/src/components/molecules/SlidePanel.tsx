import React from 'react';
import { Dialog, Transition, TransitionChild } from '@headlessui/react';
import { X } from 'lucide-react';
import { IconButton } from '../atoms/IconButton';

export interface SlidePanelProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  side?: 'left' | 'right';
  size?: 'sm' | 'md' | 'lg';
  showClose?: boolean;
  className?: string;
}

const SIZE_MAP: Record<string, string> = {
  sm: 'max-w-xs',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export function SlidePanel({
  open,
  onClose,
  title,
  children,
  footer,
  side = 'right',
  size = 'md',
  showClose = true,
  className = '',
}: SlidePanelProps) {
  const isRight = side === 'right';

  return (
    <Transition show={open}>
      <Dialog onClose={onClose} className="relative z-50">
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
                <div className="flex items-center justify-between px-4 py-3 border-b border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised">
                  <Dialog.Title className="text-base font-semibold text-text-primary dark:text-text-primary-dark">
                    {title}
                  </Dialog.Title>
                  {showClose && (
                    <IconButton
                      tooltip="Close panel"
                      size="sm"
                      variant="ghost"
                      onClick={onClose}
                    >
                      <X size={16} />
                    </IconButton>
                  )}
                </div>

                <div className={`flex-1 overflow-y-auto px-4 py-3 ${className}`}>
                  {children}
                </div>

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
}
