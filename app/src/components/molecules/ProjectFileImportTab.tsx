import { CheckCircle, Upload } from "lucide-react";
import type {
  ProjectFileImportKind,
  ProjectFileImportTabProps,
} from "../../types";
import { Button } from "../atoms/Button";
import { CheckboxOption } from "./CheckboxOption";
import { FileDropZone } from "./FileDropZone";
import { ProjectImportTargetSelect } from "./ProjectImportTargetSelect";

const TARGETS: Record<
  ProjectFileImportKind,
  { readonly selectId: string; readonly inputAriaLabel: string }
> = {
  workflow: {
    selectId: "collection-import-select",
    inputAriaLabel: "Project workflow or HAR file upload",
  },
  har: {
    selectId: "collection-har-select",
    inputAriaLabel: "Project workflow or HAR file upload",
  },
  openapi: {
    selectId: "collection-openapi-select",
    inputAriaLabel: "Project OpenAPI file upload",
  },
};

/** A tab that imports a workflow, HAR or OpenAPI file into a chosen project. */
export function ProjectFileImportTab({
  kind,
  projects,
  selectedProjectId,
  onSelectProject,
  sanitize,
  onSanitizeChange,
  hasFile,
  isLoading,
  onFileSelect,
  onImport,
}: ProjectFileImportTabProps) {
  const target = TARGETS[kind];

  return (
    <div className="space-y-4">
      <div className="bg-surface-overlay dark:bg-surface-dark-overlay p-4 rounded-sm border border-border dark:border-border-dark">
        <p className="text-sm font-medium text-(--aw-primary) dark:text-(--aw-primary-light)">
          Import individual workflows, HAR files, or OpenAPI specs to this
          project
        </p>
      </div>

      <ProjectImportTargetSelect
        id={target.selectId}
        value={selectedProjectId}
        onChange={onSelectProject}
        projects={projects}
      />

      <FileDropZone
        title="Drag & drop file or click to browse"
        hint="Supports: .json (workflow/OpenAPI), .har (HAR files)"
        accept=".json,.har"
        inputAriaLabel={target.inputAriaLabel}
        onFileSelect={onFileSelect}
      />

      {hasFile && (
        <div className="bg-(--aw-status-success)/5 dark:bg-(--aw-status-success)/10 p-3 rounded-sm border border-(--aw-status-success)/20 flex items-center gap-2 text-status-success">
          <CheckCircle size={18} />
          <span className="text-sm">File loaded successfully</span>
        </div>
      )}

      <div className="space-y-2">
        <CheckboxOption
          label="Sanitize sensitive headers"
          checked={sanitize}
          onChange={onSanitizeChange}
          variant="plain"
        />
      </div>

      <Button
        onClick={onImport}
        disabled={isLoading || !hasFile || !selectedProjectId}
        fullWidth
        variant="primary"
        icon={<Upload size={18} />}
        title={!selectedProjectId ? "Please select a project" : ""}
      >
        {isLoading ? "Importing..." : "Import to Project"}
      </Button>
    </div>
  );
}
