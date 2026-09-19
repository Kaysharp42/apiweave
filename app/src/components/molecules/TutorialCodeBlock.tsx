import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { IconButton } from "../atoms/IconButton";
import type { TutorialCodeBlockProps } from "../../types";

type CopyState = "idle" | "copied" | "error";

/**
 * A lesson example rendered in a copyable code block. Long expressions scroll
 * inside the block rather than widening the page. Copy success and failure are
 * both announced; the state resets when the example changes so a stale
 * "Copied" never labels a different block.
 */
export function TutorialCodeBlock({
  example,
  className = "",
}: TutorialCodeBlockProps) {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    setState("idle");
  }, [example.code]);

  const copy = (): void => {
    void navigator.clipboard?.writeText(example.code).then(
      () => {
        setState("copied");
        window.setTimeout(() => setState("idle"), 1500);
      },
      () => {
        setState("error");
      },
    );
  };

  const label =
    state === "copied" ? "Copied" : state === "error" ? "Copy failed" : "Copy example";

  return (
    <figure className={["min-w-0", className].filter(Boolean).join(" ")}>
      <figcaption className="mb-1.5 flex items-center justify-between gap-2">
        <span className="min-w-0 text-xs font-medium text-text-secondary dark:text-text-secondary-dark">
          {example.caption}
        </span>
        <IconButton
          tooltip={label}
          size="xs"
          variant={state === "error" ? "error" : "ghost"}
          onClick={copy}
        >
          {state === "copied" ? (
            <Check className="h-3.5 w-3.5 text-status-success dark:text-[var(--aw-status-success)]" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </IconButton>
      </figcaption>
      <pre className="max-w-full overflow-x-auto rounded-sm border border-border bg-surface-overlay p-3 text-xs leading-relaxed dark:border-border-dark dark:bg-surface-dark-overlay">
        <code className="font-mono text-text-primary dark:text-text-primary-dark">
          {example.code}
        </code>
      </pre>
      <span
        role="status"
        aria-live="polite"
        className={[
          "mt-1 block text-[11px]",
          state === "error"
            ? "text-status-error dark:text-[var(--aw-status-error)]"
            : "sr-only",
        ].join(" ")}
      >
        {state === "copied"
          ? "Example copied to clipboard."
          : state === "error"
            ? "Could not copy the example. Select the text and copy it manually."
            : ""}
      </span>
    </figure>
  );
}
