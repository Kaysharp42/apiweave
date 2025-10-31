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
    absolute: 30,
    pixelInString: '30px',
    tailwindValue: {
      default: 'w-8',
      min: 'min-w-8',
    },
  },
  expandedNavBarWidth: {
    absolute: 100,
    pixelInString: '100px',
    tailwindValue: {
      default: 'w-25',
      min: 'min-w-25',
    },
  },
};