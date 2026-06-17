import type { AppNavBarItemConfig } from '../types/AppNavBarItemConfig';
import type { AppNavBarWidthConfig } from '../types/AppNavBarWidthConfig';

export const AppNavBarItems: Record<string, AppNavBarItemConfig> = {
  workflows: {
    displayValue: 'Workflows',
    value: 'workflows',
    active: true,
    disable: false,
  },
  projects: {
    displayValue: 'Projects',
    value: 'projects',
    active: false,
    disable: false,
  },
  settings: {
    displayValue: 'Settings',
    value: 'settings',
    active: false,
    disable: false,
  },
} as const;

export const AppNavBarStyles: Record<string, AppNavBarWidthConfig> = {
  collapsedNavBarWidth: {
    absolute: 56,
    pixelInString: '56px',
    tailwindValue: {
      default: 'w-nav-collapsed',
      min: 'min-w-nav-collapsed',
    },
  },
  expandedNavBarWidth: {
    absolute: 180,
    pixelInString: '180px',
    tailwindValue: {
      default: 'w-nav-expanded',
      min: 'min-w-nav-expanded',
    },
  },
} as const;
