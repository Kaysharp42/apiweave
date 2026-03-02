export const buildNodeActionMenuItems = ({ collapsible = false, isExpanded = false } = {}) => {
  const items = [
    { key: 'duplicate', label: 'Duplicate' },
    { key: 'copy', label: 'Copy' },
  ];

  if (collapsible) {
    items.push({
      key: 'toggle-expand',
      label: isExpanded ? 'Collapse' : 'Expand',
    });
  }

  return items;
};

export const getNextNodeExpandedState = (currentState) => !Boolean(currentState);

export const getNextNodeActionMenuFocusIndex = ({ currentIndex = 0, total = 0, key } = {}) => {
  if (!Number.isInteger(total) || total <= 0) return 0;

  if (key === 'ArrowDown') {
    return (currentIndex + 1) % total;
  }

  if (key === 'ArrowUp') {
    return (currentIndex - 1 + total) % total;
  }

  if (key === 'Home') {
    return 0;
  }

  if (key === 'End') {
    return total - 1;
  }

  return currentIndex;
};
