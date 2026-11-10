import { useState, useEffect } from "react";
import {
  Upload,
  FileText,
  AlertCircle,
  CheckCircle,
  Copy,
  Trash2,
} from "lucide-react";
import useCanvasStore from "../stores/CanvasStore";
import { Button } from "./atoms/Button";
import { Select } from "./atoms/Select";
import { TextArea } from "./atoms/TextArea";
import { CheckboxOption } from "./molecules/CheckboxOption";
import { FileDropZone } from "./molecules/FileDropZone";
import { Modal } from "./molecules/Modal";
import { apiweave } from "../utils/apiweaveClient";
import { useScopeContext } from "../hooks/useScopeContext";
import { getLogger } from "../utils/logger";
import type { CurlImportPreview, Workflow } from "../types";

const curlImportLog = getLogger("CurlImport");

interface CurlImportProps {
  onClose: () => void;
  onImportSuccess?: (workflowId: string) => void;
  currentWorkflowId?: string;
}

export function CurlImport({
  onClose,
  onImportSuccess,
  currentWorkflowId,
}: CurlImportProps) {
  const { workspaceId } = useScopeContext();
  const [curlInput, setCurlInput] = useState<string>("");
  const [sanitize, setSanitize] = useState<boolean>(true);
  const [dryRunResult, setDryRunResult] = useState<CurlImportPreview | null>(
    null,
  );
  const [importing, setImporting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(
    currentWorkflowId || "",
  );
  const [loadingWorkflows, setLoadingWorkflows] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiweave.workflows.list(workspaceId || "");
        setWorkflows([...data.items]);
      } catch (err) {
        curlImportLog.error("Error fetching workflows:", err);
      } finally {
        setLoadingWorkflows(false);
      }
    })();
  }, []);

  const handleFileSelect = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result;
        if (typeof content === "string") {
          setCurlInput(content);
        }
        setError(null);
        setDryRunResult(null);
      } catch (err) {
        if (err instanceof Error) {
          setError("Failed to read file: " + err.message);
        }
      }
    };
    reader.readAsText(file);
  };

  const handlePreview = async () => {
    if (!curlInput.trim()) {
      setError("Please enter a cURL command");
      return;
    }

    setError(null);
    setDryRunResult(null);
    setIsLoading(true);

    // fallow-ignore-next-line code-duplication -- the preview handlers of the three import dialogs share their setState preamble and try/finally by design; each calls its own IPC import with its own payload, so there is no shared behaviour to extract.
    try {
      const result = (await apiweave.workflows.importCurl({
        workspaceId: workspaceId || "",
        curlCommand: curlInput,
        sanitize,
        dryRun: true,
      })) as CurlImportPreview;
      setDryRunResult(result);
    } catch (err) {
      curlImportLog.error("Preview error:", err);
      if (err instanceof Error) {
        setError(err.message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    if (!curlInput.trim()) {
      setError("Please enter a cURL command");
      return;
    }

    setError(null);
    setImporting(true);

    try {
      const data = (await apiweave.workflows.importCurl({
        workspaceId: workspaceId || "",
        curlCommand: curlInput,
        sanitize,
        ...(selectedWorkflowId ? { workflowId: selectedWorkflowId } : {}),
      })) as { readonly workflowId: string };

      if (selectedWorkflowId) {
        useCanvasStore.getState().signalWorkflowReload(data.workflowId);
      }

      if (onImportSuccess) {
        onImportSuccess(data.workflowId);
      }
      onClose();
    } catch (err) {
      curlImportLog.error("Import error:", err);
      if (err instanceof Error) {
        setError(err.message);
      }
    } finally {
      setImporting(false);
    }
  };

  const handleClear = () => {
    setCurlInput("");
    setDryRunResult(null);
    setError(null);
  };

  const handlePasteSample = () => {
    const sample = `curl -X GET "https://api.example.com/users/123" \\
  -H "Authorization: Bearer token123" \\
  -H "Content-Type: application/json"`;
    setCurlInput(sample);
    setError(null);
    setDryRunResult(null);
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Import cURL commands"
      size="lg"
      footer={
        <>
          <Button
            onClick={handlePreview}
            disabled={!curlInput || isLoading}
            variant="outline"
            loading={isLoading}
            icon={!isLoading ? <FileText className="w-4 h-4" /> : undefined}
          >
            Preview
          </Button>
          <Button
            onClick={handleImport}
            disabled={importing || !curlInput}
            variant="primary"
            loading={importing}
            icon={!importing ? <Upload className="w-4 h-4" /> : undefined}
          >
            Import as workflow
          </Button>
          <Button onClick={onClose} variant="ghost">
            Close
          </Button>
        </>
      }
    >
      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Info */}
        <div>
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            Import cURL commands to automatically create API test workflows.
            Supports single or multiple commands (one per line or separated by
            &&).
          </p>
        </div>

        {/* File Upload Area */}
        <FileDropZone
          title="Drag & drop a text file with cURL commands, or click to browse"
          hint="Supports: .txt, .sh, .curl"
          accept=".txt,.sh,.curl"
          inputAriaLabel="cURL command file upload"
          onFileSelect={handleFileSelect}
        />

        {/* Text Input Area */}
        <div>
          <label
            htmlFor="curl-paste-area"
            className="block text-sm font-medium text-text-primary dark:text-text-primary-dark mb-2"
          >
            Or paste cURL commands here:
          </label>
          <TextArea
            id="curl-paste-area"
            value={curlInput}
            onChange={(e) => setCurlInput(e.target.value)}
            placeholder={`curl -X GET "https://api.example.com/users" \\
  -H "Authorization: Bearer token123" \\
  -H "Content-Type: application/json"

curl -X POST "https://api.example.com/users" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"John","email":"john@example.com"}'`}
            className="w-full h-40 font-mono text-sm"
          />
          <div className="mt-2 flex gap-2">
            <Button
              onClick={handleClear}
              disabled={!curlInput}
              variant="outline"
              size="sm"
              icon={<Trash2 className="w-4 h-4" />}
            >
              Clear
            </Button>
            <Button
              onClick={handlePasteSample}
              variant="outline"
              size="sm"
              icon={<Copy className="w-4 h-4" />}
            >
              Paste sample
            </Button>
          </div>
        </div>

        {/* Options */}
        {curlInput && (
          <div className="space-y-3 p-3 bg-surface dark:bg-surface-dark rounded-sm border border-border dark:border-border-dark">
            {/* Workflow Selection */}
            <div>
              <label
                htmlFor="curl-destination-workflow"
                className="block text-sm font-medium text-text-primary dark:text-text-primary-dark mb-2"
              >
                Destination workflow
              </label>
              <Select
                id="curl-destination-workflow"
                value={selectedWorkflowId}
                onChange={(e) => setSelectedWorkflowId(e.target.value)}
                disabled={loadingWorkflows}
              >
                <option value="">
                  {loadingWorkflows
                    ? "Loading workflows…"
                    : "+ Create new workflow"}
                </option>
                {workflows.map((wf) => (
                  <option key={wf.workflowId} value={wf.workflowId}>
                    {wf.name} ({wf.nodes?.length || 0} nodes)
                  </option>
                ))}
              </Select>
              <p className="text-xs text-text-secondary dark:text-text-secondary-dark mt-1 flex items-center gap-1">
                {selectedWorkflowId ? (
                  <>
                    <CheckCircle className="w-4 h-4 text-status-success" />
                    <span>Will append to selected workflow</span>
                  </>
                ) : (
                  <>
                    <span>○ Will create a new workflow</span>
                  </>
                )}
              </p>
            </div>

            {/* Sanitize Option */}
            <CheckboxOption
              label="Sanitize sensitive headers (API keys, tokens, etc.)"
              checked={sanitize}
              onChange={setSanitize}
            />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-(--aw-status-error)/5 dark:bg-(--aw-status-error)/10 border border-(--aw-status-error)/20 dark:border-(--aw-status-error)/30 rounded-sm p-4">
            <div className="flex items-start">
              <AlertCircle className="w-5 h-5 text-status-error mr-2 shrink-0 mt-0.5" />
              <p className="text-sm text-status-error">
                {error}
              </p>
            </div>
          </div>
        )}

        {/* Dry Run Result */}
        {dryRunResult && (
          <div className="bg-(--aw-status-info)/5 dark:bg-(--aw-status-info)/10 border border-(--aw-status-info)/20 dark:border-(--aw-status-info)/30 rounded-sm p-4">
            <div className="flex items-start">
              <CheckCircle className="w-5 h-5 text-(--aw-status-info) dark:text-(--aw-status-info) mr-2 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-text-primary dark:text-text-primary-dark mb-2">
                  Preview: {dryRunResult.stats.totalRequests} request(s)
                </h3>
                <div className="text-sm text-(--aw-status-info) dark:text-(--aw-status-info) space-y-1">
                  <p>
                    <strong>Workflow:</strong> {dryRunResult.workflow.name}
                  </p>
                  <p>
                    <strong>Nodes:</strong> {dryRunResult.workflow.nodeCount}
                  </p>
                  <p>
                    <strong>Edges:</strong> {dryRunResult.workflow.edgeCount}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default CurlImport;
