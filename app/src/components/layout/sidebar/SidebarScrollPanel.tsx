import type { SidebarScrollPanelProps } from "../../../types";

/**
 * One sidebar list panel's scroll region.
 *
 * Every panel owns a stable scrollbar gutter and the fade while a refresh is
 * under way, and every panel is hidden rather than unmounted when another nav
 * tab owns the sidebar — so a list keeps its scroll position across tab
 * switches.
 */
export function SidebarScrollPanel({
  hidden,
  isRefreshing,
  className = "",
  children,
}: SidebarScrollPanelProps) {
  return (
    <div
      className={[
        "h-full overflow-y-auto overflow-x-hidden transition-opacity duration-300",
        className,
        isRefreshing ? "opacity-50" : "opacity-100",
        hidden ? "hidden" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ scrollbarGutter: "stable" }}
    >
      {children}
    </div>
  );
}
