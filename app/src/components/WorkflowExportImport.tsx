import { useState, type ChangeEvent } from "react";
import {
  Download,
  Upload,
  FileText,
  AlertCircle,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import {
  normalizeExportImportTab,
  resolveWorkflowExportImportInitialTab,
} from "../utils/workflowExportImportTabs";
import { Button } from "./atoms/Button";
import { Input } from "./atoms/Input";
import { CheckboxOption } from "./molecules/CheckboxOption";
import { Modal } from "./molecules/Modal";
import { PanelTabs } from "./molecules/PanelTabs";
import { PasteJsonField } from "./molecules/PasteJsonField";
import { useScopeContext } from "../hooks/useScopeContext";
import { apiweave, IpcError } from "../utils/apiweaveClient";
import { downloadTextFile } from "../utils/downloadFile";
import { getLogger } from "../utils/logger";
import type { WorkflowExportImportTab } from "../types/WorkflowExportImportTab";
import type { WorkflowExportImportProps } from "../types/WorkflowExportImportProps";
import type { DryRunResult } from "../types/DryRunResult";
import type { ImportResult } from "../types/ImportResult";
import type { TabItem } from "../types/TabItem";

const exportImportLog = getLogger("WorkflowExportImport");
const EXPORT_TAB: TabItem = { key: "export", icon: Download, label: "Export" };
const IMPORT_TAB: TabItem = { key: "import", icon: Upload, label: "Import" };

// ponytail: surfaces zod `details` from the IPC validation error so the user
// sees WHICH field failed, not just "request validation failed".
function formatImportError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const base = error.message.trim() || fallback;
  const details = error instanceof IpcError ? error.details : undefined;
  if (!Array.isArray(details) || details.length === 0) return base;
  const lines: string[] = [];
  for (const issue of details) {
    if (!issue || typeof issue !== "object") continue;
    const msg = String((issue as { readonly message?: unknown }).message ?? "");
    const rawPath = (issue as { readonly path?: unknown }).path;
    if (!Array.isArray(rawPath)) continue;
    
    let pathStr = "";
    for (let i = 0; i < rawPath.length; i++) {
      const part = rawPath[i];
      if (i === 0 && part === "bundle") continue;
      if (typeof part === "number") {
        pathStr += `[${part}]`;
      } else {
        if (pathStr) pathStr += ".";
        pathStr += String(part);
      }
    }
    
    const simpleMsg = msg.replace(/^Invalid input:\s*/i, "");
    
    if (simpleMsg) lines.push(pathStr ? `${pathStr}: ${simpleMsg}` : simpleMsg);
  }
  return lines.length ? `${base} — ${lines.join("; ")}` : base;
}

function WorkflowExportImport({
  workflowId,
  workflowName,
  onClose,
  onImportSuccess,
  initialTab,
  mode,
  workspaceId: workspaceIdFallback,
}: WorkflowExportImportProps) {
  const { workspaceId } = useScopeContext();
  const [resolvedWorkspaceId, setResolvedWorkspaceId] = useState<string | null>(null);
  const effectiveWorkspaceId = workspaceId ?? workspaceIdFallback ?? resolvedWorkspaceId;
  const [activeTab, setActiveTab] = useState<WorkflowExportImportTab>(() =>
    resolveWorkflowExportImportInitialTab({ initialTab, mode }),
  );
  const [includeEnvironment, setIncludeEnvironment] = useState<boolean>(true);
  const [exporting, setExporting] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const [importJson, setImportJson] = useState<string>("");
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createMissingEnvs, setCreateMissingEnvs] = useState<boolean>(true);
  const visibleTab: WorkflowExportImportTab = workflowId ? activeTab : "import";

  const resolveWorkspaceId = async (): Promise<string> => {
    if (effectiveWorkspaceId) return effectiveWorkspaceId;

    const workspaces = await apiweave.workspaces.list();
    const resolvedId =
      workspaces.find((workspace) => workspace.isPersonal)?.workspaceId ??
      workspaces[0]?.workspaceId;
    if (!resolvedId) throw new Error("No workspace is available for import.");
    setResolvedWorkspaceId(resolvedId);
    return resolvedId;
  };

  const handleExport = async (): Promise<void> => {
    if (!workflowId) {
      setError("Select a workflow from the list to export.");
      return;
    }

    setExporting(true);
    setError(null);

    try {
      const targetWorkspaceId = await resolveWorkspaceId();
      const bundle = await apiweave.workflows.export(
        targetWorkspaceId,
        workflowId,
        includeEnvironment,
      );

      downloadTextFile(
        `${workflowName || "workflow"}_${new Date().toISOString().split("T")[0]}.json`,
        JSON.stringify(bundle, null, 2),
        "application/json",
      );
    } catch (err: unknown) {
      exportImportLog.error("Export error:", err);
      setError(
        err instanceof Error ? err.message : "An unknown error occurred",
      );
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) {
      setImportJson("");
      setError(null);
      setDryRunResult(null);

      const reader = new FileReader();
      reader.onload = (event: ProgressEvent<FileReader>) => {
        try {
          const result = event.target?.result;
          if (typeof result === "string") {
            const json = JSON.parse(result);
            setImportJson(JSON.stringify(json, null, 2));
          }
        } catch {
          setError("Invalid JSON file");
        }
      };
      reader.readAsText(file);
    }
  };

  const handleDryRun = async (): Promise<void> => {
    setError(null);
    setDryRunResult(null);

    if (!importJson) {
      setError("Please select a file or paste JSON");
      return;
    }

    try {
      const bundle: unknown = JSON.parse(importJson);
      const targetWorkspaceId = await resolveWorkspaceId();
      setDryRunResult(
        await apiweave.workflows.dryRun(targetWorkspaceId, bundle),
      );
    } catch (err: unknown) {
      exportImportLog.error("Dry run error:", err);
      setError(formatImportError(err, "Dry run failed"));
    }
  };

  const handleImport = async (): Promise<void> => {
    setImporting(true);
    setError(null);
    setImportResult(null);

    if (!importJson) {
      setError("Please select a file or paste JSON");
      setImporting(false);
      return;
    }

    try {
      const bundle: unknown = JSON.parse(importJson);
      const targetWorkspaceId = await resolveWorkspaceId();

      const result = await apiweave.workflows.import({
        workspaceId: targetWorkspaceId,
        bundle,
        createMissingEnvironments: createMissingEnvs,
        sanitize: true,
      });
      setImportResult(result);

      if (onImportSuccess) {
        setTimeout(() => {
          onImportSuccess(result.workflowId);
        }, 1500);
      }
    } catch (err: unknown) {
      exportImportLog.error("Import error:", err);
      setError(formatImportError(err, "Import failed"));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Workflow export / import"
      size="xl"
      scrollable
    >
      {/* Export needs a workflow; without one, Import is the only tab. */}
      <PanelTabs
        tabs={workflowId ? [EXPORT_TAB, IMPORT_TAB] : [IMPORT_TAB]}
        activeTab={visibleTab}
        onTabChange={(key) => {
          const tab = normalizeExportImportTab(key);
          if (tab) setActiveTab(tab);
        }}
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {visibleTab === "export" ? (
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-medium text-text-primary dark:text-text-primary-dark mb-2">
                Export workflow bundle
              </h3>
              <p className="text-sm text-text-secondary dark:text-text-secondary-dark mb-4">
                Download a complete workflow bundle including nodes, edges,
                variables, and optional environment configuration.
              </p>
            </div>

            <div className="bg-surface-overlay dark:bg-surface-dark-overlay border border-border dark:border-border-dark rounded-sm p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-(--aw-primary) shrink-0 mt-0.5" />
                <div className="text-sm text-text-primary dark:text-text-primary-dark">
                  <p className="font-medium mb-1">
                    Secret values are never exported
                  </p>
                  <p>
                    Any detected secrets (API keys, tokens, passwords) will be
                    replaced with{" "}
                    <code className="bg-surface-raised dark:bg-surface-dark-raised border border-border dark:border-border-dark px-1 rounded-sm font-mono">
                      &lt;SECRET&gt;
                    </code>{" "}
                    placeholders. You&apos;ll need to re-enter these values
                    after importing.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <CheckboxOption
                label="Include referenced environment (if any)"
                checked={includeEnvironment}
                onChange={setIncludeEnvironment}
              />
            </div>

            {error && (
              <div className="bg-(--aw-status-error)/5 dark:bg-(--aw-status-error)/10 border border-(--aw-status-error)/20 dark:border-(--aw-status-error)/30 rounded-sm p-4 text-sm text-status-error">
                {error}
              </div>
            )}

            <Button
              onClick={handleExport}
              disabled={exporting}
              loading={exporting}
              fullWidth
              icon={<Download className="w-4 h-4" />}
            >
              Download workflow bundle
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-medium text-text-primary dark:text-text-primary-dark mb-2">
                Import workflow bundle
              </h3>
              <p className="text-sm text-text-secondary dark:text-text-secondary-dark mb-4">
                Upload a workflow bundle JSON file or paste the JSON content
                directly.
              </p>
            </div>

            {/* File upload */}
            <div>
              <label
                htmlFor="workflow-bundle-file"
                className="block text-sm font-medium text-text-primary dark:text-text-primary-dark mb-2"
              >
                Upload file
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="workflow-bundle-file"
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  className="block w-full text-sm text-text-secondary dark:text-text-secondary-dark
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-sm file:border-0
                    file:text-sm file:font-medium
                    file:bg-(--aw-primary)/5 file:text-(--aw-primary)
                    hover:file:bg-(--aw-primary)/10
                    dark:file:bg-(--aw-primary)/10 dark:file:text-(--aw-primary)
                    dark:hover:file:bg-(--aw-primary)/20"
                />
              </div>
            </div>

            {/* Or paste JSON */}
            <PasteJsonField
              id="workflow-bundle-json"
              label="Or paste JSON"
              value={importJson}
              placeholder='{"workflow": {...}, "environments": [...], ...}'
              onChange={(value) => {
                setImportJson(value);
                setError(null);
                setDryRunResult(null);
              }}
            />

            {/* Options */}
            <div className="space-y-3">
              <CheckboxOption
                label="Create missing environments from bundle"
                checked={createMissingEnvs}
                onChange={setCreateMissingEnvs}
              />
            </div>

            {/* Dry run result */}
            {dryRunResult && (
              <div
                className={`border rounded-sm p-4 ${
                  dryRunResult.valid
                    ? "bg-(--aw-status-success)/5 dark:bg-(--aw-status-success)/10 border-(--aw-status-success)/20 dark:border-(--aw-status-success)/30"
                    : "bg-(--aw-status-error)/5 dark:bg-(--aw-status-error)/10 border-(--aw-status-error)/20 dark:border-(--aw-status-error)/30"
                }`}
              >
                <div className="flex items-start gap-2">
                  {dryRunResult.valid ? (
                    <CheckCircle className="w-5 h-5 text-(--aw-status-success) shrink-0" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-(--aw-status-error) shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p
                      className={`font-medium ${
                        dryRunResult.valid
                          ? "text-status-success"
                          : "text-status-error"
                      }`}
                    >
                      {dryRunResult.valid
                        ? "Bundle is valid!"
                        : "Validation failed"}
                    </p>

                    {dryRunResult.stats && (
                      <div className="mt-2 text-sm text-text-primary dark:text-text-primary-dark">
                        <p>Nodes: {dryRunResult.stats.nodes}</p>
                        <p>Edges: {dryRunResult.stats.edges}</p>
                        <p>Variables: {dryRunResult.stats.variables}</p>
                        {dryRunResult.stats.secretReferences > 0 && (
                          <p className="text-(--aw-status-warning) flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <span>
                              {dryRunResult.stats.secretReferences} secret(s)
                              need to be re-entered
                            </span>
                          </p>
                        )}
                      </div>
                    )}

                    {dryRunResult.errors && dryRunResult.errors.length > 0 && (
                      <ul className="mt-2 text-sm text-status-error list-disc list-inside">
                        {dryRunResult.errors.map((err: string) => (
                          <li key={err}>{err}</li>
                        ))}
                      </ul>
                    )}

                    {dryRunResult.warnings &&
                      dryRunResult.warnings.length > 0 && (
                        <ul className="mt-2 text-sm text-(--aw-status-warning) list-disc list-inside">
                          {dryRunResult.warnings.map((warn: string) => (
                            <li key={warn}>{warn}</li>
                          ))}
                        </ul>
                      )}
                  </div>
                </div>
              </div>
            )}

            {/* Import result */}
            {importResult && (
              <div className="bg-(--aw-status-success)/5 dark:bg-(--aw-status-success)/10 border border-(--aw-status-success)/20 dark:border-(--aw-status-success)/30 rounded-sm p-4">
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-(--aw-status-success) shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-status-success">
                      Import successful!
                    </p>
                    <p className="text-sm text-status-success mt-1">
                      Workflow ID: {importResult.workflowId}
                    </p>
                    {importResult.secretReferences &&
                      importResult.secretReferences.length > 0 && (
                        <p className="text-sm text-(--aw-status-warning) mt-2 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>
                            Remember to re-enter{" "}
                            {importResult.secretReferences.length} secret
                            value(s)
                          </span>
                        </p>
                      )}
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-(--aw-status-error)/5 dark:bg-(--aw-status-error)/10 border border-(--aw-status-error)/20 dark:border-(--aw-status-error)/30 rounded-sm p-4 text-sm text-status-error">
                {error}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              <Button
                onClick={handleDryRun}
                disabled={!importJson}
                variant="outline"
                fullWidth
                icon={<FileText className="w-4 h-4" />}
              >
                Validate
              </Button>
              <Button
                onClick={handleImport}
                disabled={
                  importing ||
                  !importJson ||
                  (dryRunResult !== null && !dryRunResult.valid)
                }
                loading={importing}
                variant="primary"
                fullWidth
                icon={<Upload className="w-4 h-4" />}
              >
                Import workflow
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default WorkflowExportImport;
