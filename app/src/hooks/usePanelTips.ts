import { useCallback, useEffect, useState } from "react";

const STORAGE_PREFIX = "apiweave.panelTips.seen.";

/**
 * usePanelTips — disclosure state for a panel's tips sheet.
 *
 * Side panels are too narrow to spend vertical space on a permanent tips
 * footer, so tips live behind a header affordance instead. The first time a
 * user sees a panel the trigger carries an unseen dot; opening it once marks
 * the panel's tips as seen in localStorage so the dot never nags again.
 *
 * @param panelKey — stable key for the panel ("variables", "functions", …)
 */
export function usePanelTips(panelKey: string) {
  const storageKey = `${STORAGE_PREFIX}${panelKey}`;

  const [isOpen, setIsOpen] = useState(false);
  const [hasSeen, setHasSeen] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === "1";
    } catch {
      // Private mode / storage disabled — treat as seen so we don't nag.
      return true;
    }
  });

  const open = useCallback(() => {
    setIsOpen(true);
    setHasSeen(true);
    try {
      localStorage.setItem(storageKey, "1");
    } catch {
      // Non-fatal: the dot simply reappears next session.
    }
  }, [storageKey]);

  const close = useCallback(() => setIsOpen(false), []);

  const toggle = useCallback(() => {
    if (isOpen) close();
    else open();
  }, [close, isOpen, open]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close, isOpen]);

  return { isOpen, open, close, toggle, hasUnseen: !hasSeen };
}

export default usePanelTips;
