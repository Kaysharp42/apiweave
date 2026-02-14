export const shouldClearNodeFilter = ({
  key,
  isModalOpen = false,
  isPaletteClosing = false,
  clearRequested = false,
} = {}) => {
  if (clearRequested || isModalOpen || isPaletteClosing) {
    return true;
  }

  return key === 'Escape';
};

export const getNextNodeFilterValue = ({
  currentValue = '',
  key,
  isModalOpen = false,
  isPaletteClosing = false,
  clearRequested = false,
} = {}) => {
  if (
    shouldClearNodeFilter({
      key,
      isModalOpen,
      isPaletteClosing,
      clearRequested,
    })
  ) {
    return '';
  }

  return currentValue;
};
