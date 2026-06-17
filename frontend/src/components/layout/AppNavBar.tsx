import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Settings, Webhook, LayoutGrid, ChevronLeft, ChevronRight, Server } from 'lucide-react';
import { Transition } from '@headlessui/react';
import Tippy from '@tippyjs/react';
// @ts-expect-error CSS import without types
import 'tippy.js/dist/tippy.css';
import { IconButton } from '../atoms/IconButton';
import useNavigationStore from '../../stores/NavigationStore';
import { AppNavBarItems } from '../../constants/AppNavBar';
import type { NavSection } from '../../types/NavSection';

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
    id: 'webhooks',
    label: 'Webhooks',
    icon: Webhook,
  },
  {
    id: 'mcp',
    label: 'MCP',
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
  const navigationSelectedValue = useNavigationStore((state) => state.selectedNavVal);
  const updateNavigationSelectedValue = useNavigationStore((state) => state.setNavState);
  const isNavBarCollapsed = useNavigationStore((state) => state.collapseNavBar);
  const toggleNavBarCollapse = useNavigationStore((state) => state.toggleNavBarCollapse);

  const isOnSettingsRoute = location.pathname.startsWith('/settings/');

  return (
    <nav
      className={[
        'relative flex h-full flex-col transition-all duration-300 ease-in-out',
        'bg-surface-raised dark:bg-surface-dark-raised',
        'border-r border-border dark:border-border-dark',
        'w-14 lg:w-auto',
        isNavBarCollapsed ? 'lg:w-nav-collapsed lg:min-w-nav-collapsed' : 'lg:w-nav-expanded',
      ].join(' ')}
      aria-label="Main navigation"
    >
      <div className="flex-1 pt-1">
        {navItems.map(({ id, label, icon: Icon, disabled }) => {
          const isSelected = navigationSelectedValue === id;

          const content = (
            <button
              type="button"
              key={id}
              className={[
                'relative w-full focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-0 focus-visible:z-10',
              ].join(' ')}
              onClick={() => {
                if (disabled) return;
                updateNavigationSelectedValue(id as NavSection);
                if (id === 'settings') {
                  if (!isOnSettingsRoute) navigate('/settings/users');
                } else if (isOnSettingsRoute) {
                  navigate('/');
                }
              }}
              disabled={disabled}
              aria-current={isSelected ? 'page' : undefined}
              aria-label={disabled ? `${label} (coming soon)` : label}
            >
              {isSelected && (
                <span className="absolute left-0 top-0 h-full w-1 bg-[var(--aw-primary)] rounded-r-sm" />
              )}
              <div
                className={[
                  'flex w-full items-center gap-3 px-4 py-3 transition-all duration-200',
                  'justify-center',
                  !isNavBarCollapsed && 'lg:justify-start',
                  isSelected
                    ? 'bg-[var(--aw-primary)]/10 text-[var(--aw-primary)]'
                    : 'text-text-secondary dark:text-text-secondary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:text-text-primary dark:hover:text-text-primary-dark',
                  disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
                ].join(' ')}
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
                  <span className="badge badge-ghost badge-xs ml-auto text-xxs">Soon</span>
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
          tooltip={isNavBarCollapsed ? 'Expand Navigation' : 'Collapse Navigation'}
          size="sm"
          onClick={toggleNavBarCollapse}
          className="w-full rounded-none border-t border-border dark:border-border-dark justify-start focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-0"
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
