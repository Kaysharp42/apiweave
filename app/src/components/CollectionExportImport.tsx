import { useState, useRef, useEffect, type ChangeEvent } from "react";
import useSidebarStore from "../stores/SidebarStore";
import {
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
import { Select } from "./atoms/Select";
import { Modal } from "./molecules/Modal";
import { PanelTabs } from "./molecules/PanelTabs";
import { CheckboxOption } from "./molecules/CheckboxOption";
import { FileDropZone } from "./molecules/FileDropZone";
import { PasteJsonField } from "./molecules/PasteJsonField";
import { ProjectFileImportTab } from "./molecules/ProjectFileImportTab";
import { ProjectImportTargetSelect } from "./molecules/ProjectImportTargetSelect";
import type { ProjectFileImportKind, TabItem } from "../types";
import { Input } from "./atoms/Input";
import { TextArea } from "./atoms/TextArea";
import { useScopeContext } from "../hooks/useScopeContext";
import { apiweave } from "../utils/apiweaveClient";
import { downloadTextFile } from "../utils/downloadFile";
import { PostmanImportPanel } from "./PostmanImportPanel";
import type { Workflow } from "../types/Workflow";
import type { ProjectImportDryRunResult } from "../types/ProjectImportDryRunResult";

const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

interface MessageState {
  type: "success" | "warning" | "error";
  title: string;
  text: string;
}

interface ImportResult {
  workflowCount: number;
  environmentCount: number;
  projectId: string;
  missingSecrets: string[];
  warnings: string[];
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
    | "import-curl"
    | "import-postman";
  onImportSuccess?: (projectId: string) => void;
}

type TabId =
  | "export"
  | "import-collection"
  | "import-workflows"
  | "import-har"
  | "import-openapi"
  | "import-curl"
  | "import-postman";

const TABS: TabItem[] = [
  { key: "export", icon: Download, label: "Export Project" },
  { key: "import-collection", icon: Upload, label: "Import Project" },
  { key: "import-workflows", icon: FileText, label: "Import Workflows" },
  { key: "import-har", icon: Upload, label: "HAR File" },
  { key: "import-openapi", icon: Upload, label: "OpenAPI" },
  { key: "import-curl", icon: Terminal, label: "cURL" },
  { key: "import-postman", icon: Upload, label: "Postman" },
];

/** The three tabs whose body is the shared project file import panel. */
const FILE_IMPORT_KINDS: Partial<Record<TabId, ProjectFileImportKind>> = {
  "import-workflows": "workflow",
  "import-har": "har",
  "import-openapi": "openapi",
};

const TAB_TITLES: Record<TabId, (projectName: string | undefined) => string> = {
  export: (projectName) => `Export Project: ${projectName ?? ""}`,
  "import-collection": () => "Import Project",
  "import-workflows": () => "Import Workflow to Project",
  "import-har": () => "Import HAR File to Project",
  "import-openapi": () => "Import OpenAPI to Project",
  "import-curl": () => "Import cURL to Project",
  "import-postman": () => "Import Postman Collection",
};

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
  const [validation, setValidation] =
    useState<ProjectImportDryRunResult | null>(null);
  const [includeEnvironments, setIncludeEnvironments] = useState<boolean>(true);
  const modalContentRef = useRef<HTMLDivElement>(null);
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
  const fileImportKind = FILE_IMPORT_KINDS[activeTab];

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
      const bundle = await apiweave.projects.export(
        workspaceId,
        projectId,
        includeEnvironments,
      );

      downloadTextFile(
        `${(projectName ?? "project").replace(/\s+/g, "_")}.aweproject`,
        JSON.stringify(bundle, null, 2),
        "application/json",
      );

      setMessage({
        type: "success",
        title: "Export Successful",
        text: `Project "${projectName}" exported successfully.`,
      });
    } catch (error: unknown) {
      setMessage({
        type: "error",
        title: "Export Failed",
        text: errorText(error, "Failed to export project"),
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

      const result: ProjectImportDryRunResult = await apiweave.projects.dryRun(
        workspaceId,
        bundleData,
      );
      setValidation(result);
      if (!result.valid) {
        setMessage({
          type: "error",
          title: "Validation Failed",
          text: result.errors.join(", "),
        });
      }
    } catch (error: unknown) {
      setMessage({
        type: "error",
        title: "Validation Failed",
        text: errorText(error, "Failed to validate bundle"),
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

      const validationResult: ProjectImportDryRunResult =
        await apiweave.projects.dryRun(workspaceId, bundleData);
      setValidation(validationResult);
      if (!validationResult.valid) {
        setMessage({
          type: "error",
          title: "Validation Failed",
          text: validationResult.errors.join(", "),
        });
        scrollModalToTop(modalContentRef.current);
        return;
      }

      const bundleName = (
        bundleData.project as Record<string, unknown> | undefined
      )?.name;
      const projectName =
        newProjectName.trim() ||
        (typeof bundleName === "string" ? bundleName.trim() : "");
      const result = (await apiweave.projects.import(workspaceId, bundleData, {
        ...(!createNewProject && selectedTargetProject
          ? { targetProjectId: selectedTargetProject }
          : {}),
        ...(createNewProject && projectName ? { projectName } : {}),
      })) as ImportResult;
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
        onImportSuccess(result.projectId);
        onClose();
      }, 2000);
    } catch (error: unknown) {
      setMessage({
        type: "error",
        title: "Import Failed",
        text: errorText(error, "Failed to import project"),
      });
      scrollModalToTop(modalContentRef.current);
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

      if (detectedType === "workflow") {
        await apiweave.workflows.import({
          workspaceId,
          bundle: bundleData,
          collectionId: selectedTargetProject,
        });
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
        return;
      }

      const parseResult = (
        detectedType === "openapi"
          ? await apiweave.workflows.importOpenapi({
              workspaceId,
              spec: fileContent,
              sanitize,
            })
          : await apiweave.workflows.importHar({
              workspaceId,
              data: bundleData,
              sanitize,
            })
      ) as { nodes?: Workflow["nodeTemplates"] };
      const nodeTemplates = parseResult.nodes ?? [];

      const startNodeId = `start_${Date.now()}`;
      const endNodeId = `end_${Date.now()}`;

      await apiweave.workflows.create({
        workspaceId,
        collectionId: selectedTargetProject,
        name:
          detectedType === "openapi"
            ? `Imported OpenAPI - ${new Date().toLocaleString()}`
            : `Imported HAR - ${new Date().toLocaleString()}`,
        nodes: [
          {
            nodeId: startNodeId,
            type: "start",
            label: "Start",
            position: { x: 100, y: 100 },
            config: {},
          },
          {
            nodeId: endNodeId,
            type: "end",
            label: "End",
            position: { x: 100, y: 300 },
            config: {},
          },
        ],
        edges: [
          {
            edgeId: `edge_${Date.now()}`,
            source: startNodeId,
            target: endNodeId,
          },
        ],
        nodeTemplates,
        variables: {},
        tags: ["imported"],
      });
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
    } catch (error: unknown) {
      setMessage({
        type: "error",
        title: "Import Failed",
        text: errorText(error, "Failed to import workflow"),
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

      await apiweave.workflows.importCurl({
        workspaceId,
        curlCommand: pastedJson,
        sanitize,
        collectionId: selectedTargetProject,
      });

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

  const handleFileSelect = (file: File): void => {
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      if (e.target?.result) {
        const contents = e.target.result as string;
        setUploadedFile(contents);
        setPastedJson("");
        setValidation(null);
        setNewProjectName(
          (current) => current || projectNameFromBundle(contents),
        );
      }
    };
    reader.readAsText(file);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <Modal isOpen onClose={onClose} title={TAB_TITLES[activeTab](projectName)}>
      <PanelTabs
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(key) => {
          setActiveTab(key as TabId);
          setMessage(null);
          setValidation(null);
        }}
      />
      <div
        ref={modalContentRef}
        id={`panel-tab-${activeTab}`}
        role="tabpanel"
        className="p-6"
      >
        {/* Messages */}
        {message && (
          <div
            className={`mb-4 p-4 rounded-sm border flex gap-3 ${
              message.type === "success"
                ? "bg-(--aw-status-success)/5 dark:bg-(--aw-status-success)/10 text-(--aw-status-success) dark:text-(--aw-status-success) border-(--aw-status-success)/20"
                : message.type === "warning"
                  ? "bg-(--aw-status-warning)/5 dark:bg-(--aw-status-warning)/10 text-(--aw-status-warning) dark:text-(--aw-status-warning) border-(--aw-status-warning)/20"
                  : "bg-(--aw-status-error)/5 dark:bg-(--aw-status-error)/10 text-(--aw-status-error) dark:text-(--aw-status-error) border-(--aw-status-error)/20"
            }`}
          >
            {message.type === "success" && (
              <CheckCircle size={20} className="shrink-0" />
            )}
            {message.type === "warning" && (
              <AlertCircle size={20} className="shrink-0" />
            )}
            {message.type === "error" && (
              <AlertCircle size={20} className="shrink-0" />
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
            <div className="bg-surface-overlay dark:bg-surface-dark-overlay p-4 rounded-sm border border-border dark:border-border-dark">
              <p className="text-sm font-medium text-(--aw-primary) dark:text-(--aw-primary-light)">
                Export this project with all workflows and environments
              </p>
            </div>

            <div className="space-y-2">
              <CheckboxOption
                label="Include Environments"
                checked={includeEnvironments}
                onChange={setIncludeEnvironments}
                variant="plain"
              />
            </div>

            <Button
              onClick={handleExport}
              disabled={isLoading}
              fullWidth
              icon={<Download size={18} />}
            >
              {isLoading ? "Exporting…" : "Download Project Bundle"}
            </Button>
          </div>
        )}

        {activeTab === "import-collection" && (
          <div className="space-y-4">
            {/* Upload */}
            <FileDropZone
              title="Drag & drop project bundle"
              hint="or click to browse"
              hintClassName="text-sm text-text-secondary dark:text-text-secondary-dark"
              accept=".aweproject,.json"
              inputAriaLabel="Project bundle file upload"
              onFileSelect={handleFileSelect}
            />

            {uploadedFile && (
              <div className="bg-(--aw-status-success)/5 dark:bg-(--aw-status-success)/10 p-3 rounded-sm border border-(--aw-status-success)/20 flex items-center gap-2 text-status-success">
                <CheckCircle size={18} />
                <span className="text-sm">File loaded successfully</span>
              </div>
            )}

            {/* Paste JSON */}
            <PasteJsonField
              id="collection-export-paste-json"
              label="Or paste JSON:"
              value={pastedJson}
              placeholder="Paste project JSON here…"
              className="w-full h-32 resize-none"
              rows={6}
              onChange={(value) => {
                setPastedJson(value);
                setUploadedFile(null);
                setValidation(null);
              }}
            />

            {/* Validation */}
            {validation && (
              <div className="bg-surface dark:bg-surface-dark p-4 rounded-sm border border-border dark:border-border-dark space-y-2">
                <h4 className="font-medium text-text-primary dark:text-text-primary-dark">
                  Validation Results
                </h4>
                {validation.valid ? (
                  <p className="text-status-success text-sm flex items-center gap-2">
                    <CheckCircle size={16} /> Valid project bundle
                  </p>
                ) : (
                  <div className="space-y-1">
                    {validation.errors.map((err: string) => (
                      <p
                        key={err}
                        className="text-status-error text-sm flex items-center gap-2"
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
                        className="text-(--aw-status-warning) text-sm flex items-center gap-2"
                      >
                        <Info size={14} /> {warn}
                      </p>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-text-secondary dark:text-text-secondary-dark">
                  <p className="flex items-center gap-1">
                    <Package className="w-3 h-3" /> Workflows:{" "}
                    {validation.stats?.workflows || 0}
                  </p>
                  <p className="flex items-center gap-1">
                    <Network className="w-3 h-3" /> Environments:{" "}
                    {validation.stats?.environments || 0}
                  </p>
                  <p className="flex items-center gap-1">
                    <Lock className="w-3 h-3" /> Secrets:{" "}
                    {validation.stats?.secretReferences || 0}
                  </p>
                  <p className="flex items-center gap-1">
                    <Target className="w-3 h-3" /> Missing secrets:{" "}
                    {validation.stats?.missingSecrets || 0}
                  </p>
                </div>
              </div>
            )}

            {/* Import options */}
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="collection-import-target"
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
                  placeholder="Project name…"
                  className="ml-7"
                />
              )}

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="collection-import-target"
                  checked={!createNewProject}
                  onChange={() => setCreateNewProject(false)}
                  className="w-4 h-4"
                />
                <span className="text-text-primary dark:text-text-primary-dark">
                  Import to Existing Project
                </span>
              </label>

              {!createNewProject && (
                <Select
                  value={selectedTargetProject || ""}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                    setSelectedTargetProject(e.target.value)
                  }
                  className="ml-7 px-3 py-2 rounded-sm"
                >
                  <option value="">Select project…</option>
                  {projects.map((project) => (
                    <option
                      key={project.projectId ?? project.collectionId}
                      value={project.projectId ?? project.collectionId}
                    >
                      {project.name}
                    </option>
                  ))}
                </Select>
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
                  (!uploadedFile && !pastedJson) ||
                  (!createNewProject && !selectedTargetProject)
                }
                variant="primary"
                icon={<Upload size={18} />}
                className="flex-1"
              >
                {isLoading ? "Importing…" : "Import Project"}
              </Button>
            </div>
          </div>
        )}

        {fileImportKind && (
          <ProjectFileImportTab
            kind={fileImportKind}
            projects={projects}
            selectedProjectId={selectedTargetProject}
            onSelectProject={setSelectedTargetProject}
            sanitize={sanitize}
            onSanitizeChange={setSanitize}
            hasFile={!!uploadedFile}
            isLoading={isLoading}
            onFileSelect={handleFileSelect}
            onImport={handleImportWorkflowToCollection}
          />
        )}

        {activeTab === "import-postman" && (
          <PostmanImportPanel
            onImported={() => useSidebarStore.getState().signalProjectsRefresh()}
          />
        )}

        {/* Import cURL Tab */}
        {activeTab === "import-curl" && (
          <div className="space-y-4">
            <div className="bg-surface-overlay dark:bg-surface-dark-overlay p-4 rounded-sm border border-border dark:border-border-dark">
              <p className="text-sm font-medium text-(--aw-primary) dark:text-(--aw-primary-light)">
                Import cURL commands to create API test workflows in this
                project
              </p>
            </div>

            <ProjectImportTargetSelect
              id="collection-curl-select"
              value={selectedTargetProject}
              onChange={setSelectedTargetProject}
              projects={projects}
            />

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
              <CheckboxOption
                label="Sanitize sensitive headers"
                checked={sanitize}
                onChange={setSanitize}
                variant="plain"
              />
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
              {isLoading ? "Importing…" : "Import to Project"}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function projectNameFromBundle(contents: string): string {
  try {
    const parsed = JSON.parse(contents) as {
      readonly project?: { readonly name?: unknown };
    };
    return typeof parsed.project?.name === "string" ? parsed.project.name : "";
  } catch {
    return "";
  }
}

/** Brings the message at the top of the tab panel into view. */
function scrollModalToTop(element: HTMLDivElement | null): void {
  // jsdom implements no scrollIntoView.
  if (typeof element?.scrollIntoView !== "function") return;
  element.scrollIntoView({ block: "start", behavior: "smooth" });
}

export default CollectionExportImport;
