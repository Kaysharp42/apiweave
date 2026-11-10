import { useState } from "react";
import { Upload, FileText, AlertCircle } from "lucide-react";
import { usePalette } from "../contexts/PaletteContext";
import { Button } from "./atoms/Button";
import { Modal } from "./molecules/Modal";
import { CheckboxOption } from "./molecules/CheckboxOption";
import { ImportFilePicker } from "./molecules/ImportFilePicker";
import { Input } from "./atoms/Input";
import { useScopeContext } from "../hooks/useScopeContext";
import { apiweave } from "../utils/apiweaveClient";
import { getLogger } from "../utils/logger";

const harImportLog = getLogger("HARImport");

interface HARPreviewEntry {
  method: string;
  url: string;
  headers?: string;
  body?: string;
  time?: number;
}

interface HARImportDryRunStats {
  totalEntries?: number;
  nodes?: number;
  edges?: number;
}

interface HARImportDryRunResult {
  stats: HARImportDryRunStats;
  preview: HARPreviewEntry[];
  items: HARPreviewEntry[];
}

interface HARImportProps {
  onClose: () => void;
  onImportSuccess?: (result: HARImportDryRunResult) => void;
}

function getMethodBadgeClasses(method: string): string {
  switch (method) {
    case "GET":
      return "bg-(--aw-status-info)/10 dark:bg-(--aw-status-info)/20 text-(--aw-status-info) dark:text-(--aw-status-info)";
    case "POST":
      return "bg-(--aw-status-success)/10 dark:bg-(--aw-status-success)/20 text-(--aw-status-success) dark:text-(--aw-status-success)";
    case "PUT":
      return "bg-(--aw-status-warning)/10 dark:bg-(--aw-status-warning)/20 text-(--aw-status-warning) dark:text-(--aw-status-warning)";
    case "DELETE":
      return "bg-(--aw-status-error)/10 dark:bg-(--aw-status-error)/20 text-(--aw-status-error) dark:text-(--aw-status-error)";
    default:
      return "bg-surface dark:bg-surface-dark text-text-primary dark:text-text-primary-dark";
  }
}

export function HARImport({ onClose, onImportSuccess }: HARImportProps) {
  const { workspaceId } = useScopeContext();
  const [harFile, setHarFile] = useState<File | null>(null);
  const [harJson, setHarJson] = useState<Record<string, unknown> | null>(null);
  const [sanitize, setSanitize] = useState(true);
  const [dryRunResult, setDryRunResult] =
    useState<HARImportDryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groupTitle, setGroupTitle] = useState("");
  const { addImportedGroup } = usePalette();

  const handleFileSelect = (file: File) => {
    setHarFile(file);
    setError(null);
    setDryRunResult(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        setHarJson(json);
      } catch (err) {
        setError("Invalid HAR file: " + (err as Error).message);
        setHarJson(null);
      }
    };
    reader.readAsText(file);
  };

  const handlePreview = async () => {
    if (!harJson) {
      setError("Please select a HAR file first");
      return;
    }

    setError(null);
    setDryRunResult(null);

    // fallow-ignore-next-line code-duplication -- the preview handlers of the three import dialogs share their setState preamble and try/catch by design; each calls its own IPC import with its own payload, so there is no shared behaviour to extract.
    try {
      const result = (await apiweave.workflows.importHar({
        workspaceId: workspaceId || "",
        data: harJson,
        sanitize,
        dryRun: true,
      })) as HARImportDryRunResult;
      setDryRunResult(result);
    } catch (err) {
      harImportLog.error("Preview error:", err);
      setError((err as Error).message);
    }
  };

  const handleImport = async () => {
    if (!harFile) {
      setError("Please select a HAR file first");
      return;
    }
    if (!dryRunResult || !Array.isArray(dryRunResult.items)) {
      setError("Please run Preview first");
      return;
    }

    try {
      const items = dryRunResult.items.map((entry) => ({
        label: `[${entry.method}] ${entry.url}`,
        method: entry.method || "GET",
        url: entry.url || "",
        headers: entry.headers || "",
        cookies: "",
        queryParams: "",
        pathVariables: "",
        body: entry.body || "",
        timeout: 30,
      }));

      const itemCount = items.length;
      const finalTitle =
        groupTitle && groupTitle.trim()
          ? `${groupTitle.trim()} (${itemCount})`
          : `@${harFile.name.replace(/\.(har|json)$/i, "")} (${itemCount})`;

      addImportedGroup({
        id: `grp-${Date.now()}`,
        title: finalTitle,
        items,
      });

      onImportSuccess?.(dryRunResult);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Import HAR file" size="lg">
      <div className="p-6">
        <div className="space-y-6">
          {/* Info */}
          <div>
            <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
              Import HTTP Archive (HAR) files to automatically create API test
              workflows from recorded browser sessions or API calls.
            </p>
          </div>

          {/* File Upload */}
          <ImportFilePicker
            title="Drag & drop a HAR file, or click to browse"
            hint="Supports: .har, .json"
            accept=".har,.json"
            inputAriaLabel="HAR file upload"
            file={harFile}
            onFileSelect={handleFileSelect}
          />

          {/* Import Options */}
          {harJson && (
            <div className="space-y-4">
              <CheckboxOption
                label="Sanitize sensitive headers (Authorization, API keys, etc.)"
                checked={sanitize}
                onChange={setSanitize}
              />
            </div>
          )}

          {/* Preview Result */}
          {dryRunResult && (
            <div className="border border-border dark:border-border-dark rounded-sm overflow-hidden">
              <div className="bg-surface dark:bg-surface-dark px-4 py-3 border-b border-border dark:border-border-dark">
                <h3 className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
                  Preview
                </h3>
              </div>
              <div className="p-4 space-y-4">
                {/* Stats */}
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold text-(--aw-status-info) dark:text-(--aw-status-info)">
                      {dryRunResult.stats?.totalEntries || 0}
                    </p>
                    <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
                      Total requests
                    </p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-status-success">
                      {dryRunResult.stats?.nodes || 0}
                    </p>
                    <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
                      Nodes
                    </p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-(--aw-branch-edge) dark:text-(--aw-branch-edge)">
                      {dryRunResult.stats?.edges || 0}
                    </p>
                    <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
                      Edges
                    </p>
                  </div>
                </div>

                {/* Entry Preview */}
                {dryRunResult.preview && dryRunResult.preview.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-text-primary dark:text-text-primary-dark mb-2">
                      First {dryRunResult.preview.length} requests:
                    </p>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {dryRunResult.preview.map((entry) => (
                        <div
                          key={`${entry.method}-${entry.url}-${entry.time ?? ""}`}
                          className="flex items-center gap-3 text-xs bg-surface dark:bg-surface-dark p-2 rounded-sm border border-border dark:border-border-dark"
                        >
                          <span
                            className={`font-medium px-2 py-0.5 rounded-sm ${getMethodBadgeClasses(entry.method)}`}
                          >
                            {entry.method}
                          </span>
                          <span className="flex-1 text-text-secondary dark:text-text-secondary-dark truncate">
                            {entry.url}
                          </span>
                          <span className="text-text-secondary dark:text-text-secondary-dark">
                            {entry.time}ms
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Group Title */}
          {harJson && (
            <div className="mt-2">
              <Input
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                placeholder={harFile?.name || "My HAR group"}
                label="Palette group title (optional)"
                size="sm"
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-(--aw-status-error)/5 dark:bg-(--aw-status-error)/10 border border-(--aw-status-error)/20 dark:border-(--aw-status-error)/30 rounded-sm p-4">
              <div className="flex items-start">
                <AlertCircle className="w-5 h-5 text-status-error mr-2" />
                <p className="text-sm text-(--aw-status-error) dark:text-(--aw-status-error)">
                  {error}
                </p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4 border-t border-border dark:border-border-dark">
            <Button
              onClick={handlePreview}
              disabled={!harJson}
              variant="outline"
              icon={<FileText className="w-4 h-4" />}
              fullWidth
            >
              Preview
            </Button>
            <Button
              onClick={handleImport}
              disabled={!harJson}
              variant="primary"
              icon={<Upload className="w-4 h-4" />}
              fullWidth
            >
              Add to nodes
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default HARImport;
