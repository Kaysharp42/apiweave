import { useCallback, useEffect, useRef, useState } from "react";
import { selectCanvasTip } from "../canvas/tips";
import type { CanvasTipContext } from "../types/CanvasTipContext";

const STORAGE_PREFIX = "apiweave.canvasTips.dismissed.";
const SETTLE_MS = 500;

function dismissedTips(): Set<string> {
  try {
    return new Set(
      Object.keys(localStorage)
        .filter((key) => key.startsWith(STORAGE_PREFIX))
        .map((key) => key.slice(STORAGE_PREFIX.length)),
    );
  } catch {
    return new Set();
  }
}

/**
 * Settles selection-driven hints after a marquee ends and remembers dismissals.
 * A canvas tip is guidance, not an interruption, so a live run suppresses it.
 */
export function useCanvasTip(context: CanvasTipContext) {
  const [settledContext, setSettledContext] = useState(context);
  const [dismissed, setDismissed] = useState(dismissedTips);
  const seenThisSession = useRef(new Set<string>());
  const [activeTip, setActiveTip] = useState<ReturnType<typeof selectCanvasTip>>(
    null,
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => setSettledContext(context), SETTLE_MS);
    return () => window.clearTimeout(timeout);
  }, [context]);

  const candidate = selectCanvasTip(settledContext, dismissed);
  useEffect(() => {
    if (candidate === null) {
      setActiveTip(null);
      return;
    }
    setActiveTip((current) => {
      if (current?.id === candidate.id) return current;
      if (seenThisSession.current.has(candidate.id)) return null;
      seenThisSession.current.add(candidate.id);
      return candidate;
    });
  }, [candidate]);

  const dismiss = useCallback((id: string) => {
    setDismissed((current) => new Set(current).add(id));
    setActiveTip((current) => (current?.id === id ? null : current));
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${id}`, "1");
    } catch {
      // Storage being unavailable must not make a dismiss button lie.
    }
  }, []);

  return { tip: activeTip, dismiss };
}
