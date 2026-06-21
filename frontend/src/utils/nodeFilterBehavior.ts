interface NodeFilterParams {
  key?: string | undefined;
  isModalOpen?: boolean;
  isPaletteClosing?: boolean;
  clearRequested?: boolean;
}

export const shouldClearNodeFilter = ({
  key,
  isModalOpen = false,
  isPaletteClosing = false,
  clearRequested = false,
}: NodeFilterParams = {}): boolean => {
  if (clearRequested || isModalOpen || isPaletteClosing) {
    return true;
  }

  return key === "Escape";
};

export const getNextNodeFilterValue = ({
  currentValue = "",
  key,
  isModalOpen = false,
  isPaletteClosing = false,
  clearRequested = false,
}: NodeFilterParams & { currentValue?: string } = {}): string => {
  if (
    shouldClearNodeFilter({
      key,
      isModalOpen,
      isPaletteClosing,
      clearRequested,
    })
  ) {
    return "";
  }

  return currentValue;
};
