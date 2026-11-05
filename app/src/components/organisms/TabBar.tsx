import { useRef, useState, useEffect } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleX,
  ChevronsRight,
  SquareX,
} from "lucide-react";
import { IconButton } from "../atoms/IconButton";
import { ContextMenu } from "../molecules/ContextMenu";
import useTabStore from "../../stores/TabStore";
import { confirmCloseTabs } from "../../stores/PendingEditsStore";
import { useWorkspaceTabs } from "../../hooks/useWorkspaceTabs";
import { shortcutLabel } from "../../constants/keyboardShortcuts";
import type { WorkspaceTab } from "../../types/WorkspaceTab";
import type { ContextMenuItem } from "../../types/ContextMenuItem";
import type { ContextMenuState } from "../../types/ContextMenuState";
import { handleTablistKeyDown } from "../../utils/tablistKeyboard";

/** The canvas area the workspace tabs control (rendered by `Workspace`). */
export const WORKSPACE_TABPANEL_ID = "workspace-tabpanel";
export const workspaceTabId = (tabId: string): string =>
  `workspace-tab-${tabId}`;

export function TabBar() {
  // Only this workspace's tabs: the store also holds the ones left open in the
  // workspaces the user switched away from.
  const { workspaceId, tabs, activeTabId } = useWorkspaceTabs();
  const { setActive, closeTab, closeOthers, closeToRight, closeAll } =
    useTabStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const checkOverflowRef = useRef<() => void>(() => {});
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Keep the active tab in view. Selecting a tab with the keyboard can move the
  // selection to one partially or wholly past the scroll edge, and a tab you
  // cannot see is not a tab you can confirm you selected.
  useEffect(() => {
    if (activeTabId === null) return;
    const active = document.getElementById(workspaceTabId(activeTabId));
    // jsdom does not implement scrollIntoView; the guard keeps the tab logic
    // testable without stubbing a browser API this component does not own.
    active?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeTabId, tabs.length]);

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
      el.addEventListener("scroll", onScroll, { passive: true });
      const ro = new ResizeObserver(onScroll);
      ro.observe(el);
      return () => {
        el.removeEventListener("scroll", onScroll);
        ro.disconnect();
      };
    }
  }, [tabs.length]);

  const scroll = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 160, behavior: "smooth" });
  };

  // Every close goes through the unsaved-changes guard; only the canvas being
  // closed is ever asked about, and Cancel leaves every tab open.
  const requestClose = (ids: readonly string[], close: () => void) => {
    void confirmCloseTabs(ids).then((ok) => {
      if (ok) close();
    });
  };

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  // A keyboard-opened menu is anchored to the tab's bottom-left corner rather
  // than to a pointer that does not exist. The shared menu keeps itself inside
  // the viewport from there.
  const openTabMenuFromKeyboard = (
    element: HTMLButtonElement,
    tabId: string,
  ) => {
    const rect = element.getBoundingClientRect();
    setContextMenu({ x: rect.left, y: rect.bottom, tabId });
  };

  const closeContextMenu = () => {
    const tabId = contextMenu?.tabId;
    setContextMenu(null);
    if (tabId === undefined) return;
    // Escape or choosing an item destroys the focused row. Put focus back on the
    // tab the menu belonged to, unless closing it removed the tab.
    requestAnimationFrame(() => {
      document.getElementById(workspaceTabId(tabId))?.focus();
    });
  };

  const handleMouseDown = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) {
      e.preventDefault();
      requestClose([tabId], () => closeTab(tabId));
    }
  };

  const handleTabKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    tabId: string,
  ) => {
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      openTabMenuFromKeyboard(e.currentTarget, tabId);
      return;
    }
    if (e.key !== "Delete") return;
    requestClose([tabId], () => closeTab(tabId));
  };

  const contextMenuItems: readonly ContextMenuItem[] = (() => {
    if (contextMenu === null) return [];
    const { tabId } = contextMenu;
    const index = tabs.findIndex((tab) => tab.id === tabId);
    const toTheRight =
      index === -1 ? [] : tabs.slice(index + 1).map((tab) => tab.id);
    const others = tabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id);

    return [
      {
        key: "close",
        icon: X,
        label: "Close",
        shortcut: shortcutLabel("closeTab"),
        onSelect: () => requestClose([tabId], () => closeTab(tabId)),
      },
      {
        key: "close-others",
        icon: CircleX,
        label: "Close Others",
        disabled: others.length === 0,
        onSelect: () => requestClose(others, () => closeOthers(tabId)),
      },
      {
        key: "close-right",
        icon: ChevronsRight,
        label: "Close to the Right",
        disabled: toTheRight.length === 0,
        onSelect: () => requestClose(toTheRight, () => closeToRight(tabId)),
      },
      {
        key: "close-all",
        icon: SquareX,
        label: "Close All",
        separated: true,
        onSelect: () => {
          // Scoped: "Close All" closes this workspace's tabs, and leaves the
          // ones waiting in the other workspaces alone.
          if (workspaceId !== null) {
            requestClose(
              tabs.map((tab) => tab.id),
              () => closeAll(workspaceId),
            );
          }
        },
      },
    ];
  })();

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
        role="tablist"
        aria-label="Open workflows"
        onKeyDown={handleTablistKeyDown}
        className="flex-1 flex items-stretch overflow-x-auto scrollbar-none"
      >
        {tabs.map((tab: WorkspaceTab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className="group relative flex min-w-24 max-w-[220px] items-stretch border-r border-border dark:border-border-dark"
            >
              <button
                type="button"
                role="tab"
                id={workspaceTabId(tab.id)}
                aria-selected={isActive}
                aria-controls={WORKSPACE_TABPANEL_ID}
                aria-keyshortcuts="Delete"
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActive(tab.id)}
                onMouseDown={(e) => handleMouseDown(e, tab.id)}
                onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
                onContextMenu={(e) => handleContextMenu(e, tab.id)}
                className={[
                  "relative flex items-center gap-1.5 px-3 h-full text-sm whitespace-nowrap transition-colors min-w-0 flex-1 cursor-pointer",
                  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-2",
                  isActive
                    ? "bg-surface-raised dark:bg-surface-dark-raised text-primary dark:text-primary-light font-medium"
                    : contextMenu?.tabId === tab.id
                      ? "bg-surface-overlay text-text-secondary dark:bg-surface-dark-overlay dark:text-text-secondary-dark"
                      : "text-text-secondary dark:text-text-secondary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay",
                ]
                  .filter(Boolean)
                  .join(" ")}
                title={tab.name}
              >
                {isActive && (
                  <span className="absolute bottom-0 inset-x-0 h-0.5 bg-(--aw-primary)" />
                )}

                {tab.isDirty && (
                  <Circle
                    className="w-2 h-2 fill-current text-(--aw-status-warning) shrink-0"
                    aria-label="Unsaved changes"
                  />
                )}
                <span className="min-w-0 truncate">{tab.name}</span>
              </button>

              {/* Pointer-only: `aria-hidden` keeps it out of the accessibility
                  tree, so a tablist that may own tabs and nothing else stays
                  valid. Keyboard users close the focused tab with Delete,
                  Ctrl+W, or the context menu. */}
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                title={`Close ${tab.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  requestClose([tab.id], () => closeTab(tab.id));
                }}
                className={[
                  "flex h-5 w-5 items-center justify-center self-center mr-1 shrink-0 rounded-sm transition-colors cursor-pointer",
                  "text-text-muted dark:text-text-muted-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:text-primary dark:hover:text-primary-light",
                  isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                ].join(" ")}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* No separate close button outside the tablist: ARIA lets a tablist own
          tabs and nothing else, which is the violation axe reports as
          aria-required-children. Each tab carries its own instead. */}

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
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          label="Tab actions"
          items={contextMenuItems}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
