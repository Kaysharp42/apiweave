import { Toaster } from 'sonner';

export function Toast() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        className: 'font-sans text-sm',
        style: {
          fontFamily: "'Open Sans', sans-serif",
        },
      }}
      theme="system"
      richColors
      closeButton
    />
  );
}
