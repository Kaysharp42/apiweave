export interface ErrorBoundaryProps {
  /** What the boundary guards, for the log line, e.g. `app` or `node n1 (delay)`. */
  name: string;
  /** Custom failure UI; the default offers Try again, Reload and Copy error details. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
  children: React.ReactNode;
}
