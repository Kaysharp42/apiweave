import { Toaster } from "sonner";

export function Toast() {
  return (
    <Toaster
      position="top-right"
      closeButton
      expand
      theme="system"
      toastOptions={{
        duration: 4000,
        className:
          "font-sans text-sm rounded-sm border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark shadow-popover",
        style: {
          fontFamily: "inherit",
        },
      }}
      // Electron's frameless window marks the header as a drag region
      // (WebkitAppRegion: drag). The toaster at top-right overlaps that 48px
      // strip; without no-drag the close button's clicks are consumed as
      // window drags and the toast appears not to close.
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    />
  );
}
