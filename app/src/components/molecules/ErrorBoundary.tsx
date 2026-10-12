import React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "../atoms/Button";
import { EmptyState } from "./EmptyState";
import { getLogger } from "../../utils/logger";
import { confirmCloseAll } from "../../stores/PendingEditsStore";
import type { ErrorBoundaryProps } from "../../types";

const log = getLogger("ErrorBoundary");

/**
 * Catches a render error below it so React does not unmount everything up to
 * the root and leave a blank window. Placed at the app root, around the main
 * content (so the nav, sidebar and agent dock survive a page failing), around
 * the response inspector (so the node editor and its draft survive), and per
 * canvas node through `withNodeBoundary`.
 *
 * React boundaries never reset themselves, so the fallback always gets a way
 * to try again: most throws come from data a re-render or reload replaces.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    log.error(
      `${this.props.name} failed to render: ${error.message}`,
      error.stack,
      info.componentStack,
    );
  }

  private readonly reset = (): void => this.setState({ error: null });

  /**
   * A reload runs no effect cleanups, so a pending auto-save and every tab's
   * unsaved draft would go with it — and below the root the canvas is often
   * fine. It asks first, like quitting does.
   */
  private readonly reload = async (): Promise<void> => {
    if (await confirmCloseAll()) window.location.reload();
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div role="alert" className="flex h-full w-full items-center justify-center">
        <EmptyState
          icon={
            <AlertTriangle
              className="h-10 w-10 text-status-error"
              aria-hidden="true"
            />
          }
          title="Something went wrong"
          description={error.message || String(error)}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" size="sm" onClick={this.reset}>
                Try again
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void this.reload()}
              >
                Reload
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(error.stack ?? String(error))
                    .catch(() => {})
                }
              >
                Copy error details
              </Button>
            </div>
          }
        />
      </div>
    );
  }
}
