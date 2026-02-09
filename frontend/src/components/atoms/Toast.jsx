/**
 * Toast — APIWeave-styled sonner toast provider.
 *
 * Mount <Toast /> once at the app root (App.jsx).
 * Call toast.success(), toast.error(), toast.info() from anywhere:
 *
 *   import { toast } from 'sonner';
 *   toast.success('Workflow saved');
 *   toast.error('Request failed');
 */
import { Toaster } from 'sonner';

export default function Toast() {
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
