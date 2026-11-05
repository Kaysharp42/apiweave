import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCloseOnOutsideOrEscape } from "../../hooks/useCloseOnOutsideOrEscape";
import { nextMenuFocusIndex } from "../../utils/menuFocus";
import { Kbd } from "../atoms/Kbd";
import type { ContextMenuProps } from "../../types";

/** Gap kept between the menu and the viewport edge when it has to flip. */
const VIEWPORT_MARGIN = 8;

/**
 * A right-click menu anchored to the cursor.
 *
 * Portalled to `document.body` for the same reason the sidebar's Headless UI
 * menus pass `anchor`: the sidebar sits inside an Allotment pane, and a menu
 * rendered in the row's own subtree is clipped by that pane's `overflow-hidden`
 * long before it runs out of screen.
 *
 * A real `role="menu"` with roving focus, so the keyboard route is the same one
 * the mouse gets — arrows cycle, Home/End jump, Escape closes. Mount this only
 * while the menu is open; it takes focus on mount.
 */
export function ContextMenu({ x, y, label, items, onClose }: ContextMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [position, setPosition] = useState<{ left: number; top: number }>({
    left: x,
    top: y,
  });

  useCloseOnOutsideOrEscape(true, onClose, containerRef);

  // Measure once mounted, then pull the menu back inside the viewport. A row near
  // the bottom of a scrolled sidebar is the ordinary case, not the edge case, and
  // a menu whose items hang off-screen has items the user cannot reach at all.
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const left =
      x + width + VIEWPORT_MARGIN > window.innerWidth
        ? Math.max(VIEWPORT_MARGIN, x - width)
        : x;
    const top =
      y + height + VIEWPORT_MARGIN > window.innerHeight
        ? Math.max(VIEWPORT_MARGIN, y - height)
        : y;
    setPosition({ left, top });
  }, [x, y]);

  // Focus the first actionable item so the next keypress is an arrow, not a Tab
  // hunt. A fully disabled menu still takes focus, on the first row.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const firstEnabled = items.findIndex((item) => item.disabled !== true);
      itemRefs.current[Math.max(0, firstEnabled)]?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const handleItemKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    const actionable = items.flatMap((item, itemIndex) =>
      item.disabled === true ? [] : [itemIndex],
    );
    const current = Math.max(0, actionable.indexOf(index));
    const next = nextMenuFocusIndex(event.key, current, actionable.length);
    if (next === null) return;

    event.preventDefault();
    itemRefs.current[actionable[next] ?? 0]?.focus();
  };

  return createPortal(
    <div
      ref={containerRef}
      role="menu"
      aria-label={label}
      className="fixed z-50 min-w-50 max-w-80 overflow-hidden rounded-xs border border-border bg-surface-raised py-1 shadow-node dark:border-border-dark dark:bg-surface-dark-raised"
      style={{ left: position.left, top: position.top }}
    >
      {items.map((item, index) => (
        <button
          key={item.key}
          ref={(element) => {
            itemRefs.current[index] = element;
          }}
          type="button"
          role="menuitem"
          disabled={item.disabled === true}
          aria-disabled={item.disabled === true ? true : undefined}
          onClick={() => {
            if (item.disabled === true) return;
            item.onSelect();
            onClose();
          }}
          onKeyDown={(event) => handleItemKeyDown(event, index)}
          className={[
            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors duration-150 motion-reduce:transition-none",
            "cursor-pointer focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            item.separated === true
              ? "mt-1 border-t border-border pt-2 dark:border-border-dark"
              : "",
            item.destructive === true
              ? "text-status-error hover:bg-status-error/10"
              : "text-text-primary hover:bg-surface-overlay dark:text-text-primary-dark dark:hover:bg-surface-dark-overlay",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <item.icon
            className={[
              "h-3.5 w-3.5 shrink-0",
              item.destructive === true
                ? ""
                : "text-text-muted dark:text-text-muted-dark",
            ]
              .filter(Boolean)
              .join(" ")}
          />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.shortcut !== undefined && (
            <Kbd className="shrink-0 pl-3">{item.shortcut}</Kbd>
          )}
        </button>
      ))}
    </div>,
    document.body,
  );
}
