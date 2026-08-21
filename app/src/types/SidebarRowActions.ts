import type { Project } from "./Project";
import type { Workflow } from "./Workflow";

/**
 * The rename/move actions a sidebar row offers, as one object.
 *
 * Grouped by verb rather than by row so `SidebarRowDialogs` can render every
 * dialog from `targets` + `close` + `submit` without knowing which row opened
 * it, and the rows only ever need `open`.
 */
export interface SidebarRowActions {
  readonly targets: {
    readonly renameProject: Project | null;
    readonly renameWorkflow: Workflow | null;
    readonly moveWorkflowToProject: Workflow | null;
    readonly moveWorkflowToWorkspace: Workflow | null;
    readonly moveProjectToWorkspace: Project | null;
  };
  readonly open: {
    readonly renameProject: (project: Project) => void;
    readonly renameWorkflow: (workflow: Workflow) => void;
    readonly moveWorkflowToProject: (workflow: Workflow) => void;
    readonly moveWorkflowToWorkspace: (workflow: Workflow) => void;
    readonly moveProjectToWorkspace: (project: Project) => void;
  };
  readonly close: {
    readonly renameProject: () => void;
    readonly renameWorkflow: () => void;
    readonly moveWorkflowToProject: () => void;
    readonly moveWorkflowToWorkspace: () => void;
    readonly moveProjectToWorkspace: () => void;
  };
  readonly submit: {
    readonly renameProject: (name: string) => Promise<void>;
    readonly renameWorkflow: (name: string) => Promise<void>;
    readonly moveWorkflowToProject: (
      targetProjectId: string | null,
    ) => Promise<void>;
    readonly moveWorkflowToWorkspace: (
      targetWorkspaceId: string,
      targetProjectId: string | null,
    ) => Promise<void>;
    readonly moveProjectToWorkspace: (
      targetWorkspaceId: string,
    ) => Promise<void>;
  };
}
