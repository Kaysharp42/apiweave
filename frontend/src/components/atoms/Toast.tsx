import { Toaster } from 'sonner';

export function Toast() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        className: 'font-sans text-sm rounded-sm border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark shadow-popover',
        style: {
          fontFamily: 'inherit',
        },
      }}
      theme="system"
      closeButton
    />
  );
}
