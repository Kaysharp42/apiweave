import type { KeyboardEvent } from "react";

const STEP: Record<string, (index: number, count: number) => number> = {
  ArrowRight: (index) => index + 1,
  ArrowLeft: (index) => index - 1,
  Home: () => 0,
  End: (_index, count) => count - 1,
};

/**
 * WAI-ARIA tablist keyboard model, for the tablist's `onKeyDown`: the arrows
 * (wrapping), Home and End move focus to another tab and activate it. Tabs use
 * a roving tabindex, so without this only the active tab is reachable from the
 * keyboard.
 */
export function handleTablistKeyDown(event: KeyboardEvent<HTMLElement>): void {
  const step = STEP[event.key];
  if (!step) return;
  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
  );
  const current = tabs.findIndex((tab) => tab === document.activeElement);
  if (current === -1) return;
  event.preventDefault();
  const count = tabs.length;
  const next = tabs[(step(current, count) + count) % count];
  next?.focus();
  next?.click();
}
