export const getNodeOutputStatusClass = (statusCode) => {
  if (!statusCode) {
    return 'bg-surface-overlay text-text-secondary dark:bg-surface-dark-overlay dark:text-text-secondary-dark';
  }

  if (statusCode >= 200 && statusCode < 300) {
    return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
  }

  if (statusCode >= 300 && statusCode < 400) {
    return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
  }

  return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
};

export const formatNodeOutputDuration = (durationMs) => {
  if (durationMs === undefined || durationMs === null || Number.isNaN(Number(durationMs))) {
    return null;
  }

  const safeDuration = Number(durationMs);
  if (safeDuration >= 1000) {
    return `${(safeDuration / 1000).toFixed(2)}s`;
  }

  return `${safeDuration}ms`;
};
