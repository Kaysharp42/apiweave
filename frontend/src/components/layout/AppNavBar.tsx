import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Home,
  Settings,
  Webhook,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  Server,
} from "lucide-react";
import { Transition } from "@headlessui/react";
import Tippy from "@tippyjs/react";
import { IconButton } from "../atoms/IconButton";
import useNavigationStore from "../../stores/NavigationStore";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { AppNavBarItems } from "../../constants/AppNavBar";
import type { NavSection } from "../../types/NavSection";

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
  {
    id: "webhooks",
    label: "Webhooks",
    icon: Webhook,
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
  const navigationSelectedValue = useNavigationStore(
    (state) => state.selectedNavVal,
  );
  const updateNavigationSelectedValue = useNavigationStore(
    (state) => state.setNavState,
  );
  const isNavBarCollapsed = useNavigationStore((state) => state.collapseNavBar);
  const toggleNavBarCollapse = useNavigationStore(
    (state) => state.toggleNavBarCollapse,
  );
  const { currentOrg, currentWorkspace } = useWorkspace();

  const isOnSettingsRoute =
    location.pathname.includes("/settings/") || location.pathname === "/audit";

  return (
    <nav
      className={[
        "relative flex h-full flex-col transition-all duration-300 ease-in-out motion-reduce:transition-none",
        "bg-surface-raised dark:bg-surface-dark-raised",
        "border-r border-border dark:border-border-dark",
        "w-14 lg:w-auto",
        isNavBarCollapsed
          ? "lg:w-nav-collapsed lg:min-w-nav-collapsed"
          : "lg:w-nav-expanded",
      ].join(" ")}
      aria-label="Main navigation"
    >
      <div className="flex-1 p-1">
        {navItems.map(({ id, label, icon: Icon, disabled }) => {
          const isSelected = navigationSelectedValue === id;

          const content = (
            <button
              type="button"
              key={id}
              className={[
                "relative w-full rounded focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-0 dark:focus-visible:outline-primary-light",
              ].join(" ")}
              onClick={() => {
                if (disabled) return;
                updateNavigationSelectedValue(id as NavSection);
                if (id === "settings") {
                  if (!isOnSettingsRoute) navigate("/settings/users");
                } else if (isOnSettingsRoute) {
                  const orgSlug = currentOrg?.slug ?? "personal";
                  const wsSlug = currentWorkspace?.slug ?? "workflows";
                  navigate(`/${orgSlug}/${wsSlug}/workflows`);
                }
              }}
              disabled={disabled}
              aria-current={isSelected ? "page" : undefined}
              aria-label={disabled ? `${label} (coming soon)` : label}
            >
              {isSelected && (
                <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r-sm bg-primary dark:bg-primary-light" />
              )}
              <div
                className={[
                  "flex w-full items-center gap-3 rounded px-3 py-2.5 transition-colors duration-200 motion-reduce:transition-none",
                  "justify-center",
                  !isNavBarCollapsed && "lg:justify-start",
                  isSelected
                    ? "bg-primary/10 text-primary dark:bg-primary-light/10 dark:text-primary-light"
                    : "text-text-secondary dark:text-text-secondary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:text-text-primary dark:hover:text-text-primary-dark",
                  disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
                ].join(" ")}
              >
                <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                <Transition
                  show={!isNavBarCollapsed}
                  enter="transition-all ease-in-out duration-300 delay-100"
                  enterFrom="opacity-0 -translate-x-2 w-0"
                  enterTo="opacity-100 translate-x-0 w-auto"
                  leave="transition-all ease-in-out duration-200"
                  leaveFrom="opacity-100"
                  leaveTo="opacity-0 -translate-x-2 w-0"
                >
                  <span className="hidden lg:inline text-xs font-medium whitespace-nowrap overflow-hidden">
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
              content={disabled ? `${label} (coming soon)` : label}
              placement="right"
            >
              {content}
            </Tippy>
          ) : (
            <React.Fragment key={id}>{content}</React.Fragment>
          );
        })}
      </div>

      <div className="hidden lg:block">
        <IconButton
          tooltip={
            isNavBarCollapsed ? "Expand Navigation" : "Collapse Navigation"
          }
          size="sm"
          onClick={toggleNavBarCollapse}
          className="w-full justify-start rounded-none border-t border-border dark:border-border-dark focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-0 dark:focus-visible:outline-primary-light"
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
