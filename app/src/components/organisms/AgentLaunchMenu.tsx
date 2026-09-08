import React, { useEffect, useRef } from "react";
import { Input } from "../atoms/Input";
import type { AgentLaunchMenuItem } from "../../types";

interface AgentLaunchMenuProps {
  readonly id: string;
  /** The header label sits above the path — e.g. "Folder". */
  readonly headerLabel: string;
  readonly folderPath: string;
  /** Set when the roster has no ready agent — an explanation row instead of items. */
  readonly empty: boolean;
  readonly items: readonly AgentLaunchMenuItem[];
  /** The opening prompt, handed to whichever agent the user then picks. */
  readonly prompt: string;
  readonly onPromptChange: (value: string) => void;
  /** Enter in the prompt field — launch the preferred agent with it. */
  readonly onPromptSubmit: () => void;
  readonly onClose: () => void;
}

/**
 * The dropdown half of the split launch button: a real `role="menu"` with
 * roving focus, so keyboard users get the same navigation a mouse user gets
 * from hovering — arrows cycle, Home/End jump, Escape returns to the trigger.
 */
export function AgentLaunchMenu({
  id,
  headerLabel,
  folderPath,
  empty,
  items,
  prompt,
  onPromptChange,
  onPromptSubmit,
  onClose,
}: AgentLaunchMenuProps) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const promptRef = useRef<HTMLInputElement>(null);

  // Opening the menu puts focus in the prompt field — the one control here that
  // has to be typed into — and ArrowDown from it reaches the agents, so the
  // keyboard path to "just launch" is one key longer and nothing else moves.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      (promptRef.current ?? itemRefs.current[0])?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const focusItem = (index: number): void => {
    const safeIndex = Math.max(0, Math.min(index, items.length - 1));
    itemRefs.current[safeIndex]?.focus();
  };

  const handleItemKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      let next: number;
      if (event.key === "ArrowDown") {
        next = (index + 1) % items.length;
      } else if (event.key === "ArrowUp") {
        next = (index - 1 + items.length) % items.length;
      } else if (event.key === "Home") {
        next = 0;
      } else {
        next = items.length - 1;
      }
      focusItem(next);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      id={id}
      role="menu"
      aria-label="Agent options"
      className="absolute top-9 right-0 z-50 min-w-[260px] max-w-[360px] overflow-hidden rounded-sm border border-border bg-surface-raised shadow-node dark:border-border-dark dark:bg-surface-dark-raised"
    >
      <div className="border-b border-border px-3 py-2 dark:border-border-dark">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
          {headerLabel}
        </p>
        <p
          className="truncate text-xs text-text-secondary dark:text-text-secondary-dark"
          title={folderPath}
        >
          {folderPath}
        </p>
        {/* Every agent in the roster takes an opening prompt (`promptMode` is
            `argv` or `flag` for all of them), so this is offered unconditionally
            rather than gated on the one the user has not picked yet. A custom
            agent configured `none` drops it, which is the same thing that
            happens to a prompt typed at its own banner. */}
        <Input
          ref={promptRef}
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onPromptSubmit();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              focusItem(0);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          placeholder="Task for the agent (optional)"
          aria-label="Task for the agent"
          size="xs"
          className="mt-2"
        />
      </div>
      {empty && (
        <p className="px-3 py-2 text-xs text-text-secondary dark:text-text-secondary-dark">
          No working agent CLI found. Check Settings → Agents.
        </p>
      )}
      {items.map((item, index) => (
        <button
          key={item.key}
          ref={(element) => {
            itemRefs.current[index] = element;
          }}
          type="button"
          role="menuitem"
          onClick={item.onSelect}
          onKeyDown={(event) => handleItemKeyDown(event, index)}
          className={[
            "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay",
            item.separated === true
              ? "border-t border-border text-text-secondary dark:border-border-dark dark:text-text-secondary-dark"
              : "text-text-primary dark:text-text-primary-dark",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <item.icon className="h-3.5 w-3.5 flex-shrink-0 text-text-muted dark:text-text-muted-dark" />
          {item.label}
        </button>
      ))}
    </div>
  );
}
