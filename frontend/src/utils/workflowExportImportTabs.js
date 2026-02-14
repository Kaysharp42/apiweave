const VALID_TABS = new Set(['export', 'import']);

export const normalizeExportImportTab = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return VALID_TABS.has(normalized) ? normalized : null;
};

export const resolveWorkflowExportImportInitialTab = ({ initialTab, mode } = {}) => {
  const explicitTab = normalizeExportImportTab(initialTab);
  if (explicitTab) return explicitTab;

  const legacyModeTab = normalizeExportImportTab(mode);
  if (legacyModeTab) return legacyModeTab;

  return 'export';
};
