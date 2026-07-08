import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  CollectionRepository,
  EnvironmentRepository,
  RunRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../../repositories"
import { initDatabase } from "../../../db"
import { LocalOwnerProvider } from "../../../auth/LocalOwnerProvider"
import { LocalOnlySyncProvider } from "../../../sync/LocalOnlySyncProvider"
import { ScopeResolver } from "../../../services/scope_resolver"
import { WorkspaceService } from "../../../services/workspace_service"
import { CollectionService } from "../../../services/collection_service"
import { WorkflowService } from "../../../services/workflow_service"
import { EnvironmentService } from "../../../services/environment_service"
import { RunService } from "../../../services/run_service"
import { SecretService, type SecretWriteStore } from "../../../services/secret_service"
import { ProjectExportService } from "../../../services/project_export_service"
import type { SecretMetadata } from "../../../secrets/scoped_secret_resolver"
import { IpcRouter } from "../../router"
import { registerAllHandlers, type HandlerDeps } from ".."

/**
 * Python → IPC reconciliation. Each surviving `@router.*` route in the keep-bucket
 * modules is classified here as either a registered `{domain}.{action}` handler or
 * an explicit GAP with a reason. This table IS the committed gap list (Task 13
 * acceptance criterion). The test then (a) asserts every declared handler is really
 * registered, and (b) asserts every route the Python source actually exposes is
 * classified — so a new Python route can never silently escape reconciliation.
 */

type Entry = { readonly path: string; readonly handler?: string; readonly gap?: string }
type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH"

// Drop-bucket reasons (decisions #12 + single-user): org/user scope, multi-tenant
// membership, protection, and features not in this wave's service set.
const GAP_ORG = "org/user scope dropped — workspace-scoped only (#12)"
const GAP_TENANT = "multi-tenant membership dropped — single local owner"
const GAP_PROTECT = "environment_protection dropped"
const GAP_INFRA = "infra healthcheck — no HTTP surface in single-process app"
const GAP_DEFERRED = "feature not in Task 12 service set — deferred to a later task"
const GAP_EXECUTOR = "run-time concern owned by the executor (Task 14)"
const GAP_ARTIFACT = "run artifact/result fetch — reporters surface (Task 16)"
const GAP_CRYPTO = "keypair/KEK op — crypto layer (Task 7), not a service handler"

const KEEP: Record<string, readonly [Method, Entry][]> = {
  "workspaces.py": [
    ["GET", { path: "", handler: "workspaces.list" }],
    ["POST", { path: "", handler: "workspaces.create" }],
    ["GET", { path: "/healthz", gap: GAP_INFRA }],
    ["GET", { path: "/{workspace_id}", handler: "workspaces.get" }],
    ["PATCH", { path: "/{workspace_id}", handler: "workspaces.update" }],
    ["DELETE", { path: "/{workspace_id}", handler: "workspaces.delete" }],
    ["POST", { path: "/{workspace_id}/restore", gap: GAP_DEFERRED }],
    ["GET", { path: "/{workspace_id}/members", gap: GAP_TENANT }],
    ["POST", { path: "/{workspace_id}/members", gap: GAP_TENANT }],
    ["PATCH", { path: "/{workspace_id}/members/{user_id}", gap: GAP_TENANT }],
    ["DELETE", { path: "/{workspace_id}/members/{user_id}", gap: GAP_TENANT }],
    ["GET", { path: "/{workspace_id}/collaborators", gap: GAP_TENANT }],
    ["POST", { path: "/{workspace_id}/collaborators", gap: GAP_TENANT }],
    ["DELETE", { path: "/{workspace_id}/collaborators/{collaborator_id}", gap: GAP_TENANT }],
    ["GET", { path: "/{workspace_id}/projects", handler: "projects.list" }],
    ["POST", { path: "/{workspace_id}/projects", handler: "projects.create" }],
    ["GET", { path: "/{workspace_id}/projects/{project_id}", handler: "projects.get" }],
    ["PATCH", { path: "/{workspace_id}/projects/{project_id}", handler: "projects.update" }],
    ["DELETE", { path: "/{workspace_id}/projects/{project_id}", handler: "projects.delete" }],
    ["POST", { path: "/{workspace_id}/projects/{project_id}/workflows/{workflow_id}/assign", handler: "projects.addWorkflow" }],
    ["DELETE", { path: "/{workspace_id}/projects/{project_id}/workflows/{workflow_id}", handler: "projects.removeWorkflow" }],
    ["GET", { path: "/{workspace_id}/workflows", handler: "workflows.list" }],
    ["POST", { path: "/{workspace_id}/workflows", handler: "workflows.create" }],
    ["GET", { path: "/{workspace_id}/workflows/{workflow_id}", handler: "workflows.get" }],
    ["PATCH", { path: "/{workspace_id}/workflows/{workflow_id}", handler: "workflows.update" }],
    ["DELETE", { path: "/{workspace_id}/workflows/{workflow_id}", handler: "workflows.delete" }],
    ["GET", { path: "/{workspace_id}/runs", handler: "runs.listByWorkspace" }],
    ["GET", { path: "/{workspace_id}/workflows/{workflow_id}/runs", handler: "runs.listByWorkflow" }],
    ["POST", { path: "/{workspace_id}/workflows/{workflow_id}/run", handler: "runs.create" }],
    ["GET", { path: "/{workspace_id}/workflows/{workflow_id}/runs/latest-failed", handler: "runs.getLatestFailed" }],
    ["GET", { path: "/{workspace_id}/workflows/{workflow_id}/runs/{run_id}", handler: "runs.get" }],
    ["GET", { path: "/{workspace_id}/workflows/{workflow_id}/runs/{run_id}/nodes/{node_id}/result", gap: GAP_ARTIFACT }],
    ["GET", { path: "/{workspace_id}/workflows/{workflow_id}/export", gap: GAP_DEFERRED }],
    ["POST", { path: "/{workspace_id}/workflows/import", handler: "projects.import" }],
    ["POST", { path: "/{workspace_id}/workflows/import/dry-run", handler: "projects.dryRun" }],
    ["POST", { path: "/{workspace_id}/workflows/import/har", gap: GAP_DEFERRED }],
    ["POST", { path: "/{workspace_id}/workflows/import/har/dry-run", gap: GAP_DEFERRED }],
    ["POST", { path: "/{workspace_id}/workflows/import/openapi", gap: GAP_DEFERRED }],
    ["GET", { path: "/{workspace_id}/workflows/import/openapi/url", gap: GAP_DEFERRED }],
    ["POST", { path: "/{workspace_id}/workflows/import/openapi/dry-run", gap: GAP_DEFERRED }],
    ["POST", { path: "/{workspace_id}/workflows/import/curl", gap: GAP_DEFERRED }],
    ["POST", { path: "/{workspace_id}/workflows/import/curl/dry-run", gap: GAP_DEFERRED }],
    ["GET", { path: "/{workspace_id}/workflows/{workflow_id}/templates", gap: GAP_DEFERRED }],
    ["POST", { path: "/{workspace_id}/workflows/{workflow_id}/templates", gap: GAP_DEFERRED }],
    ["PUT", { path: "/{workspace_id}/workflows/{workflow_id}/templates", gap: GAP_DEFERRED }],
    ["DELETE", { path: "/{workspace_id}/workflows/{workflow_id}/templates", gap: GAP_DEFERRED }],
  ],
  "scoped_environments.py": [
    ["GET", { path: "/api/users/{user_id}/environments", gap: GAP_ORG }],
    ["POST", { path: "/api/users/{user_id}/environments", gap: GAP_ORG }],
    ["GET", { path: "/api/users/{user_id}/environments/{environment_id}", gap: GAP_ORG }],
    ["PUT", { path: "/api/users/{user_id}/environments/{environment_id}", gap: GAP_ORG }],
    ["DELETE", { path: "/api/users/{user_id}/environments/{environment_id}", gap: GAP_ORG }],
    ["GET", { path: "/api/orgs/{org_id}/environments", gap: GAP_ORG }],
    ["POST", { path: "/api/orgs/{org_id}/environments", gap: GAP_ORG }],
    ["GET", { path: "/api/orgs/{org_id}/environments/{environment_id}", gap: GAP_ORG }],
    ["PUT", { path: "/api/orgs/{org_id}/environments/{environment_id}", gap: GAP_ORG }],
    ["DELETE", { path: "/api/orgs/{org_id}/environments/{environment_id}", gap: GAP_ORG }],
    ["PUT", { path: "/api/orgs/{org_id}/environments/{environment_id}/allowed-workspaces", gap: GAP_ORG }],
    ["GET", { path: "/api/orgs/{org_id}/environments/available-for/{workspace_id}", gap: GAP_ORG }],
    ["GET", { path: "/api/workspaces/{workspace_id}/environments", handler: "environments.list" }],
    ["POST", { path: "/api/workspaces/{workspace_id}/environments", handler: "environments.create" }],
    ["GET", { path: "/api/workspaces/{workspace_id}/environments/default", gap: GAP_DEFERRED }],
    ["POST", { path: "/api/workspaces/{workspace_id}/environments/resolve", gap: GAP_EXECUTOR }],
    ["GET", { path: "/api/workspaces/{workspace_id}/environments/all-accessible", gap: GAP_ORG }],
    ["GET", { path: "/api/workspaces/{workspace_id}/environments/{environment_id}", handler: "environments.get" }],
    ["PUT", { path: "/api/workspaces/{workspace_id}/environments/{environment_id}", handler: "environments.update" }],
    ["DELETE", { path: "/api/workspaces/{workspace_id}/environments/{environment_id}", handler: "environments.delete" }],
    ["POST", { path: "/api/workspaces/{workspace_id}/environments/{environment_id}/duplicate", gap: GAP_DEFERRED }],
    ["GET", { path: "/api/workspaces/{workspace_id}/environments/{environment_id}/protection", gap: GAP_PROTECT }],
    ["PUT", { path: "/api/workspaces/{workspace_id}/environments/{environment_id}/protection", gap: GAP_PROTECT }],
    ["DELETE", { path: "/api/workspaces/{workspace_id}/environments/{environment_id}/protection", gap: GAP_PROTECT }],
  ],
  "runs.py": [
    ["POST", { path: "", handler: "runs.create" }],
    ["GET", { path: "", handler: "runs.listByWorkspace" }],
    ["GET", { path: "/{run_id}", handler: "runs.get" }],
    ["DELETE", { path: "/{run_id}", handler: "runs.cancel" }],
    ["GET", { path: "/{run_id}/results", gap: GAP_ARTIFACT }],
  ],
  "secrets.py": [
    ["GET", { path: "/{scope_type}/{scope_id}/secrets", handler: "secrets.list" }],
    ["GET", { path: "/{scope_type}/{scope_id}/secrets/{secret_id}", gap: GAP_DEFERRED }],
    ["POST", { path: "/{scope_type}/{scope_id}/secrets", handler: "secrets.set" }],
    ["PUT", { path: "/{scope_type}/{scope_id}/secrets/{secret_id}", handler: "secrets.set" }],
    ["DELETE", { path: "/{scope_type}/{scope_id}/secrets/{secret_id}", handler: "secrets.delete" }],
    ["GET", { path: "/{scope_type}/{scope_id}/secrets/bindings", gap: GAP_DEFERRED }],
    ["POST", { path: "/{scope_type}/{scope_id}/secrets/bindings", gap: GAP_DEFERRED }],
    ["DELETE", { path: "/{scope_type}/{scope_id}/secrets/bindings/{binding_id}", gap: GAP_DEFERRED }],
  ],
  "projects.py": [
    ["GET", { path: "", gap: GAP_DEFERRED }],
    ["GET", { path: "/healthz", gap: GAP_INFRA }],
    ["GET", { path: "/{project_id}", handler: "projects.get" }],
  ],
  "keys.py": [
    ["GET", { path: "/public-key", gap: GAP_CRYPTO }],
    ["POST", { path: "/keys/rotate", gap: GAP_CRYPTO }],
  ],
  "mcp_config.py": [["GET", { path: "/config", gap: GAP_DEFERRED }]],
}

function buildRouter(): IpcRouter {
  const db = initDatabase({ databasePath: ":memory:" })
  const workspaces = new WorkspaceRepository(db.kvStore)
  const workflows = new WorkflowRepository(db.kvStore)
  const runs = new RunRepository(db.kvStore)
  const environments = new EnvironmentRepository(db.kvStore)
  const collections = new CollectionRepository(db.kvStore)
  const scopeResolver = new ScopeResolver({
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: (id) => environments.getById(id) !== undefined,
  })
  const permissions = new LocalOwnerProvider()
  const sync = new LocalOnlySyncProvider()
  const secretStore: SecretWriteStore = {
    put: () => ({}) as SecretMetadata,
    remove: () => false,
    listByScope: () => [],
    getByScopeAndName: () => null,
  }
  const deps: HandlerDeps = {
    workspaces: new WorkspaceService(workspaces, sync, scopeResolver),
    collections: new CollectionService(collections, workflows, sync, permissions, scopeResolver),
    workflows: new WorkflowService(workflows, sync, permissions, scopeResolver, collections, environments),
    environments: new EnvironmentService(environments, sync, permissions, scopeResolver),
    runs: new RunService(runs, sync, permissions, scopeResolver),
    secrets: new SecretService(secretStore, sync, permissions, scopeResolver, new Uint8Array(32)),
    projects: new ProjectExportService(collections, workflows, environments, sync, permissions, scopeResolver),
  }
  const router = new IpcRouter()
  registerAllHandlers(router, deps)
  db.close()
  return router
}

/** Re-extract (method, path) pairs from a Python route module — mirrors the audit script. */
function extractRoutes(source: string): Set<string> {
  const lines = source.split(/\r?\n/)
  const out = new Set<string>()
  for (let i = 0; i < lines.length; i++) {
    const m = /@router\.(get|post|put|delete|patch)\(/.exec(lines[i] ?? "")
    if (!m) continue
    const segment = lines.slice(i, i + 3).join("\n")
    const pathMatch = /"([^"]*)"/.exec(segment)
    out.add(`${m[1]!.toUpperCase()} ${pathMatch ? pathMatch[1] : "?"}`)
  }
  return out
}

const routesDir = resolve(process.cwd(), "../backend/app/routes")
const pythonPresent = existsSync(routesDir)

describe("Python → IPC route reconciliation (Task 13 acceptance)", () => {
  it("registers every handler the reconciliation table declares", () => {
    const registered = new Set(buildRouter().keys())
    const missing: string[] = []
    for (const entries of Object.values(KEEP)) {
      for (const [, entry] of entries) {
        if (entry.handler && !registered.has(entry.handler)) missing.push(entry.handler)
      }
    }
    expect(missing, `handlers declared in table but not registered: ${missing.join(", ")}`).toEqual([])
  })

  it.skipIf(!pythonPresent)("classifies every route the Python keep-bucket actually exposes", () => {
    const unclassified: string[] = []
    for (const [module, entries] of Object.entries(KEEP)) {
      const source = readFileSync(resolve(routesDir, module), "utf-8")
      const live = extractRoutes(source)
      const declared = new Set(entries.map(([method, e]) => `${method} ${e.path || ""}`))
      for (const route of live) {
        if (!declared.has(route)) unclassified.push(`${module} ${route}`)
      }
    }
    expect(unclassified, `Python routes with no reconciliation entry: ${unclassified.join("; ")}`).toEqual([])
  })

  it("writes the reconciliation + gap list to evidence", () => {
    const registered = new Set(buildRouter().keys())
    const rows: string[] = ["# Task 13 — Python → IPC route reconciliation", ""]
    let mapped = 0
    let gaps = 0
    for (const [module, entries] of Object.entries(KEEP)) {
      rows.push(`## ${module}`)
      for (const [method, entry] of entries) {
        if (entry.handler) {
          mapped++
          const live = registered.has(entry.handler) ? "✓" : "✗ MISSING"
          rows.push(`  ${method.padEnd(6)} ${(entry.path || "(root)").padEnd(64)} -> ${entry.handler} ${live}`)
        } else {
          gaps++
          rows.push(`  ${method.padEnd(6)} ${(entry.path || "(root)").padEnd(64)} -> GAP: ${entry.gap}`)
        }
      }
      rows.push("")
    }
    rows.push(`Total: ${mapped} mapped, ${gaps} documented gaps, ${registered.size} handlers registered.`)

    const evidenceDir = resolve(process.cwd(), "../.omo/evidence")
    if (existsSync(resolve(process.cwd(), "../.omo"))) {
      mkdirSync(evidenceDir, { recursive: true })
      writeFileSync(resolve(evidenceDir, "task-13-route-reconciliation.txt"), rows.join("\n"), "utf-8")
    }
    expect(mapped).toBeGreaterThan(0)
  })
})
