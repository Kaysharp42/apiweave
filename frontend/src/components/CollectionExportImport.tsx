import {
  useState,
  useRef,
  useEffect,
  type DragEvent,
  type ChangeEvent,
} from "react";
import useSidebarStore from "../stores/SidebarStore";
import {
  X,
  Download,
  Upload,
  AlertCircle,
  CheckCircle,
  Info,
  FileText,
  Package,
  Network,
  Lock,
  Target,
  Terminal,
} from "lucide-react";
import { Button } from "./atoms/Button";
import { IconButton } from "./atoms/IconButton";
import { Input } from "./atoms/Input";
import { TextArea } from "./atoms/TextArea";
import { useScopeContext } from "../hooks/useScopeContext";
import {
  projectExportUrl,
  projectImportUrl,
  projectsUrl,
  workflowsUrl,
} from "../utils/scopedApi";
import type { Project } from "../types/Project";
import { authenticatedFetch } from "../utils/authenticatedApi";

type ProjectWithWorkflowCount = Project;

interface MessageState {
  type: "success" | "warning" | "error";
  title: string;
  text: string;
}

interface ValidationError {
  loc?: string[];
  msg: string;
}

interface ValidationStats {
  workflowCount?: number;
  environmentCount?: number;
  secretCount?: number;
  nodeCount?: number;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
  stats?: ValidationStats;
}

interface ImportResult {
  workflowCount: number;
  collectionId: string;
  projectId?: string;
}

interface CollectionExportImportProps {
  projectId?: string;
  projectName?: string;
  isOpen: boolean;
  onClose: () => void;
  mode?:
    | "export"
    | "import-collection"
    | "import-workflows"
    | "import-har"
    | "import-openapi"
    | "import-curl";
  onImportSuccess?: (projectId: string) => void;
}

type TabId =
  | "export"
  | "import-collection"
  | "import-workflows"
  | "import-har"
  | "import-openapi"
  | "import-curl";

type ImportModeType = "linear" | "parallel";

interface Position {
  x: number;
  y: number;
}

interface WorkflowNode {
  nodeId: string;
  type: string;
  label: string;
  data: Record<string, unknown>;
  position: Position;
}

interface WorkflowEdge {
  edgeId: string;
  source: string;
  target: string;
}

interface CreateWorkflowPayload {
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  nodeTemplates: Record<string, unknown>[];
  collectionId: string;
  variables: Record<string, unknown>;
  tags: string[];
}

export function CollectionExportImport({
  projectId,
  projectName,
  isOpen,
  onClose,
  mode = "export",
  onImportSuccess = () => {},
}: CollectionExportImportProps) {
  const { workspaceId } = useScopeContext();
  const [selectedTab, setActiveTab] = useState<TabId | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<MessageState | null>(null);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [pastedJson, setPastedJson] = useState<string>("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [includeEnvironments, setIncludeEnvironments] = useState<boolean>(true);
  const [importMode] = useState<ImportModeType>("linear");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [createNewProject, setCreateNewProject] = useState<boolean>(true);
  const [newProjectName, setNewProjectName] = useState<string>("");
  // Source projects from the SidebarStore — the same workspace-scoped list
  // that renders the sidebar. The modal's own fetch used a different
  // workspaceId source (useScopeContext) and could come back empty.
  // No filtering: the current project is a valid import target.
  const projects = useSidebarStore((s) => s.projects);
  const [selectedTargetProject, setSelectedTargetProject] = useState<
    string | null
  >(null);
  const [sanitize, setSanitize] = useState<boolean>(true);

  const activeTab = selectedTab ?? mode;

  const formatErrorMessage = (error: unknown): string => {
    if (typeof error === "string") {
      return error;
    }
    if (Array.isArray(error)) {
      return error
        .map((err: unknown) => {
          if (typeof err === "object" && err !== null && "msg" in err) {
            const errObj = err as ValidationError;
            const location = errObj.loc ? errObj.loc.join(" -> ") : "";
            return location ? `${location}: ${errObj.msg}` : errObj.msg;
          }
          return JSON.stringify(err);
        })
        .join("; ");
    }
    if (typeof error === "object" && error !== null && "msg" in error) {
      const errObj = error as ValidationError;
      const location = errObj.loc ? errObj.loc.join(" -> ") : "";
      return location ? `${location}: ${errObj.msg}` : errObj.msg;
    }
    return "An unknown error occurred";
  };

  // Refresh the shared project list whenever the modal opens, via the store's
  // activeWorkspaceId-scoped fetch — the same path that loads the sidebar.
  // When opened from a specific project, pre-select it as the import target.
  useEffect(() => {
    if (!isOpen) return;
    void useSidebarStore.getState().fetchProjects();
    if (projectId) setSelectedTargetProject(projectId);
  }, [isOpen, projectId]);

  const handleExport = async (): Promise<void> => {
    if (!workspaceId || !projectId) {
      setMessage({
        type: "error",
        title: "Export Error",
        text: "Workspace or project scope is not ready",
      });
      return;
    }
    setIsLoading(true);
    setMessage(null);

    try {
      const response = await authenticatedFetch(
        projectExportUrl(workspaceId, projectId, includeEnvironments),
      );

      if (response.ok) {
        const bundle: Record<string, unknown> = await response.json();

        const dataStr = JSON.stringify(bundle, null, 2);
        const dataBlob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${(projectName ?? "project").replace(/\s+/g, "_")}.awecollection`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        setMessage({
          type: "success",
          title: "Export Successful",
          text: `Project "${projectName}" exported successfully.`,
        });
      } else {
        const error: { detail?: unknown } = await response.json();
        setMessage({
          type: "error",
          title: "Export Failed",
          text: formatErrorMessage(error.detail) || "Failed to export project",
        });
      }
    } catch (error: unknown) {
      const err = error as Error;
      setMessage({
        type: "error",
        title: "Export Error",
        text: err.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleValidateCollectionImport = async (): Promise<void> => {
    if (!workspaceId) {
      setMessage({
        type: "error",
        title: "Validation Error",
        text: "Workspace scope is not ready",
      });
      return;
    }
    setIsLoading(true);
    setMessage(null);

    try {
      let bundleData: Record<string, unknown>;
      if (pastedJson) {
        bundleData = JSON.parse(pastedJson) as Record<string, unknown>;
      } else if (uploadedFile) {
        bundleData = JSON.parse(uploadedFile) as Record<string, unknown>;
      } else {
        setMessage({
          type: "error",
          title: "Validation Error",
          text: "Please upload or paste a project bundle",
        });
        setIsLoading(false);
        return;
      }

      const response = await authenticatedFetch(
        projectImportUrl(workspaceId, true),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bundle: bundleData,
            createNewProject,
            targetProjectId: selectedTargetProject,
          }),
        },
      );

      if (response.ok) {
        const result: ValidationResult = await response.json();
        setValidation(result);
        if (!result.valid) {
          setMessage({
            type: "error",
            title: "Validation Failed",
            text: result.errors.join(", "),
          });
        }
      } else {
        const error: { detail?: unknown } = await response.json();
        setMessage({
          type: "error",
          title: "Validation Failed",
          text: formatErrorMessage(error.detail) || "Failed to validate bundle",
        });
      }
    } catch (error: unknown) {
      const err = error as Error;
      setMessage({
        type: "error",
        title: "Parse Error",
        text: err.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportCollection = async (): Promise<void> => {
    if (!workspaceId) {
      setMessage({
        type: "error",
        title: "Import Error",
        text: "Workspace scope is not ready",
      });
      return;
    }
    setIsLoading(true);
    setMessage(null);

    try {
      let bundleData: Record<string, unknown>;
      if (pastedJson) {
        bundleData = JSON.parse(pastedJson) as Record<string, unknown>;
      } else if (uploadedFile) {
        bundleData = JSON.parse(uploadedFile) as Record<string, unknown>;
      } else {
        setMessage({
          type: "error",
          title: "Import Error",
          text: "Please upload or paste a project bundle",
        });
        setIsLoading(false);
        return;
      }

      const response = await authenticatedFetch(projectImportUrl(workspaceId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bundle: bundleData,
          createNewProject,
          newProjectName:
            newProjectName ||
            (bundleData.collection as Record<string, unknown> | undefined)
              ?.name,
          targetProjectId: selectedTargetProject,
          environmentMapping: {},
        }),
      });

      if (response.ok) {
        const result: ImportResult = await response.json();
        setMessage({
          type: "success",
          title: "Import Successful",
          text: `Imported ${result.workflowCount} workflow(s) into project.`,
        });

        setUploadedFile(null);
        setPastedJson("");
        setValidation(null);
        setNewProjectName("");

        useSidebarStore.getState().signalProjectsRefresh();

        setTimeout(() => {
          onImportSuccess(result.projectId ?? result.collectionId);
          onClose();
        }, 2000);
      } else {
        const error: { detail?: unknown } = await response.json();
        setMessage({
          type: "error",
          title: "Import Failed",
          text: formatErrorMessage(error.detail) || "Failed to import project",
        });
      }
    } catch (error: unknown) {
      const err = error as Error;
      setMessage({
        type: "error",
        title: "Import Error",
        text: err.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportWorkflowToCollection = async (): Promise<void> => {
    if (!workspaceId) {
      setMessage({
        type: "error",
        title: "Import Error",
        text: "Workspace scope is not ready",
      });
      return;
    }
    setIsLoading(true);
    setMessage(null);

    try {
      if (!selectedTargetProject) {
        setMessage({
          type: "error",
          title: "Import Error",
          text: "Please select a project first",
        });
        setIsLoading(false);
        return;
      }

      let bundleData: Record<string, unknown>;
      let fileContent: string;

      if (pastedJson) {
        bundleData = JSON.parse(pastedJson) as Record<string, unknown>;
        fileContent = pastedJson;
      } else if (uploadedFile) {
        bundleData = JSON.parse(uploadedFile) as Record<string, unknown>;
        fileContent = uploadedFile;
      } else {
        setMessage({
          type: "error",
          title: "Import Error",
          text: "Please upload or paste workflow data",
        });
        setIsLoading(false);
        return;
      }

      let detectedType: "workflow" | "openapi" | "har" = "workflow";
      if (bundleData.swagger || bundleData.openapi) {
        detectedType = "openapi";
      } else if (
        (bundleData.log as Record<string, unknown> | undefined)?.entries
      ) {
        detectedType = "har";
      }

      let parseResponse: Response;
      const formData = new FormData();

      if (detectedType === "workflow") {
        const blob = new Blob([fileContent], { type: "application/json" });
        formData.append("file", blob, "workflow.json");
        parseResponse = await authenticatedFetch(
          `${workflowsUrl(workspaceId, { skip: 0, limit: 20 }).split("?")[0]}/import?project_id=${encodeURIComponent(selectedTargetProject)}`,
          {
            method: "POST",
            body: formData,
          },
        );

        if (parseResponse.ok) {
          const importResult: { workflowId: string } =
            await parseResponse.json();
          const workflowId = importResult.workflowId;

          const assignResponse = await authenticatedFetch(
            `${projectsUrl(workspaceId, selectedTargetProject)}/workflows/${encodeURIComponent(workflowId)}/assign`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
            },
          );

          if (assignResponse.ok) {
            setMessage({
              type: "success",
              title: "Import Successful",
              text: "Workflow imported and assigned to project.",
            });

            setUploadedFile(null);
            setPastedJson("");
            setValidation(null);
            setSelectedTargetProject(null);

            useSidebarStore.getState().signalWorkflowsRefresh();

            setTimeout(() => {
              onClose();
            }, 2000);
          } else {
            setMessage({
              type: "error",
              title: "Import Failed",
              text: "Workflow imported but failed to assign to project",
            });
          }
        } else {
          const error: { detail?: unknown } = await parseResponse.json();
          setMessage({
            type: "error",
            title: "Import Failed",
            text:
              formatErrorMessage(error.detail) || "Failed to import workflow",
          });
        }
        setIsLoading(false);
        return;
      } else if (detectedType === "openapi") {
        const blob = new Blob([fileContent], { type: "application/json" });
        formData.append("file", blob, "openapi.json");
        parseResponse = await authenticatedFetch(
          `${workflowsUrl(workspaceId, { skip: 0, limit: 20 }).split("?")[0]}/import/openapi?sanitize=${sanitize}&parse_only=true`,
          {
            method: "POST",
            body: formData,
          },
        );
      } else {
        const blob = new Blob([fileContent], { type: "application/json" });
        formData.append("file", blob, "har.json");
        parseResponse = await authenticatedFetch(
          `${workflowsUrl(workspaceId, { skip: 0, limit: 20 }).split("?")[0]}/import/har?import_mode=${importMode}&sanitize=${sanitize}&parse_only=true`,
          {
            method: "POST",
            body: formData,
          },
        );
      }

      if (parseResponse.ok) {
        const parseResult: { nodes?: Record<string, unknown>[] } =
          await parseResponse.json();
        const nodeTemplates = parseResult.nodes || [];

        const startNodeId = `start_${Date.now()}`;
        const endNodeId = `end_${Date.now()}`;

        const startNode: WorkflowNode = {
          nodeId: startNodeId,
          type: "start",
          label: "Start",
          data: {},
          position: { x: 100, y: 100 },
        };

        const endNode: WorkflowNode = {
          nodeId: endNodeId,
          type: "end",
          label: "End",
          data: {},
          position: { x: 100, y: 300 },
        };

        const workflowName =
          detectedType === "openapi"
            ? `Imported OpenAPI - ${new Date().toLocaleString()}`
            : `Imported HAR - ${new Date().toLocaleString()}`;

        const payload: CreateWorkflowPayload = {
          name: workflowName,
          nodes: [startNode, endNode],
          edges: [
            {
              edgeId: `edge_${Date.now()}`,
              source: startNodeId,
              target: endNodeId,
            },
          ],
          nodeTemplates: nodeTemplates,
          collectionId: selectedTargetProject,
          variables: {},
          tags: ["imported"],
        };

        const createResponse = await authenticatedFetch(
          `${workflowsUrl(workspaceId, { skip: 0, limit: 20 }).split("?")[0]}?project_id=${encodeURIComponent(selectedTargetProject)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );

        if (createResponse.ok) {
          setMessage({
            type: "success",
            title: "Import Successful",
            text: `Workflow created in project with ${nodeTemplates.length} imported templates.`,
          });

          setUploadedFile(null);
          setPastedJson("");
          setValidation(null);
          setSelectedTargetProject(null);

          useSidebarStore.getState().signalWorkflowsRefresh();

          setTimeout(() => {
            onClose();
          }, 2000);
        } else {
          const error: { detail?: unknown } = await createResponse.json();
          setMessage({
            type: "error",
            title: "Create Failed",
            text:
              formatErrorMessage(error.detail) ||
              "Failed to create workflow with templates",
          });
        }
      } else {
        const error: { detail?: unknown } = await parseResponse.json();
        setMessage({
          type: "error",
          title: "Parse Failed",
          text:
            formatErrorMessage(error.detail) || "Failed to parse import file",
        });
      }
    } catch (error: unknown) {
      const err = error as Error;
      setMessage({
        type: "error",
        title: "Import Error",
        text: err.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportCurlToCollection = async (): Promise<void> => {
    if (!workspaceId) {
      setMessage({
        type: "error",
        title: "Import Error",
        text: "Workspace scope is not ready",
      });
      return;
    }
    setIsLoading(true);
    setMessage(null);

    try {
      if (!selectedTargetProject) {
        setMessage({
          type: "error",
          title: "Import Error",
          text: "Please select a project first",
        });
        setIsLoading(false);
        return;
      }

      if (!pastedJson.trim()) {
        setMessage({
          type: "error",
          title: "Import Error",
          text: "Please enter a cURL command",
        });
        setIsLoading(false);
        return;
      }

      const params = new URLSearchParams();
      params.append("curl_command", pastedJson);
      params.append("sanitize", String(sanitize));
      params.append("project_id", selectedTargetProject);

      const response = await authenticatedFetch(
        `${workflowsUrl(workspaceId, { skip: 0, limit: 20 }).split("?")[0]}/import/curl?${params}`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        const errorData: { detail?: string } = await response.json();
        throw new Error(errorData.detail || "Import failed");
      }

      await response.json();

      setMessage({
        type: "success",
        title: "Import Successful",
        text: "cURL command imported and assigned to project.",
      });

      setPastedJson("");
      setValidation(null);
      setSelectedTargetProject(null);

      useSidebarStore.getState().signalProjectsRefresh();

      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (error: unknown) {
      const err = error as Error;
      setMessage({
        type: "error",
        title: "Import Error",
        text: err.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    e.currentTarget.classList.add(
      "border-[var(--aw-primary)]",
      "bg-[var(--aw-primary)]/5",
    );
  };

  const handleDragLeave = (e: DragEvent<HTMLButtonElement>): void => {
    e.currentTarget.classList.remove(
      "border-[var(--aw-primary)]",
      "bg-[var(--aw-primary)]/5",
    );
  };

  const handleDrop = (e: DragEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    e.currentTarget.classList.remove(
      "border-[var(--aw-primary)]",
      "bg-[var(--aw-primary)]/5",
    );

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0] as File);
    }
  };

  const handleFileSelect = (file: File): void => {
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      if (e.target?.result) {
        setUploadedFile(e.target.result as string);
        setPastedJson("");
        setValidation(null);
      }
    };
    reader.readAsText(file);
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const tabButtonClasses = (tab: TabId): string => {
    const base =
      "flex-1 px-4 py-3 font-medium text-center transition-colors flex items-center justify-center gap-2";
    if (activeTab === tab) {
      return `${base} border-b-2 border-[var(--aw-primary)] text-[var(--aw-primary)] dark:text-[var(--aw-primary-light)] bg-surface-raised dark:bg-surface-dark-raised`;
    }
    return `${base} text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark`;
  };

  if (!isOpen) {
    return null;
  }

  return (
    <dialog
      open
      className="fixed inset-0 z-50 bg-transparent p-0"
      aria-label="Project export import"
    >
      <button
        type="button"
        aria-label="Close project export import"
        className="fixed inset-0 z-40 cursor-default bg-[var(--aw-surface)]/60 dark:bg-[var(--aw-surface)]/80"
        onClick={onClose}
      />
      <div className="relative z-50 bg-surface-raised dark:bg-surface-dark-raised rounded border border-border dark:border-border-dark w-full max-w-2xl max-h-screen overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-border dark:border-border-dark">
          <h2 className="text-2xl font-bold text-text-primary dark:text-text-primary-dark">
            {activeTab === "export" && `Export Project: ${projectName}`}
            {activeTab === "import-collection" && "Import Project"}
            {activeTab === "import-workflows" && "Import Workflow to Project"}
            {activeTab === "import-har" && "Import HAR File to Project"}
            {activeTab === "import-openapi" && "Import OpenAPI to Project"}
            {activeTab === "import-curl" && "Import cURL to Project"}
          </h2>
          <IconButton onClick={onClose} tooltip="Close" variant="ghost">
            <X size={24} />
          </IconButton>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
          <button
            type="button"
            onClick={() => {
              setActiveTab("export");
              setMessage(null);
              setValidation(null);
            }}
            className={tabButtonClasses("export")}
          >
            <Download className="w-4 h-4" />
            Export Project
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("import-collection");
              setMessage(null);
              setValidation(null);
            }}
            className={tabButtonClasses("import-collection")}
          >
            <Upload className="w-4 h-4" />
            Import Project
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("import-workflows");
              setMessage(null);
              setValidation(null);
            }}
            className={tabButtonClasses("import-workflows")}
          >
            <FileText className="w-4 h-4" />
            Import Workflows
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("import-har");
              setMessage(null);
              setValidation(null);
            }}
            className={tabButtonClasses("import-har")}
          >
            <Upload className="w-4 h-4" />
            HAR File
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("import-openapi");
              setMessage(null);
              setValidation(null);
            }}
            className={tabButtonClasses("import-openapi")}
          >
            <Upload className="w-4 h-4" />
            OpenAPI
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("import-curl");
              setMessage(null);
              setValidation(null);
            }}
            className={tabButtonClasses("import-curl")}
          >
            <Terminal className="w-4 h-4" />
            cURL
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Messages */}
          {message && (
            <div
              className={`mb-4 p-4 rounded border flex gap-3 ${
                message.type === "success"
                  ? "bg-[var(--aw-status-success)]/5 dark:bg-[var(--aw-status-success)]/10 text-[var(--aw-status-success)] dark:text-[var(--aw-status-success)] border-[var(--aw-status-success)]/20"
                  : message.type === "warning"
                    ? "bg-[var(--aw-status-warning)]/5 dark:bg-[var(--aw-status-warning)]/10 text-[var(--aw-status-warning)] dark:text-[var(--aw-status-warning)] border-[var(--aw-status-warning)]/20"
                    : "bg-[var(--aw-status-error)]/5 dark:bg-[var(--aw-status-error)]/10 text-[var(--aw-status-error)] dark:text-[var(--aw-status-error)] border-[var(--aw-status-error)]/20"
              }`}
            >
              {message.type === "success" && (
                <CheckCircle size={20} className="flex-shrink-0" />
              )}
              {message.type === "warning" && (
                <AlertCircle size={20} className="flex-shrink-0" />
              )}
              {message.type === "error" && (
                <AlertCircle size={20} className="flex-shrink-0" />
              )}
              <div>
                <p className="font-bold">{message.title}</p>
                <p className="text-sm">{message.text}</p>
              </div>
            </div>
          )}

          {/* Export Tab */}
          {activeTab === "export" && (
            <div className="space-y-4">
              <div className="bg-surface-overlay dark:bg-surface-dark-overlay p-4 rounded border border-border dark:border-border-dark">
                <p className="text-sm font-medium text-[var(--aw-primary)] dark:text-[var(--aw-primary-light)]">
                  Export this project with all workflows and environments
                </p>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeEnvironments}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setIncludeEnvironments(e.target.checked)
                    }
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-text-primary dark:text-text-primary-dark">
                    Include Environments
                  </span>
                </label>
              </div>

              <Button
                onClick={handleExport}
                disabled={isLoading}
                fullWidth
                icon={<Download size={18} />}
              >
                {isLoading ? "Exporting..." : "Download Project Bundle"}
              </Button>
            </div>
          )}

          {activeTab === "import-collection" && (
            <div className="space-y-4">
              {/* Upload */}
              <button
                type="button"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className="border border-dashed border-border dark:border-border-dark rounded p-6 text-center hover:bg-surface dark:hover:bg-surface-dark transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload
                  size={32}
                  className="mx-auto mb-2 text-text-muted dark:text-text-muted-dark"
                />
                <p className="font-medium text-text-primary dark:text-text-primary-dark">
                  Drag & drop project bundle
                </p>
                <p className="text-sm text-text-muted dark:text-text-muted-dark">
                  or click to browse
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".awecollection,.json"
                  onChange={handleFileInputChange}
                  aria-label="Project bundle file upload"
                  className="hidden"
                />
              </button>

              {uploadedFile && (
                <div className="bg-[var(--aw-status-success)]/5 dark:bg-[var(--aw-status-success)]/10 p-3 rounded border border-[var(--aw-status-success)]/20 flex items-center gap-2 text-status-success dark:text-status-success-dark">
                  <CheckCircle size={18} />
                  <span className="text-sm">File loaded successfully</span>
                </div>
              )}

              {/* Paste JSON */}
              <div>
                <label
                  htmlFor="collection-export-paste-json"
                  className="block text-sm font-medium mb-2 text-text-primary dark:text-text-primary-dark"
                >
                  Or paste JSON:
                </label>
                <TextArea
                  id="collection-export-paste-json"
                  value={pastedJson}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                    setPastedJson(e.target.value);
                    setUploadedFile(null);
                  }}
                  placeholder="Paste project JSON here..."
                  className="w-full h-32 resize-none"
                  rows={6}
                />
              </div>

              {/* Validation */}
              {validation && (
                <div className="bg-surface dark:bg-surface-dark p-4 rounded border border-border dark:border-border-dark space-y-2">
                  <h4 className="font-medium text-text-primary dark:text-text-primary-dark">
                    Validation Results
                  </h4>
                  {validation.valid ? (
                    <p className="text-status-success dark:text-status-success-dark text-sm flex items-center gap-2">
                      <CheckCircle size={16} /> Valid project bundle
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {validation.errors.map((err: string) => (
                        <p
                          key={err}
                          className="text-status-error dark:text-status-error-dark text-sm flex items-center gap-2"
                        >
                          <AlertCircle size={14} /> {err}
                        </p>
                      ))}
                    </div>
                  )}

                  {validation.warnings && validation.warnings.length > 0 && (
                    <div className="space-y-1">
                      {validation.warnings.map((warn: string) => (
                        <p
                          key={warn}
                          className="text-[var(--aw-status-warning)] text-sm flex items-center gap-2"
                        >
                          <Info size={14} /> {warn}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-text-secondary dark:text-text-secondary-dark">
                    <p className="flex items-center gap-1">
                      <Package className="w-3 h-3" /> Workflows:{" "}
                      {validation.stats?.workflowCount || 0}
                    </p>
                    <p className="flex items-center gap-1">
                      <Network className="w-3 h-3" /> Environments:{" "}
                      {validation.stats?.environmentCount || 0}
                    </p>
                    <p className="flex items-center gap-1">
                      <Lock className="w-3 h-3" /> Secrets:{" "}
                      {validation.stats?.secretCount || 0}
                    </p>
                    <p className="flex items-center gap-1">
                      <Target className="w-3 h-3" /> Nodes:{" "}
                      {validation.stats?.nodeCount || 0}
                    </p>
                  </div>
                </div>
              )}

              {/* Import options */}
              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    checked={createNewProject}
                    onChange={() => setCreateNewProject(true)}
                    className="w-4 h-4"
                  />
                  <span className="text-text-primary dark:text-text-primary-dark">
                    Create New Project
                  </span>
                </label>

                {createNewProject && (
                  <Input
                    type="text"
                    value={newProjectName}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setNewProjectName(e.target.value)
                    }
                    placeholder="Project name..."
                    className="ml-7"
                  />
                )}

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    checked={!createNewProject}
                    onChange={() => setCreateNewProject(false)}
                    className="w-4 h-4"
                  />
                  <span className="text-text-primary dark:text-text-primary-dark">
                    Import to Existing Project
                  </span>
                </label>

                {!createNewProject && (
                  <select
                    value={selectedTargetProject || ""}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                      setSelectedTargetProject(e.target.value)
                    }
                    className="ml-7 w-full px-3 py-2 border border-border dark:border-border-dark rounded bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark"
                  >
                    <option value="">Select project…</option>
                    {projects.map((project: ProjectWithWorkflowCount) => (
                      <option
                        key={project.projectId ?? project.collectionId}
                        value={project.projectId ?? project.collectionId}
                      >
                        {project.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button
                  onClick={handleValidateCollectionImport}
                  disabled={isLoading || (!uploadedFile && !pastedJson)}
                  variant="outline"
                  className="flex-1"
                >
                  Validate
                </Button>
                <Button
                  onClick={handleImportCollection}
                  disabled={
                    isLoading ||
                    !validation?.valid ||
                    (!createNewProject && !selectedTargetProject)
                  }
                  variant="primary"
                  icon={<Upload size={18} />}
                  className="flex-1"
                >
                  {isLoading ? "Importing..." : "Import Project"}
                </Button>
              </div>
            </div>
          )}

          {/* Import Workflows Tab */}
          {activeTab === "import-workflows" && (
            <div className="space-y-4">
              <div className="bg-surface-overlay dark:bg-surface-dark-overlay p-4 rounded border border-border dark:border-border-dark">
                <p className="text-sm font-medium text-[var(--aw-primary)] dark:text-[var(--aw-primary-light)]">
                  Import individual workflows, HAR files, or OpenAPI specs to
                  this project
                </p>
              </div>

              {/* Collection Selector */}
              <div className="space-y-2">
                <label
                  htmlFor="collection-import-select"
                  className="block text-sm font-medium text-text-primary dark:text-text-primary-dark"
                >
                  Select Project
                </label>
                <select
                  id="collection-import-select"
                  value={selectedTargetProject || ""}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                    setSelectedTargetProject(e.target.value || null)
                  }
                  className="w-full px-4 py-2 border border-border dark:border-border-dark rounded bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus:ring-2 focus:ring-[var(--aw-primary)] focus:border-transparent"
                >
                  <option value="">-- Choose a project --</option>
                  {projects.map((project: ProjectWithWorkflowCount) => (
                    <option
                      key={project.projectId ?? project.collectionId}
                      value={project.projectId ?? project.collectionId}
                    >
                      {project.name} ({project.workflowCount} workflows)
                    </option>
                  ))}
                </select>
                {projects.length === 0 && (
                  <p className="text-xs text-[var(--aw-status-warning)]">
                    No projects available. Create a project first.
                  </p>
                )}
              </div>

              {/* Upload */}
              <button
                type="button"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className="border border-dashed border-border dark:border-border-dark rounded p-6 text-center hover:bg-surface dark:hover:bg-surface-dark transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload
                  size={32}
                  className="mx-auto mb-2 text-text-muted dark:text-text-muted-dark"
                />
                <p className="font-medium text-text-primary dark:text-text-primary-dark">
                  Drag & drop file or click to browse
                </p>
                <p className="text-xs text-text-muted dark:text-text-muted-dark">
                  Supports: .json (workflow/OpenAPI), .har (HAR files)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.har"
                  onChange={handleFileInputChange}
                  aria-label="Project workflow or HAR file upload"
                  className="hidden"
                />
              </button>

              {uploadedFile && (
                <div className="bg-[var(--aw-status-success)]/5 dark:bg-[var(--aw-status-success)]/10 p-3 rounded border border-[var(--aw-status-success)]/20 flex items-center gap-2 text-status-success dark:text-status-success-dark">
                  <CheckCircle size={18} />
                  <span className="text-sm">File loaded successfully</span>
                </div>
              )}

              {/* Options */}
              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sanitize}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setSanitize(e.target.checked)
                    }
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-text-primary dark:text-text-primary-dark">
                    Sanitize sensitive headers
                  </span>
                </label>
              </div>

              {/* Action button */}
              <Button
                onClick={handleImportWorkflowToCollection}
                disabled={isLoading || !uploadedFile || !selectedTargetProject}
                fullWidth
                variant="primary"
                icon={<Upload size={18} />}
                title={!selectedTargetProject ? "Please select a project" : ""}
              >
                {isLoading ? "Importing..." : "Import to Project"}
              </Button>
            </div>
          )}

          {/* Import HAR Tab */}
          {activeTab === "import-har" && (
            <div className="space-y-4">
              <div className="bg-surface-overlay dark:bg-surface-dark-overlay p-4 rounded border border-border dark:border-border-dark">
                <p className="text-sm font-medium text-[var(--aw-primary)] dark:text-[var(--aw-primary-light)]">
                  Import individual workflows, HAR files, or OpenAPI specs to
                  this project
                </p>
              </div>

              {/* Collection Selector */}
              <div className="space-y-2">
                <label
                  htmlFor="collection-har-select"
                  className="block text-sm font-medium text-text-primary dark:text-text-primary-dark"
                >
                  Select Project
                </label>
                <select
                  id="collection-har-select"
                  value={selectedTargetProject || ""}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                    setSelectedTargetProject(e.target.value || null)
                  }
                  className="w-full px-4 py-2 border border-border dark:border-border-dark rounded bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus:ring-2 focus:ring-[var(--aw-primary)] focus:border-transparent"
                >
                  <option value="">-- Choose a project --</option>
                  {projects.map((project: ProjectWithWorkflowCount) => (
                    <option
                      key={project.projectId ?? project.collectionId}
                      value={project.projectId ?? project.collectionId}
                    >
                      {project.name} ({project.workflowCount} workflows)
                    </option>
                  ))}
                </select>
                {projects.length === 0 && (
                  <p className="text-xs text-[var(--aw-status-warning)]">
                    No projects available. Create a project first.
                  </p>
                )}
              </div>

              {/* Upload */}
              <button
                type="button"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className="border border-dashed border-border dark:border-border-dark rounded p-6 text-center hover:bg-surface dark:hover:bg-surface-dark transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload
                  size={32}
                  className="mx-auto mb-2 text-text-muted dark:text-text-muted-dark"
                />
                <p className="font-medium text-text-primary dark:text-text-primary-dark">
                  Drag & drop file or click to browse
                </p>
                <p className="text-xs text-text-muted dark:text-text-muted-dark">
                  Supports: .json (workflow/OpenAPI), .har (HAR files)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.har"
                  onChange={handleFileInputChange}
                  aria-label="Project workflow or HAR file upload"
                  className="hidden"
                />
              </button>

              {uploadedFile && (
                <div className="bg-[var(--aw-status-success)]/5 dark:bg-[var(--aw-status-success)]/10 p-3 rounded border border-[var(--aw-status-success)]/20 flex items-center gap-2 text-status-success dark:text-status-success-dark">
                  <CheckCircle size={18} />
                  <span className="text-sm">File loaded successfully</span>
                </div>
              )}

              {/* Options */}
              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sanitize}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setSanitize(e.target.checked)
                    }
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-text-primary dark:text-text-primary-dark">
                    Sanitize sensitive headers
                  </span>
                </label>
              </div>

              {/* Action button */}
              <Button
                onClick={handleImportWorkflowToCollection}
                disabled={isLoading || !uploadedFile || !selectedTargetProject}
                fullWidth
                variant="primary"
                icon={<Upload size={18} />}
                title={!selectedTargetProject ? "Please select a project" : ""}
              >
                {isLoading ? "Importing..." : "Import to Project"}
              </Button>
            </div>
          )}

          {/* Import OpenAPI Tab */}
          {activeTab === "import-openapi" && (
            <div className="space-y-4">
              <div className="bg-surface-overlay dark:bg-surface-dark-overlay p-4 rounded border border-border dark:border-border-dark">
                <p className="text-sm font-medium text-[var(--aw-primary)] dark:text-[var(--aw-primary-light)]">
                  Import individual workflows, HAR files, or OpenAPI specs to
                  this project
                </p>
              </div>

              {/* Collection Selector */}
              <div className="space-y-2">
                <label
                  htmlFor="collection-openapi-select"
                  className="block text-sm font-medium text-text-primary dark:text-text-primary-dark"
                >
                  Select Project
                </label>
                <select
                  id="collection-openapi-select"
                  value={selectedTargetProject || ""}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                    setSelectedTargetProject(e.target.value || null)
                  }
                  className="w-full px-4 py-2 border border-border dark:border-border-dark rounded bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus:ring-2 focus:ring-[var(--aw-primary)] focus:border-transparent"
                >
                  <option value="">-- Choose a project --</option>
                  {projects.map((project: ProjectWithWorkflowCount) => (
                    <option
                      key={project.projectId ?? project.collectionId}
                      value={project.projectId ?? project.collectionId}
                    >
                      {project.name} ({project.workflowCount} workflows)
                    </option>
                  ))}
                </select>
                {projects.length === 0 && (
                  <p className="text-xs text-[var(--aw-status-warning)]">
                    No projects available. Create a project first.
                  </p>
                )}
              </div>

              {/* Upload */}
              <button
                type="button"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className="border border-dashed border-border dark:border-border-dark rounded p-6 text-center hover:bg-surface dark:hover:bg-surface-dark transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload
                  size={32}
                  className="mx-auto mb-2 text-text-muted dark:text-text-muted-dark"
                />
                <p className="font-medium text-text-primary dark:text-text-primary-dark">
                  Drag & drop file or click to browse
                </p>
                <p className="text-xs text-text-muted dark:text-text-muted-dark">
                  Supports: .json (workflow/OpenAPI), .har (HAR files)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.har"
                  onChange={handleFileInputChange}
                  aria-label="Project OpenAPI file upload"
                  className="hidden"
                />
              </button>

              {uploadedFile && (
                <div className="bg-[var(--aw-status-success)]/5 dark:bg-[var(--aw-status-success)]/10 p-3 rounded border border-[var(--aw-status-success)]/20 flex items-center gap-2 text-status-success dark:text-status-success-dark">
                  <CheckCircle size={18} />
                  <span className="text-sm">File loaded successfully</span>
                </div>
              )}

              {/* Options */}
              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sanitize}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setSanitize(e.target.checked)
                    }
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-text-primary dark:text-text-primary-dark">
                    Sanitize sensitive headers
                  </span>
                </label>
              </div>

              {/* Action button */}
              <Button
                onClick={handleImportWorkflowToCollection}
                disabled={isLoading || !uploadedFile || !selectedTargetProject}
                fullWidth
                variant="primary"
                icon={<Upload size={18} />}
                title={!selectedTargetProject ? "Please select a project" : ""}
              >
                {isLoading ? "Importing..." : "Import to Project"}
              </Button>
            </div>
          )}

          {/* Import cURL Tab */}
          {activeTab === "import-curl" && (
            <div className="space-y-4">
              <div className="bg-surface-overlay dark:bg-surface-dark-overlay p-4 rounded border border-border dark:border-border-dark">
                <p className="text-sm font-medium text-[var(--aw-primary)] dark:text-[var(--aw-primary-light)]">
                  Import cURL commands to create API test workflows in this
                  project
                </p>
              </div>

              {/* Collection Selector */}
              <div className="space-y-2">
                <label
                  htmlFor="collection-curl-select"
                  className="block text-sm font-medium text-text-primary dark:text-text-primary-dark"
                >
                  Select Project
                </label>
                <select
                  id="collection-curl-select"
                  value={selectedTargetProject || ""}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                    setSelectedTargetProject(e.target.value || null)
                  }
                  className="w-full px-4 py-2 border border-border dark:border-border-dark rounded bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus:ring-2 focus:ring-[var(--aw-primary)] focus:border-transparent"
                >
                  <option value="">-- Choose a project --</option>
                  {projects.map((project: ProjectWithWorkflowCount) => (
                    <option
                      key={project.projectId ?? project.collectionId}
                      value={project.projectId ?? project.collectionId}
                    >
                      {project.name} ({project.workflowCount} workflows)
                    </option>
                  ))}
                </select>
                {projects.length === 0 && (
                  <p className="text-xs text-[var(--aw-status-warning)]">
                    No projects available. Create a project first.
                  </p>
                )}
              </div>

              {/* cURL Input */}
              <div className="space-y-2">
                <label
                  htmlFor="collection-curl-commands"
                  className="block text-sm font-medium text-text-primary dark:text-text-primary-dark"
                >
                  cURL Command(s)
                </label>
                <TextArea
                  id="collection-curl-commands"
                  value={pastedJson}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                    setPastedJson(e.target.value)
                  }
                  placeholder="Paste your cURL command here (single or multiple commands separated by &&)"
                  className="font-mono text-sm"
                  rows={6}
                />
              </div>

              {/* Options */}
              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sanitize}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setSanitize(e.target.checked)
                    }
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-text-primary dark:text-text-primary-dark">
                    Sanitize sensitive headers
                  </span>
                </label>
              </div>

              {/* Action button */}
              <Button
                onClick={handleImportCurlToCollection}
                disabled={
                  isLoading || !pastedJson.trim() || !selectedTargetProject
                }
                fullWidth
                variant="primary"
                icon={<Upload size={18} />}
                title={!selectedTargetProject ? "Please select a project" : ""}
              >
                {isLoading ? "Importing..." : "Import to Project"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}

export default CollectionExportImport;
