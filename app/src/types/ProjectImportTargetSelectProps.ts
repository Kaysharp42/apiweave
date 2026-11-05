import type { Project } from "./Project";

export interface ProjectImportTargetSelectProps {
  id: string;
  value: string | null;
  onChange: (projectId: string | null) => void;
  projects: Project[];
}
