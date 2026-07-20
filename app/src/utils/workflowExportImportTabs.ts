type ExportImportTab = "export" | "import";

const VALID_TABS = new Set<ExportImportTab>(["export", "import"]);

export const normalizeExportImportTab = (
  value: unknown,
): ExportImportTab | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase() as ExportImportTab;
  return VALID_TABS.has(normalized) ? normalized : null;
};

export const resolveWorkflowExportImportInitialTab = ({
  initialTab,
  mode,
}: { initialTab?: unknown; mode?: unknown } = {}): ExportImportTab => {
  const explicitTab = normalizeExportImportTab(initialTab);
  if (explicitTab) return explicitTab;

  const legacyModeTab = normalizeExportImportTab(mode);
  if (legacyModeTab) return legacyModeTab;

  return "export";
};
