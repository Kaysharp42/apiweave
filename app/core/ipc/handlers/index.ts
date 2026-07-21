import type { IpcRouter } from "../router"
import type { HandlerDeps } from "./common"
import { registerWorkspaceHandlers } from "./workspaces"
import { registerWorkflowHandlers } from "./workflows"
import { registerEnvironmentHandlers } from "./environments"
import { registerRunHandlers } from "./runs"
import { registerSecretHandlers } from "./secrets"
import { registerProjectHandlers } from "./projects"
import { registerImportHandlers } from "./imports"
import { registerCloudHandlers } from "./cloud"

export type { HandlerDeps } from "./common"

/**
 * Wire every domain's handlers onto the router. Called once at the composition
 * root after the services are constructed. Each domain module registers its own
 * `{domain}.{action}` pairs one-by-one — there is no reflective bulk registration
 * (acceptance criterion); adding a service method means adding one `register` call.
 */
export function registerAllHandlers(router: IpcRouter, deps: HandlerDeps): void {
  registerWorkspaceHandlers(router, deps)
  registerWorkflowHandlers(router, deps)
  registerEnvironmentHandlers(router, deps)
  registerRunHandlers(router, deps)
  registerSecretHandlers(router, deps)
  registerProjectHandlers(router, deps)
  registerImportHandlers(router, deps)
  registerCloudHandlers(router, deps)
}
