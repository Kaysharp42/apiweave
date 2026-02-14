const DEFAULT_FALLBACK = 'Untitled';

const normalizeLabel = (value, fallback = DEFAULT_FALLBACK) => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

export const getSidebarItemLabel = (value, maxLength = 42, fallback = DEFAULT_FALLBACK) => {
  const fullLabel = normalizeLabel(value, fallback);
  const safeMax = Math.max(2, Number(maxLength) || 42);

  if (fullLabel.length <= safeMax) {
    return {
      label: fullLabel,
      fullLabel,
      truncated: false,
    };
  }

  return {
    label: `${fullLabel.slice(0, safeMax - 1).trimEnd()}...`,
    fullLabel,
    truncated: true,
  };
};
