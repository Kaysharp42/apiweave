import React, { useRef, useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import useTabStore from '../../stores/TabStore';

/**
 * TabBar — workspace tab strip for switching between open workflows.
 *
 * Features:
 * - Active tab highlight with primary accent
 * - Dirty (unsaved) indicator (•)
 * - Close button per tab (×)
 * - Middle-click to close
 * - Right-click context menu: Close, Close Others, Close All
 * - Horizontal scroll overflow with chevron buttons
 */
export default function TabBar() {
  const { tabs, activeTabId, setActive, closeTab, closeOthers, closeAll } = useTabStore();
  const scrollRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, tabId }

  // ---------- scroll overflow detection ----------
  const checkOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    checkOverflow();
    const el = scrollRef.current;
    if (el) {
      el.addEventListener('scroll', checkOverflow, { passive: true });
      const ro = new ResizeObserver(checkOverflow);
      ro.observe(el);
      return () => {
        el.removeEventListener('scroll', checkOverflow);
        ro.disconnect();
      };
    }
  }, [checkOverflow, tabs.length]);

  const scroll = (dir) => {
    scrollRef.current?.scrollBy({ left: dir * 160, behavior: 'smooth' });
  };

  // ---------- context menu ----------
  const handleContextMenu = (e, tabId) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // ---------- middle-click close ----------
  const handleMouseDown = (e, tabId) => {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(tabId);
    }
  };

  if (tabs.length === 0) return null;

  return (
    <div className="relative flex items-stretch bg-surface-raised dark:bg-surface-dark-raised border-b border-border dark:border-border-dark select-none min-h-[36px]">
      {/* Left scroll chevron */}
      {canScrollLeft && (
        <button
          onClick={() => scroll(-1)}
          className="sticky left-0 z-10 flex items-center px-1 bg-surface-raised dark:bg-surface-dark-raised border-r border-border dark:border-border-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors"
          aria-label="Scroll tabs left"
        >
          <ChevronLeft className="w-4 h-4 text-text-secondary dark:text-text-secondary-dark" />
        </button>
      )}

      {/* Scrollable tab strip */}
      <div
        ref={scrollRef}
        className="flex-1 flex items-stretch overflow-x-auto scrollbar-none"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              onMouseDown={(e) => handleMouseDown(e, tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              className={[
                'group relative flex items-center gap-1.5 px-3 h-full text-sm whitespace-nowrap transition-colors',
                'border-r border-border dark:border-border-dark',
                isActive
                  ? 'bg-surface dark:bg-surface-dark text-primary dark:text-[#22d3ee] font-medium'
                  : 'text-text-secondary dark:text-text-secondary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay',
              ]
                .filter(Boolean)
                .join(' ')}
              title={tab.name}
            >
              {/* Active indicator — bottom accent bar */}
              {isActive && (
                <span className="absolute bottom-0 inset-x-0 h-0.5 bg-primary dark:bg-[#22d3ee]" />
              )}

              {/* Tab name + dirty dot */}
              <span className="max-w-[160px] truncate">
                {tab.isDirty && (
                  <span className="text-status-warning mr-0.5" aria-label="Unsaved changes">•</span>
                )}
                {tab.name}
              </span>

              {/* Close button — visible on hover or when active */}
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className={[
                  'ml-1 p-0.5 rounded transition-colors',
                  isActive || 'opacity-0 group-hover:opacity-100',
                  'hover:bg-status-error/20 hover:text-status-error',
                ].join(' ')}
                aria-label={`Close ${tab.name}`}
              >
                <X className="w-3 h-3" />
              </span>
            </button>
          );
        })}
      </div>

      {/* Right scroll chevron */}
      {canScrollRight && (
        <button
          onClick={() => scroll(1)}
          className="sticky right-0 z-10 flex items-center px-1 bg-surface-raised dark:bg-surface-dark-raised border-l border-border dark:border-border-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors"
          aria-label="Scroll tabs right"
        >
          <ChevronRight className="w-4 h-4 text-text-secondary dark:text-text-secondary-dark" />
        </button>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-lg border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised shadow-lg py-1 text-sm"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-text-primary dark:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors"
            onClick={() => { closeTab(contextMenu.tabId); setContextMenu(null); }}
          >
            Close
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-text-primary dark:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors"
            onClick={() => { closeOthers(contextMenu.tabId); setContextMenu(null); }}
          >
            Close Others
          </button>
          <div className="my-1 border-t border-border dark:border-border-dark" />
          <button
            className="w-full px-3 py-1.5 text-left hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors text-status-error"
            onClick={() => { closeAll(); setContextMenu(null); }}
          >
            Close All
          </button>
        </div>
      )}
    </div>
  );
}
