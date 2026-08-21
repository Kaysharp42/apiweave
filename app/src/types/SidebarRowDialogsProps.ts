import type { Project } from "./Project";
import type { ScopedEnvironment } from "./ScopedEnvironment";
import type { SidebarRowActions } from "./SidebarRowActions";
import type { Workflow } from "./Workflow";

export interface SidebarRowDialogsProps {
  readonly actions: SidebarRowActions;
  readonly workspaceId: string | null;
  readonly projects: readonly Project[];
  readonly environments: readonly ScopedEnvironment[];
  readonly allWorkflows: readonly Workflow[];
}
