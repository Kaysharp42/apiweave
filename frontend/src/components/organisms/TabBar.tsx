import { useRef, useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '../atoms/IconButton';
import useTabStore from '../../stores/TabStore';
import type { WorkspaceTab } from '../../types/WorkspaceTab';

interface ContextMenuState {
  x: number;
  y: number;
  tabId: string;
}

export function TabBar() {
  const { tabs, activeTabId, setActive, closeTab, closeOthers, closeAll } = useTabStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const checkOverflowRef = useRef<() => void>(() => {});
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    checkOverflowRef.current = () => {
      const el = scrollRef.current;
      if (!el) return;
      setCanScrollLeft(el.scrollLeft > 0);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };

    checkOverflowRef.current();
    const el = scrollRef.current;
    if (el) {
      const onScroll = () => checkOverflowRef.current();
      el.addEventListener('scroll', onScroll, { passive: true });
      const ro = new ResizeObserver(onScroll);
      ro.observe(el);
      return () => {
        el.removeEventListener('scroll', onScroll);
        ro.disconnect();
      };
    }
  }, [tabs.length]);

  const scroll = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 160, behavior: 'smooth' });
  };

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  const handleMouseDown = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(tabId);
    }
  };

  if (tabs.length === 0) return null;

  return (
    <div className="relative flex items-stretch bg-surface-raised dark:bg-surface-dark-raised border-b border-border dark:border-border-dark select-none min-h-[36px]">
      {canScrollLeft && (
        <IconButton
          tooltip="Scroll tabs left"
          size="xs"
          onClick={() => scroll(-1)}
          className="sticky left-0 z-10 rounded-none border-r border-border dark:border-border-dark"
        >
          <ChevronLeft className="w-4 h-4" />
        </IconButton>
      )}

      <div
        ref={scrollRef}
        className="flex-1 flex items-stretch overflow-x-auto scrollbar-none"
      >
        {tabs.map((tab: WorkspaceTab) => {
          const isActive = tab.id === activeTabId;
          return (
              <div key={tab.id} className="group relative flex items-stretch border-r border-border dark:border-border-dark">
                <button
                  type="button"
                  onClick={() => setActive(tab.id)}
                  onMouseDown={(e) => handleMouseDown(e, tab.id)}
                  onContextMenu={(e) => handleContextMenu(e, tab.id)}
                  className={[
                    'relative flex items-center gap-1.5 px-3 h-full text-sm whitespace-nowrap transition-colors',
                    isActive
                      ? 'bg-surface dark:bg-surface-dark text-primary dark:text-cyan-400 font-medium'
                      : 'text-text-secondary dark:text-text-secondary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  title={tab.name}
                >
                  {isActive && (
                    <span className="absolute bottom-0 inset-x-0 h-0.5 bg-primary dark:bg-cyan-400" />
                  )}

                  <span className="max-w-[160px] truncate">
                    {tab.isDirty && (
                      <span className="text-status-warning mr-0.5" aria-label="Unsaved changes">•</span>
                    )}
                    {tab.name}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className={[
                    'px-1.5 rounded transition-colors self-center',
                    isActive ? '' : 'opacity-0 group-hover:opacity-100',
                    'hover:bg-status-error/20 hover:text-status-error',
                  ].join(' ')}
                  aria-label={`Close ${tab.name}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
      </div>

      {canScrollRight && (
        <IconButton
          tooltip="Scroll tabs right"
          size="xs"
          onClick={() => scroll(1)}
          className="sticky right-0 z-10 rounded-none border-l border-border dark:border-border-dark"
        >
          <ChevronRight className="w-4 h-4" />
        </IconButton>
      )}

      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-lg border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised shadow-lg py-1 text-sm"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            type="button"
            className="w-full px-3 py-1.5 text-left text-text-primary dark:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors"
            onClick={() => { closeTab(contextMenu.tabId); setContextMenu(null); }}
          >
            Close
          </button>
          <button
            type="button"
            className="w-full px-3 py-1.5 text-left text-text-primary dark:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors"
            onClick={() => { closeOthers(contextMenu.tabId); setContextMenu(null); }}
          >
            Close Others
          </button>
          <div className="my-1 border-t border-border dark:border-border-dark" />
          <button
            type="button"
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
