import { useCallback, useEffect, useState } from "react";

/**
 * Track the width an element has actually been given.
 *
 * Tailwind's `lg:` and friends ask how wide the *viewport* is, which is the
 * wrong question for anything that shares a row with a resizable panel: the
 * panel takes the width, the media query never fires, and the content spills
 * or wraps at a viewport size the breakpoint still calls roomy. This asks the
 * element instead.
 *
 * Returns a ref callback rather than a ref object so the observer is attached
 * the moment the node exists — a `useEffect` on a `useRef` misses nodes that
 * mount behind a conditional render.
 *
 * The node is held in state so the effect (which owns the observer) re-runs
 * when it changes. React invokes a ref callback once per node even under
 * `StrictMode`, while effects are set up, torn down and set up again — an
 * observer created in the callback was disconnected by the simulated unmount
 * and never rebuilt, leaving the width pinned at its first (often zero)
 * measurement.
 */
export function useElementWidth<T extends HTMLElement>(): [
  (element: T | null) => void,
  number | null,
] {
  const [width, setWidth] = useState<number | null>(null);
  const [element, setElement] = useState<T | null>(null);

  const ref = useCallback((node: T | null) => {
    setElement(node);

    // Measured once up front, before the observer's first async callback, so
    // the first painted frame is already the right variant instead of the
    // widest one collapsing a tick later.
    if (node !== null) {
      setWidth(node.getBoundingClientRect().width);
    }
  }, []);

  useEffect(() => {
    // jsdom and older runtimes have no ResizeObserver. The single measurement
    // in the ref callback still stands, which is better than leaving every
    // consumer pinned to the unmeasured branch.
    if (element === null || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [ref, width];
}
