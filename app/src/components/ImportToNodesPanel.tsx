import {
  useState,
  useRef,
  type ChangeEvent,
  type DragEvent,
  type RefObject,
} from "react";
import { Upload, AlertCircle, CheckCircle, Info, Terminal } from "lucide-react";
import { usePalette } from "../contexts/PaletteContext";
import { Button } from "./atoms/Button";
import { Modal } from "./molecules/Modal";
import { PanelTabs } from "./molecules/PanelTabs";
import type { TabItem } from "../types";
import { TextArea } from "./atoms/TextArea";
import { apiweave } from "../utils/apiweaveClient";
import { useScopeContext } from "../hooks/useScopeContext";
import { getLogger } from "../utils/logger";
import type { JsonValue } from "@shared/types/JsonValue";

const importPanelLog = getLogger("ImportToNodesPanel");

interface MessageState {
  type: "success" | "error";
  title: string;
  text: string;
}

interface NodeConfig {
  url?: string;
  method?: string;
  headers?: string;
  body?: string;
  queryParams?: string;
  pathVariables?: string;
  cookies?: string;
  timeout?: number;
  openapiMeta?: unknown | null;
  responseSchemas?: Record<string, JsonValue>;
}

interface Node {
  label?: string;
  config?: NodeConfig;
}

interface PaletteItem {
  label: string;
  url: string;
  method: string;
  headers: string;
  body: string;
  queryParams: string;
  pathVariables: string;
  cookies: string;
  timeout: number;
  openapiMeta: unknown | null;
  responseSchemas?: Record<string, JsonValue>;
}

interface ImportedGroupPayload {
  title: string;
  id: string;
  items: PaletteItem[];
}

interface ImportToNodesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  workflowId: string;
}

type ActiveTab = "openapi" | "har" | "curl";

const IMPORT_TABS: TabItem[] = [
  { key: "openapi", icon: Upload, label: "OpenAPI" },
  { key: "har", icon: Upload, label: "HAR" },
  { key: "curl", icon: Terminal, label: "Curl" },
];
type ImportMode = "linear" | "grouped";

interface FileUploadDropzoneProps {
  accept: string;
  description: string;
  fileInputRef: RefObject<HTMLInputElement>;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
}

export function FileUploadDropzone({
  accept,
  description,
  fileInputRef,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileInputChange,
}: FileUploadDropzoneProps) {
  const openFilePicker = (): void => {
    fileInputRef.current?.click();
  };

  return (
    <button
      type="button"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="border border-dashed border-border dark:border-border-dark rounded-sm p-6 text-center cursor-pointer hover:border-primary dark:hover:border-primary-light hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors motion-reduce:transition-none"
      onClick={openFilePicker}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={onFileInputChange}
        aria-label={description}
        className="hidden"
      />
      <div>
        <Upload className="w-12 h-12 mx-auto text-text-muted dark:text-text-muted-dark mb-2" />
        <div className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
          Click to upload or drag and drop
        </div>
        <div className="text-xs text-text-muted dark:text-text-muted-dark">
          {description}
        </div>
      </div>
    </button>
  );
}

interface PasteAreaFieldProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}

export function PasteAreaField({
  label,
  placeholder,
  value,
  onChange,
}: PasteAreaFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-primary dark:text-text-primary-dark mb-2">
        {label}
      </label>
      <TextArea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-40 px-4 py-3 font-mono text-sm bg-surface-raised dark:bg-surface-dark-raised rounded-sm"
      />
    </div>
  );
}

interface SanitizeCheckboxProps {
  checked: boolean;
  onChange: (value: boolean) => void;
}

export function SanitizeCheckbox({ checked, onChange }: SanitizeCheckboxProps) {
  return (
    <label className="flex items-center gap-2 text-sm text-text-primary dark:text-text-primary-dark">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4"
      />
      Sanitize secrets
    </label>
  );
}

interface ImportActionButtonProps {
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}

export function ImportActionButton({
  disabled,
  loading,
  onClick,
}: ImportActionButtonProps) {
  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      variant="primary"
      fullWidth
      loading={loading}
    >
      {loading ? "Processing..." : "Add to Nodes"}
    </Button>
  );
}

export function ImportToNodesPanel({
  isOpen,
  onClose,
  workflowId,
}: ImportToNodesPanelProps) {
  const { workspaceId } = useScopeContext();
  const { addImportedGroup } = usePalette();
  const [activeTab, setActiveTab] = useState<ActiveTab>("openapi");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<MessageState | null>(null);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState<string>("");
  const [sanitize, setSanitize] = useState<boolean>(true);
  const [importMode, setImportMode] = useState<ImportMode>("linear");
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileSelect = (file: File): void => {
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      const result = e.target?.result;
      if (typeof result === "string") {
        setUploadedFile(result);
        setPastedText("");
        setMessage(null);
      }
    };
    reader.readAsText(file);
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file) {
        handleFileSelect(file);
      }
    }
  };

  const handleDragOver = (e: DragEvent): void => {
    e.preventDefault();
    e.currentTarget.classList.add(
      "border-[var(--aw-primary)]",
      "bg-[var(--aw-primary)]/5",
    );
  };

  const handleDragLeave = (e: DragEvent): void => {
    e.currentTarget.classList.remove(
      "border-[var(--aw-primary)]",
      "bg-[var(--aw-primary)]/5",
    );
  };

  const handleDrop = (e: DragEvent): void => {
    e.preventDefault();
    e.currentTarget.classList.remove(
      "border-[var(--aw-primary)]",
      "bg-[var(--aw-primary)]/5",
    );
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file) {
        handleFileSelect(file);
      }
    }
  };

  const saveTemplatesToWorkflow = async (
    templates: Node[],
    _sourceType: string,
  ): Promise<void> => {
    try {
      await apiweave.workflows.saveTemplates(
        workspaceId || "",
        workflowId,
        templates,
      );
    } catch (error) {
      importPanelLog.error("Error saving templates to workflow:", error);
      throw error;
    }
  };

  const nodesToPaletteItems = (nodes: Node[]): PaletteItem[] => {
    return nodes.map((node) => ({
      label: node.label || node.config?.url || "Request",
      url: node.config?.url || "",
      method: node.config?.method || "GET",
      headers: node.config?.headers || "",
      body: node.config?.body || "",
      queryParams: node.config?.queryParams || "",
      pathVariables: node.config?.pathVariables || "",
      cookies: node.config?.cookies || "",
      timeout: node.config?.timeout || 30,
      openapiMeta: node.config?.openapiMeta || null,
      ...(node.config?.responseSchemas
        ? { responseSchemas: node.config.responseSchemas }
        : {}),
    }));
  };

  const handleImportOpenAPI = async (): Promise<void> => {
    setIsLoading(true);
    setMessage(null);

    try {
      let fileContent: string;
      if (pastedText) {
        fileContent = pastedText;
      } else if (uploadedFile) {
        fileContent = uploadedFile;
      } else {
        setMessage({
          type: "error",
          title: "Error",
          text: "Please upload or paste an OpenAPI file",
        });
        setIsLoading(false);
        return;
      }

      const result = (await apiweave.workflows.importOpenapi({
        workspaceId: workspaceId || "",
        spec: fileContent,
        sanitize,
      })) as { nodes?: Node[] };

      const nodes = result.nodes || [];

      if (nodes.length > 0) {
        await saveTemplatesToWorkflow(nodes, "openapi");

        const items = nodesToPaletteItems(nodes);
        addImportedGroup({
          title: "OpenAPI Requests",
          id: `openapi-${workflowId}`,
          items: items,
        } as ImportedGroupPayload);

        setMessage({
          type: "success",
          title: "Import Successful",
          text: `${items.length} request(s) saved and added to Add Nodes panel`,
        });

        setTimeout(() => {
          onClose();
          setUploadedFile(null);
          setPastedText("");
        }, 2000);
      } else {
        setMessage({
          type: "error",
          title: "No Requests Found",
          text: "Could not parse any requests from the OpenAPI file",
        });
      }
    } catch (error) {
      setMessage({
        type: "error",
        title: "Error",
        text: error instanceof Error ? error.message : "An error occurred",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportHAR = async (): Promise<void> => {
    setIsLoading(true);
    setMessage(null);

    try {
      let fileContent: string;
      if (pastedText) {
        fileContent = pastedText;
      } else if (uploadedFile) {
        fileContent = uploadedFile;
      } else {
        setMessage({
          type: "error",
          title: "Error",
          text: "Please upload or paste a HAR file",
        });
        setIsLoading(false);
        return;
      }

      const result = (await apiweave.workflows.importHar({
        workspaceId: workspaceId || "",
        data: JSON.parse(fileContent) as Record<string, unknown>,
        importMode,
        sanitize,
      })) as { nodes?: Node[] };

      const nodes = result.nodes || [];

      if (nodes.length > 0) {
        await saveTemplatesToWorkflow(nodes, "har");

        const items = nodesToPaletteItems(nodes);
        addImportedGroup({
          title: "HAR Requests",
          id: `har-${workflowId}`,
          items: items,
        } as ImportedGroupPayload);

        setMessage({
          type: "success",
          title: "Import Successful",
          text: `${items.length} request(s) saved and added to Add Nodes panel`,
        });

        setTimeout(() => {
          onClose();
          setUploadedFile(null);
          setPastedText("");
        }, 2000);
      } else {
        setMessage({
          type: "error",
          title: "No Requests Found",
          text: "Could not parse any requests from the HAR file",
        });
      }
    } catch (error) {
      setMessage({
        type: "error",
        title: "Error",
        text: error instanceof Error ? error.message : "An error occurred",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportCurl = async (): Promise<void> => {
    setIsLoading(true);
    setMessage(null);

    try {
      if (!pastedText.trim()) {
        setMessage({
          type: "error",
          title: "Error",
          text: "Please paste curl command(s)",
        });
        setIsLoading(false);
        return;
      }

      const result = (await apiweave.workflows.importCurl({
        workspaceId: workspaceId || "",
        curlCommand: pastedText,
        sanitize,
        parseOnly: true,
      })) as { nodes?: Node[] };

      const nodes = result.nodes || [];

      if (nodes.length > 0) {
        await saveTemplatesToWorkflow(nodes, "curl");

        const items = nodesToPaletteItems(nodes);
        addImportedGroup({
          title: "Curl Requests",
          id: `curl-${workflowId}`,
          items: items,
        } as ImportedGroupPayload);

        setMessage({
          type: "success",
          title: "Import Successful",
          text: `${items.length} request(s) saved and added to Add Nodes panel`,
        });

        setTimeout(() => {
          onClose();
          setPastedText("");
        }, 2000);
      } else {
        setMessage({
          type: "error",
          title: "No Requests Found",
          text: "Could not parse any requests from the curl command(s)",
        });
      }
    } catch (error) {
      setMessage({
        type: "error",
        title: "Error",
        text: error instanceof Error ? error.message : "An error occurred",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = (): void => {
    if (activeTab === "openapi") {
      handleImportOpenAPI();
    } else if (activeTab === "har") {
      handleImportHAR();
    } else if (activeTab === "curl") {
      handleImportCurl();
    }
  };

  const handleTabChange = (tab: ActiveTab): void => {
    setActiveTab(tab);
    setMessage(null);
    setUploadedFile(null);
    setPastedText("");
  };

  return (
    <Modal isOpen onClose={onClose} title="Import to Add Nodes">
      <PanelTabs
        tabs={IMPORT_TABS}
        activeTab={activeTab}
        onTabChange={(key) => handleTabChange(key as ActiveTab)}
      />
      <div id={`panel-tab-${activeTab}`} role="tabpanel" className="p-6">
        {/* Messages */}
        {message && (
          <div
            className={`mb-4 p-4 rounded-sm border flex gap-3 ${
              message.type === "success"
                ? "bg-[var(--aw-status-success)]/5 dark:bg-[var(--aw-status-success)]/10 text-status-success dark:text-status-success-dark border-status-success/30"
                : "bg-[var(--aw-status-error)]/5 dark:bg-[var(--aw-status-error)]/10 text-status-error dark:text-status-error-dark border-status-error/30"
            }`}
          >
            {message.type === "success" ? (
              <CheckCircle className="w-5 h-5 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
            )}
            <div>
              <div className="font-medium">{message.title}</div>
              <div className="text-sm">{message.text}</div>
            </div>
          </div>
        )}

        {/* OpenAPI Tab */}
        {activeTab === "openapi" && (
          <div className="space-y-4">
            <div className="p-3 bg-primary/5 dark:bg-primary/10 rounded-sm flex gap-2 text-sm text-primary dark:text-primary-light border border-primary/20 dark:border-primary/30">
              <Info size={18} className="flex-shrink-0 mt-0.5" />
              <span>
                Upload or paste an OpenAPI specification. Requests will be added
                to your Add Nodes panel.
              </span>
            </div>

            <FileUploadDropzone
              accept=".json,.yaml,.yml"
              description="JSON or YAML OpenAPI files"
              fileInputRef={fileInputRef}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onFileInputChange={handleFileInputChange}
            />

            <PasteAreaField
              label="Or paste OpenAPI spec"
              placeholder="Paste OpenAPI JSON/YAML here..."
              value={pastedText}
              onChange={(val) => {
                setPastedText(val);
                setUploadedFile(null);
              }}
            />

            <div className="flex items-center gap-4">
              <SanitizeCheckbox checked={sanitize} onChange={setSanitize} />
            </div>

            <ImportActionButton
              disabled={isLoading || (!uploadedFile && !pastedText)}
              loading={isLoading}
              onClick={handleImport}
            />
          </div>
        )}

        {/* HAR Tab */}
        {activeTab === "har" && (
          <div className="space-y-4">
            <div className="p-3 bg-primary/5 dark:bg-primary/10 rounded-sm flex gap-2 text-sm text-primary dark:text-primary-light border border-primary/20 dark:border-primary/30">
              <Info size={18} className="flex-shrink-0 mt-0.5" />
              <span>
                Upload or paste a HAR (HTTP Archive) file. Requests will be
                added to your Add Nodes panel.
              </span>
            </div>

            <FileUploadDropzone
              accept=".json,.har"
              description="JSON or HAR files"
              fileInputRef={fileInputRef}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onFileInputChange={handleFileInputChange}
            />

            <PasteAreaField
              label="Or paste HAR content"
              placeholder="Paste HAR JSON here..."
              value={pastedText}
              onChange={(val) => {
                setPastedText(val);
                setUploadedFile(null);
              }}
            />

            <div className="space-y-3">
              <div>
                <label
                  htmlFor="import-to-nodes-import-mode"
                  className="block text-sm font-medium text-text-primary dark:text-text-primary-dark mb-2"
                >
                  Import mode
                </label>
                <select
                  id="import-to-nodes-import-mode"
                  value={importMode}
                  onChange={(e) => setImportMode(e.target.value as ImportMode)}
                  className="w-full px-3 py-2 border border-border dark:border-border-dark rounded-sm bg-surface-raised dark:bg-surface-dark text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="linear">Linear (sequential)</option>
                  <option value="grouped">Parallel</option>
                </select>
              </div>
              <SanitizeCheckbox checked={sanitize} onChange={setSanitize} />
            </div>

            <ImportActionButton
              disabled={isLoading || (!uploadedFile && !pastedText)}
              loading={isLoading}
              onClick={handleImport}
            />
          </div>
        )}

        {/* Curl Tab */}
        {activeTab === "curl" && (
          <div className="space-y-4">
            <div className="p-3 bg-primary/5 dark:bg-primary/10 rounded-sm flex gap-2 text-sm text-primary dark:text-primary-light border border-primary/20 dark:border-primary/30">
              <Info size={18} className="flex-shrink-0 mt-0.5" />
              <span>
                Paste one or more curl commands. They will be parsed and added
                to your Add Nodes panel.
              </span>
            </div>

            <div>
              <label
                htmlFor="import-to-nodes-curl-commands"
                className="block text-sm font-medium text-text-primary dark:text-text-primary-dark mb-2"
              >
                Curl Commands
              </label>
              <TextArea
                id="import-to-nodes-curl-commands"
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder={
                  'Paste curl command(s) here. Example:\ncurl -X GET "https://api.example.com/users"\ncurl -X POST "https://api.example.com/users" -H "Content-Type: application/json" -d \'{"name": "John"}\'\n\nOr multiple commands separated by && or on separate lines'
                }
                className="w-full h-40 px-4 py-3 font-mono text-sm bg-surface-raised dark:bg-surface-dark-raised rounded-sm"
              />
            </div>

            <div>
              <SanitizeCheckbox checked={sanitize} onChange={setSanitize} />
            </div>

            <ImportActionButton
              disabled={isLoading || !pastedText.trim()}
              loading={isLoading}
              onClick={handleImport}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

export default ImportToNodesPanel;
