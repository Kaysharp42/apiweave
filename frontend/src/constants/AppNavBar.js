export const AppNavBarItems = {
  workflows: {
    displayValue: 'Workflows',
    value: 'workflows',
    active: true, // default active state
    disable: false,
  },
  collections: {
    displayValue: 'Collections',
    value: 'collections',
    active: false,
    disable: false,
  },
  settings: {
    displayValue: 'Settings',
    value: 'settings',
    active: false,
    disable: false,
  },
};

export const AppNavBarStyles = {
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
};