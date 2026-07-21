import type { Project } from "./Project";

export interface WorkspaceProjectListResponse {
  projects: Project[];
  total: number;
}
