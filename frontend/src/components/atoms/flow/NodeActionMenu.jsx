import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsDownUp, Copy, Files, MoreHorizontal } from 'lucide-react';
import {
  buildNodeActionMenuItems,
  getNextNodeActionMenuFocusIndex,
  getNextNodeExpandedState,
} from '../../../utils/nodeActionMenu';

const ACTION_ICONS = {
  duplicate: Files,
  copy: Copy,
  'toggle-expand': ChevronsDownUp,
};

export default function NodeActionMenu({
  nodeId,
  collapsible = false,
  isExpanded = false,
  onDuplicate,
  onCopy,
  onToggleExpand,
  triggerClassName = '',
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef(null);
  const triggerRef = useRef(null);
  const itemRefs = useRef([]);

  const menuItems = useMemo(
    () => buildNodeActionMenuItems({ collapsible, isExpanded }),
    [collapsible, isExpanded],
  );

  useEffect(() => {
    if (!menuOpen) return undefined;

    const handleOutsideClick = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen]);

  if (!nodeId) return null;

  const focusMenuItem = (index) => {
    const safeIndex = Math.max(0, Math.min(index, menuItems.length - 1));
    itemRefs.current[safeIndex]?.focus();
  };

  const openMenuAndFocusFirst = () => {
    setMenuOpen(true);
    requestAnimationFrame(() => focusMenuItem(0));
  };

  const handleMenuAction = (actionKey, event) => {
    event.stopPropagation();

    if (actionKey === 'duplicate') {
      onDuplicate?.(nodeId);
    } else if (actionKey === 'copy') {
      onCopy?.(nodeId);
    } else if (actionKey === 'toggle-expand') {
      onToggleExpand?.(getNextNodeExpandedState(isExpanded));
    }

    setMenuOpen(false);
    triggerRef.current?.focus();
  };

  const handleTriggerKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openMenuAndFocusFirst();
    }
  };

  const handleMenuItemKeyDown = (event, index) => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const nextIndex = getNextNodeActionMenuFocusIndex({
        currentIndex: index,
        total: menuItems.length,
        key: event.key,
      });
      focusMenuItem(nextIndex);
      return;
    }

    if (event.key === 'Escape') {
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
          'p-1 rounded-md text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors',
          triggerClassName,
        ]
          .filter(Boolean)
          .join(' ')}
        title="Node actions"
        aria-label="Node actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {menuOpen && (
        <div
          className="absolute right-0 mt-1 min-w-[144px] overflow-hidden rounded-xl border border-border dark:border-border-dark bg-surface-raised/95 dark:bg-surface-dark-raised/95 backdrop-blur-sm shadow-xl z-50 nodrag py-1"
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
                  'w-full text-left px-3 py-1.5 text-xs font-medium text-text-primary dark:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay focus:outline-none focus:bg-surface-overlay dark:focus:bg-surface-dark-overlay flex items-center gap-2',
                  index > 0 ? 'border-t border-border dark:border-border-dark' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
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
