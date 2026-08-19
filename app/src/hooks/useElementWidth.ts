import { useCallback, useEffect, useRef, useState } from "react";

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
 */
export function useElementWidth<T extends HTMLElement>(): [
  (element: T | null) => void,
  number | null,
] {
  const [width, setWidth] = useState<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((element: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (element === null) return;

    // Measured once up front, before the observer's first async callback, so
    // the first painted frame is already the right variant instead of the
    // widest one collapsing a tick later.
    setWidth(element.getBoundingClientRect().width);

    // jsdom and older runtimes have no ResizeObserver. The single measurement
    // above still stands, which is better than leaving every consumer pinned
    // to the unmeasured branch.
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return [ref, width];
}
