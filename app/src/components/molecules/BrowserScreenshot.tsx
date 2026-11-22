import { useEffect, useState, type KeyboardEvent } from "react";
import { Maximize2 } from "lucide-react";
import { Spinner } from "../atoms/Spinner";
import { Modal } from "./Modal";
import { apiweave, IpcError } from "../../utils/apiweaveClient";
import type { BrowserScreenshotProps } from "../../types";

const ALT = "The page after the step ran. Password fields are painted over.";

/**
 * The node editor steps to the previous or next node on an arrow key, from a
 * window listener that skips handled events. While the screenshot is open the
 * keys are the viewer's, so stepping cannot swap the node out from under it.
 */
function claimArrowKeys(event: KeyboardEvent) {
  if (event.key.startsWith("Arrow")) event.preventDefault();
}

/** The screenshot as a button that opens it full size, fitted to the window. */
function ExpandableScreenshot({ source, className }: { source: string; className: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="View the screenshot full size"
        title="View full size"
        className="group relative block w-full cursor-zoom-in rounded-xs focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-(--aw-focus-ring-offset)"
      >
        <img src={source} alt={ALT} draggable={false} className={`block w-full rounded-xs border border-border dark:border-border-dark ${className}`} />
        <span
          aria-hidden="true"
          className="absolute top-2 right-2 rounded-xs border border-border bg-surface-raised/90 p-1 text-text-secondary transition-colors group-hover:text-text-primary dark:border-border-dark dark:bg-surface-dark-raised/90 dark:text-text-secondary-dark dark:group-hover:text-text-primary-dark"
        >
          <Maximize2 className="h-4 w-4" />
        </span>
      </button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Screenshot" size="fullscreen" scrollable={false}>
        <div onKeyDown={claimArrowKeys} className="flex h-full items-center justify-center bg-surface-overlay p-4 dark:bg-surface-dark-overlay">
          <img src={source} alt={ALT} draggable={false} className="max-h-full max-w-full object-contain" />
        </div>
      </Modal>
    </>
  );
}

/**
 * A browser step's screenshot, read from the run's artifacts while it is on
 * screen. Shared by the step's result pane and its expanded canvas node.
 */
export function BrowserScreenshot({ workspaceId, artifactId, expandable = false, className = "" }: BrowserScreenshotProps) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setError(null);
    apiweave.runs
      .getArtifact(workspaceId, artifactId)
      .then((artifact) => {
        if (!cancelled) setSource(`data:${artifact.mime};base64,${artifact.base64}`);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof IpcError ? cause.message : "The screenshot could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, artifactId]);

  if (error !== null) return <p className="text-xs text-text-secondary dark:text-text-secondary-dark">{error}</p>;
  if (source === null) return <Spinner size="sm" />;
  if (expandable) return <ExpandableScreenshot source={source} className={className} />;
  return (
    <img
      src={source}
      alt={ALT}
      draggable={false}
      className={`block w-full rounded-xs border border-border dark:border-border-dark ${className}`}
    />
  );
}
