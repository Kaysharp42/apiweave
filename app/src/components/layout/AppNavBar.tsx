import React from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import {
  Bot,
  Home,
  Settings,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  Server,
} from "lucide-react";
import { Transition } from "@headlessui/react";
import Tippy from "@tippyjs/react";
import { IconButton } from "../atoms/IconButton";
import { useNavigationSelection, useNavBarCollapse } from "../../hooks/useNavigationControls";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { AppNavBarItems } from "../../constants/AppNavBar";
import type { NavSection } from "../../types/NavSection";
import { isSettingsRoute } from "../../utils/isSettingsRoute";
import { useUpdateStatus } from "../../contexts/UpdateStatusContext";

type LucideIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>;

interface NavItemConfig {
  id: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
}

const navItems: NavItemConfig[] = [
  {
    id: AppNavBarItems.workflows!.value,
    label: AppNavBarItems.workflows!.displayValue,
    icon: Home,
  },
  {
    id: AppNavBarItems.projects!.value,
    label: AppNavBarItems.projects!.displayValue,
    icon: LayoutGrid,
  },
  // "Agents", never the name of any one vendor's CLI: this launches whatever the
  // user has installed, under their own credentials, and the roster is where the
  // individual tools are named.
  {
    id: "agents",
    label: "Agents",
    icon: Bot,
  },
  {
    id: "mcp",
    label: "MCP",
    icon: Server,
  },
  {
    id: AppNavBarItems.settings!.value,
    label: AppNavBarItems.settings!.displayValue,
    icon: Settings,
    disabled: false,
  },
];

export function AppNavBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgSlug, workspaceSlug } = useParams<{
    orgSlug?: string;
    workspaceSlug?: string;
  }>();
  const { navigationSelectedValue, setNavState } = useNavigationSelection();
  const { isNavBarCollapsed, toggleNavBarCollapse } = useNavBarCollapse();
  const { currentOrg, currentWorkspace } = useWorkspace();
  const isOnSettingsRoute = isSettingsRoute(location.pathname);
  const resolvedOrgSlug = currentOrg?.slug ?? orgSlug ?? "personal";
  const resolvedWorkspaceSlug =
    currentWorkspace?.slug ?? workspaceSlug ?? "personal";
  const wsSettingsPath = `/${resolvedOrgSlug}/${resolvedWorkspaceSlug}/settings/environments`;
  const settingsPath = wsSettingsPath;
  // Settings > Updates is the only place the update flow lives, so without a
  // marker here nobody on the platforms that can't self-install would ever
  // learn a release exists.
  const { pending: updatePending } = useUpdateStatus();

  return (
    <nav
      className={[
        "relative flex h-full flex-col transition-all duration-300 ease-in-out motion-reduce:transition-none",
        "bg-surface-raised dark:bg-surface-dark-raised",
        "border-r border-border dark:border-border-dark",
        "w-nav-collapsed md:w-auto",
        isNavBarCollapsed
          ? "md:w-nav-collapsed md:min-w-nav-collapsed"
          : "md:w-nav-expanded",
      ].join(" ")}
      aria-label="Main navigation"
    >
      <div className="flex-1 space-y-0.5 p-1">
        {navItems.map(({ id, label, icon: Icon, disabled }) => {
          const isSelected = navigationSelectedValue === id;
          const showUpdateDot = id === "settings" && updatePending;
          const accessibleLabel = disabled
            ? `${label} (coming soon)`
            : showUpdateDot
              ? `${label} (update available)`
              : label;

          const content = (
            <button
              type="button"
              key={id}
              className={[
                "relative w-full rounded focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-0 dark:focus-visible:outline-primary-light",
              ].join(" ")}
              onClick={() => {
                if (disabled) return;
                // Clicking a nav icon only switches section — it never changes
                // the collapse state. The Collapse/Expand button owns that.
                setNavState(id as NavSection);
                if (id === "settings") {
                  if (!isOnSettingsRoute) navigate(settingsPath);
                } else if (isOnSettingsRoute) {
                  navigate(`/${resolvedOrgSlug}/${resolvedWorkspaceSlug}/workflows`);
                }
              }}
              disabled={disabled}
              aria-current={isSelected ? "page" : undefined}
              aria-label={accessibleLabel}
            >
              {isSelected && (
                <span className="absolute left-0 top-0.5 bottom-0.5 w-0.5 rounded-r-sm bg-primary dark:bg-primary-light" />
              )}
              {showUpdateDot && (
                <span
                  className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary dark:bg-primary-light"
                  aria-hidden="true"
                />
              )}
              <div
                className={[
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 transition-colors duration-200 motion-reduce:transition-none",
                  "justify-center",
                  !isNavBarCollapsed && "md:justify-start",
                  isSelected
                    ? "bg-primary/10 text-primary dark:bg-primary-light/10 dark:text-primary-light"
                    : "text-text-secondary dark:text-text-secondary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:text-text-primary dark:hover:text-text-primary-dark",
                  disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
                ].join(" ")}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <Transition
                  show={!isNavBarCollapsed}
                  enter="transition-all ease-in-out duration-300 delay-100"
                  enterFrom="opacity-0 -translate-x-2 w-0"
                  enterTo="opacity-100 translate-x-0 w-auto"
                  leave="transition-all ease-in-out duration-200"
                  leaveFrom="opacity-100"
                  leaveTo="opacity-0 -translate-x-2 w-0"
                >
                  <span className="hidden md:inline text-xs font-medium whitespace-nowrap overflow-hidden">
                    {label}
                  </span>
                </Transition>
                {disabled && !isNavBarCollapsed && (
                  <span className="ml-auto rounded-full border border-border px-1.5 py-0.5 font-mono text-xxs text-text-muted dark:border-border-dark dark:text-text-muted-dark">
                    Soon
                  </span>
                )}
              </div>
            </button>
          );

          return isNavBarCollapsed ? (
            <Tippy
              key={id}
              content={accessibleLabel}
              placement="right"
            >
              {content}
            </Tippy>
          ) : (
            <React.Fragment key={id}>{content}</React.Fragment>
          );
        })}
      </div>

      <div className="hidden md:block">
        <IconButton
          tooltip={
            isNavBarCollapsed ? "Expand Navigation" : "Collapse Navigation"
          }
          size="xs"
          onClick={toggleNavBarCollapse}
          className={[
            "h-7 w-full rounded-none border-t border-border dark:border-border-dark",
            "focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-0 dark:focus-visible:outline-primary-light",
            isNavBarCollapsed ? "justify-center" : "justify-start px-2",
          ].join(" ")}
        >
          {isNavBarCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <div className="flex items-center gap-2">
              <ChevronLeft className="w-4 h-4" />
              <Transition
                show={!isNavBarCollapsed}
                enter="transition-opacity duration-300 delay-100"
                enterFrom="opacity-0"
                enterTo="opacity-100"
                leave="transition-opacity duration-200"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
              >
                <span className="text-xs">Collapse</span>
              </Transition>
            </div>
          )}
        </IconButton>
      </div>
    </nav>
  );
}
