import { useLayoutEffect, useRef } from "react";
import type { ScrollableNodeTextAreaProps } from "../../../types";

/**
 * A node textarea that is not a scroll container until you edit it.
 *
 * A scrollable box inside ReactFlow's transformed viewport is the one thing in
 * a node that Chromium promotes to its own composited layer (`OverflowScrolling`
 * — check it in DevTools' layer tree). Everything else in a node paints into the
 * viewport layer, which is rastered *with* the zoom transform and so stays sharp
 * at any zoom; a promoted layer is rastered on its own and resampled by the
 * compositor, which is why only this box went soft when the canvas was zoomed
 * out. See the "what NOT to put here" note in index.css — same mechanism, one
 * level down.
 *
 * So at rest the wrapper only clips (`overflow: clip` creates no scroll
 * container at all, unlike `hidden`) and the textarea carries its full content
 * height. Focus it and the wrapper becomes a real scroller again, so the caret,
 * the wheel and the resize grip all work while you are actually editing — by
 * which point you are zoomed in and the layer costs nothing.
 */
export function ScrollableNodeTextArea({
  className = "",
  value,
  ...rest
}: ScrollableNodeTextAreaProps) {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textArea = textAreaRef.current;
    if (!textArea) return;

    textArea.style.height = "0px";
    textArea.style.height = `${textArea.scrollHeight}px`;
  }, [value]);

  return (
    <div
      data-scrollable-node-textarea
      className="nodrag h-24 min-h-14 max-h-96 w-full resize-y overflow-clip focus-within:overflow-auto rounded-node-ctl border border-border bg-surface-raised focus-within:outline-2 focus-within:outline-[var(--aw-primary)] focus-within:outline-offset-[var(--aw-focus-ring-offset)] dark:border-border-dark dark:bg-surface-dark-raised"
    >
      <textarea
        ref={textAreaRef}
        value={value}
        className={`block min-h-full w-full resize-none overflow-hidden border-0 bg-transparent px-1.5 py-1 font-mono text-xs font-normal leading-4 text-text-primary outline-none dark:text-text-primary-dark ${className}`}
        {...rest}
      />
    </div>
  );
}
