import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCloseOnOutsideOrEscape } from "../../hooks/useCloseOnOutsideOrEscape";
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

  // Focus the first item so the next keypress is an arrow, not a Tab hunt.
  useEffect(() => {
    const frame = requestAnimationFrame(() => itemRefs.current[0]?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

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
      itemRefs.current[Math.max(0, Math.min(next, items.length - 1))]?.focus();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return createPortal(
    <div
      ref={containerRef}
      role="menu"
      aria-label={label}
      className="fixed z-50 min-w-[200px] max-w-[320px] overflow-hidden rounded-sm border border-border bg-surface-raised py-1 shadow-node dark:border-border-dark dark:bg-surface-dark-raised"
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
          onClick={() => {
            item.onSelect();
            onClose();
          }}
          onKeyDown={(event) => handleItemKeyDown(event, index)}
          className={[
            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors duration-150 motion-reduce:transition-none",
            "cursor-pointer focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-[-2px] dark:focus-visible:outline-primary-light",
            item.separated === true
              ? "mt-1 border-t border-border pt-2 dark:border-border-dark"
              : "",
            item.destructive === true
              ? "text-status-error hover:bg-status-error/10 dark:text-status-error-dark dark:hover:bg-status-error-dark/10"
              : "text-text-primary hover:bg-surface-overlay dark:text-text-primary-dark dark:hover:bg-surface-dark-overlay",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <item.icon
            className={[
              "h-3.5 w-3.5 flex-shrink-0",
              item.destructive === true
                ? ""
                : "text-text-muted dark:text-text-muted-dark",
            ]
              .filter(Boolean)
              .join(" ")}
          />
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
