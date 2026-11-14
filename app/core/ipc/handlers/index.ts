import type { IpcRouter } from "../router"
import type { HandlerDeps } from "./common"
import { registerWorkspaceHandlers } from "./workspaces"
import { registerAppHandlers } from "./app"
import { registerWorkflowHandlers } from "./workflows"
import { registerEnvironmentHandlers } from "./environments"
import { registerNodePresetHandlers } from "./node-presets"
import { registerRunHandlers } from "./runs"
import { registerSecretHandlers } from "./secrets"
import { registerProjectHandlers } from "./projects"
import { registerImportHandlers } from "./imports"
import { registerAssertionHandlers } from "./assertions"
import { registerGuideHandlers } from "./guides"
import { registerGrpcHandlers } from "./grpc"
import { GrpcDiscoveryService } from "../../services/grpc_discovery_service"

export type { HandlerDeps } from "./common"

/**
 * Wire every domain's handlers onto the router. Called once at the composition
 * root after the services are constructed. Each domain module registers its own
 * `{domain}.{action}` pairs one-by-one — there is no reflective bulk registration
 * (acceptance criterion); adding a service method means adding one `register` call.
 */
export function registerAllHandlers(router: IpcRouter, deps: HandlerDeps): void {
  // Only where there is an Electron app to describe: no test router and no MCP
  // catalogue supplies one, and About is not a surface an agent uses.
  if (deps.app !== undefined) registerAppHandlers(router, deps.app)
  registerWorkspaceHandlers(router, deps)
  registerWorkflowHandlers(router, deps)
  registerAssertionHandlers(router, deps)
  registerGuideHandlers(router)
  registerGrpcHandlers(router, deps.grpcDiscovery ?? new GrpcDiscoveryService())
  registerEnvironmentHandlers(router, deps)
  registerNodePresetHandlers(router, deps)
  registerRunHandlers(router, deps)
  registerSecretHandlers(router, deps)
  registerProjectHandlers(router, deps)
  registerImportHandlers(router, deps)
}
