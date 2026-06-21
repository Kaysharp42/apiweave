import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronsDownUp,
  Copy,
  Files,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";
import {
  buildNodeActionMenuItems,
  getNextNodeActionMenuFocusIndex,
  getNextNodeExpandedState,
} from "../../../utils/nodeActionMenu";
import type { NodeActionMenuProps } from "../../../types/NodeActionMenuProps";

const ACTION_ICONS: Record<string, LucideIcon> = {
  duplicate: Files,
  copy: Copy,
  "toggle-expand": ChevronsDownUp,
};

export function NodeActionMenu({
  nodeId,
  collapsible = false,
  isExpanded = false,
  onDuplicate,
  onCopy,
  onToggleExpand,
  triggerClassName = "",
}: NodeActionMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const menuItems = useMemo(
    () => buildNodeActionMenuItems({ collapsible, isExpanded }),
    [collapsible, isExpanded],
  );

  useEffect(() => {
    if (!menuOpen) return undefined;

    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener(
      "touchstart",
      handleOutsideClick as EventListener,
      { passive: true },
    );
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener(
        "touchstart",
        handleOutsideClick as EventListener,
      );
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  if (!nodeId) return null;

  const focusMenuItem = (index: number) => {
    const safeIndex = Math.max(0, Math.min(index, menuItems.length - 1));
    itemRefs.current[safeIndex]?.focus();
  };

  const openMenuAndFocusFirst = () => {
    setMenuOpen(true);
    requestAnimationFrame(() => focusMenuItem(0));
  };

  const handleMenuAction = (
    actionKey: string,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    event.stopPropagation();

    if (actionKey === "duplicate") {
      onDuplicate?.(nodeId);
    } else if (actionKey === "copy") {
      onCopy?.(nodeId);
    } else if (actionKey === "toggle-expand") {
      onToggleExpand?.(getNextNodeExpandedState(isExpanded));
    }

    setMenuOpen(false);
    triggerRef.current?.focus();
  };

  const handleTriggerKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (
      event.key === "ArrowDown" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      openMenuAndFocusFirst();
    }
  };

  const handleMenuItemKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const nextIndex = getNextNodeActionMenuFocusIndex({
        currentIndex: index,
        total: menuItems.length,
        key: event.key,
      });
      focusMenuItem(nextIndex);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setMenuOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div className="relative nodrag" ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen((currentState) => !currentState);
        }}
        onKeyDown={handleTriggerKeyDown}
        className={[
          "p-1 rounded-sm text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors motion-reduce:transition-none cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]",
          triggerClassName,
        ]
          .filter(Boolean)
          .join(" ")}
        title="Node actions"
        aria-label="Node actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {menuOpen && (
        <div
          className="absolute right-0 mt-1 min-w-[144px] overflow-hidden rounded-sm border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised shadow-node z-50 nodrag py-1"
          role="menu"
        >
          {menuItems.map((item, index) => {
            const Icon = ACTION_ICONS[item.key] || MoreHorizontal;

            return (
              <button
                key={item.key}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                onClick={(event) => handleMenuAction(item.key, event)}
                onKeyDown={(event) => handleMenuItemKeyDown(event, index)}
                className={[
                  "w-full text-left px-3 py-1.5 text-xs font-medium text-text-primary dark:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] flex items-center gap-2 cursor-pointer transition-colors motion-reduce:transition-none",
                  index > 0
                    ? "border-t border-border dark:border-border-dark"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                role="menuitem"
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
