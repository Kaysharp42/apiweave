import type { Project } from "./Project";
import type { ProjectFileImportKind } from "./ProjectFileImportKind";

export interface ProjectFileImportTabProps {
  kind: ProjectFileImportKind;
  projects: Project[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
  sanitize: boolean;
  onSanitizeChange: (sanitize: boolean) => void;
  hasFile: boolean;
  isLoading: boolean;
  onFileSelect: (file: File) => void;
  onImport: () => void;
}
