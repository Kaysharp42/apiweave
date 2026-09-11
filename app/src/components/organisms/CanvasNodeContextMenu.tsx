import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, Search } from "lucide-react";
import { NodePaletteMethodBadge } from "../../constants/NodePalette";
import { useCloseOnOutsideOrEscape } from "../../hooks/useCloseOnOutsideOrEscape";
import {
  filterNodeSections,
  useNodePaletteSections,
} from "../../hooks/useNodePaletteSections";
import type { CanvasNodeContextMenuProps, NodePaletteItem } from "../../types";

const VIEWPORT_MARGIN = 8;
const MENU_WIDTH = 236;

/** Flip away from the edge the menu would overflow, then clamp into view. */
function fitAxis(
  point: number,
  size: number,
  limit: number,
): { readonly offset: number; readonly flipped: boolean } {
  const flipped = point + size + VIEWPORT_MARGIN > limit;
  return {
    offset: Math.max(
      VIEWPORT_MARGIN,
      Math.min(flipped ? point - size : point, limit - size - VIEWPORT_MARGIN),
    ),
    flipped,
  };
}

/**
 * Cursor-anchored quick-add menu: one dense list, type to filter, arrows to
 * move, Enter to drop the node where the pointer was. Same catalogue as the
 * side palette, none of its chrome.
 */
export function CanvasNodeContextMenu({
  x,
  y,
  workspaceId,
  onSelect,
  onClose,
}: CanvasNodeContextMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState({
    left: x,
    top: y,
    origin: "top left",
    ready: false,
  });

  useCloseOnOutsideOrEscape(true, () => onClose(), containerRef);

  const sections = useNodePaletteSections(workspaceId);
  const visibleSections = useMemo(
    () => filterNodeSections(sections, query),
    [sections, query],
  );
  // One flat ordering so the arrow keys walk across section boundaries.
  const rows = useMemo(
    () => visibleSections.flatMap((section) => section.nodes),
    [visibleSections],
  );

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const horizontal = fitAxis(x, width || MENU_WIDTH, window.innerWidth);
    const vertical = fitAxis(y, height, window.innerHeight);
    setPlacement({
      left: horizontal.offset,
      top: vertical.offset,
      // Grow out of the corner nearest the cursor, so the menu reads as
      // something the right-click spawned rather than a panel that appeared.
      origin: `${vertical.flipped ? "bottom" : "top"} ${
        horizontal.flipped ? "right" : "left"
      }`,
      ready: true,
    });
  }, [x, y]);

  useEffect(() => setActiveIndex(0), [query]);

  useEffect(() => {
    const active = listRef.current?.querySelector('[data-active="true"]');
    // jsdom has no scrollIntoView; the optional call keeps tests off the floor.
    active?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  const choose = (node: NodePaletteItem): void => {
    onSelect(node);
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (rows.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : rows.length - 1;
      setActiveIndex((current) => (current + step) % rows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(rows[activeIndex]!);
    }
  };

  let rowIndex = -1;

  return createPortal(
    <div
      ref={containerRef}
      role="menu"
      aria-label="Add node to canvas"
      onKeyDown={onKeyDown}
      style={{
        left: placement.left,
        top: placement.top,
        width: MENU_WIDTH,
        transformOrigin: placement.origin,
      }}
      className={`fixed z-50 flex max-h-[min(62vh,420px)] flex-col overflow-hidden rounded-lg border border-border bg-surface-raised/95 shadow-overlay backdrop-blur-md transition-[opacity,transform] duration-100 ease-out motion-reduce:transition-none dark:border-border-dark dark:bg-surface-dark-raised/95 ${
        placement.ready ? "scale-100 opacity-100" : "scale-95 opacity-0"
      }`}
    >
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-2 dark:border-border-dark">
        <Search
          className="h-3.5 w-3.5 shrink-0 text-text-muted dark:text-text-muted-dark"
          aria-hidden="true"
        />
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search nodes"
          placeholder="Add node…"
          className="min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none dark:text-text-primary-dark dark:placeholder:text-text-muted-dark"
        />
        <kbd className="rounded border border-border px-1 font-mono text-[9px] leading-4 text-text-muted dark:border-border-dark dark:text-text-muted-dark">
          esc
        </kbd>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        {rows.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-text-muted dark:text-text-muted-dark">
            No nodes match &ldquo;{query}&rdquo;
          </p>
        ) : (
          visibleSections.map((section) => {
            const Icon = section.icon;
            return (
              <section key={section.key}>
                <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-surface-raised/95 px-3 pb-1 pt-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-text-muted backdrop-blur-sm dark:bg-surface-dark-raised/95 dark:text-text-muted-dark">
                  <Icon className="h-3 w-3" aria-hidden="true" />
                  {section.title}
                </div>
                {section.nodes.map((node) => {
                  rowIndex += 1;
                  const index = rowIndex;
                  const isActive = index === activeIndex;
                  return (
                    <button
                      key={node.presetId ?? `${section.key}-${node.label}`}
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      data-active={isActive}
                      onMouseMove={() => setActiveIndex(index)}
                      onClick={() => choose(node)}
                      title={node.description}
                      className={`relative flex w-full items-center gap-2 py-1.5 pl-3 pr-2 text-left text-[13px] transition-colors duration-75 motion-reduce:transition-none ${
                        isActive
                          ? "bg-primary/10 text-text-primary dark:bg-primary-light/10 dark:text-text-primary-dark"
                          : "text-text-secondary dark:text-text-secondary-dark"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`absolute inset-y-0.5 left-0 w-0.5 rounded-r bg-primary transition-opacity motion-reduce:transition-none dark:bg-primary-light ${
                          isActive ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      {node.method ? (
                        <span
                          className={`w-11 shrink-0 rounded-sm border px-1 py-px text-center font-mono text-[9px] font-semibold ${NodePaletteMethodBadge[node.method] ?? "border-primary/30 bg-primary/10 text-primary"}`}
                        >
                          {node.method}
                        </span>
                      ) : (
                        <span className="flex w-11 shrink-0 justify-center text-text-muted dark:text-text-muted-dark">
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {node.label}
                      </span>
                      {isActive && (
                        <CornerDownLeft
                          className="h-3 w-3 shrink-0 text-text-muted dark:text-text-muted-dark"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  );
                })}
              </section>
            );
          })
        )}
      </div>
    </div>,
    document.body,
  );
}
