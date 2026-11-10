import { Button } from "../atoms/Button";

interface ErrorBannerProps {
  readonly message: string;
  readonly onDismiss: () => void;
}

/** The dismissable error strip under a page header. */
export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="mx-6 mt-4 p-3 rounded-sm bg-status-error/10 dark:bg-status-error/20 border border-status-error/30 text-sm text-status-error"
    >
      <span>{message}</span>
      <Button variant="ghost" intent="error" size="xs" className="ml-2 underline" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
