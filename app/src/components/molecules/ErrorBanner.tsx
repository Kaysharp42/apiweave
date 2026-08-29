interface ErrorBannerProps {
  readonly message: string;
  readonly onDismiss: () => void;
}

/** The dismissable error strip under a page header. */
export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <div className="mx-6 mt-4 p-3 rounded bg-status-error/10 dark:bg-status-error/20 border border-status-error/30 text-sm text-status-error">
      {message}
      <button
        type="button"
        onClick={onDismiss}
        className="ml-2 underline cursor-pointer text-xs"
      >
        Dismiss
      </button>
    </div>
  );
}
