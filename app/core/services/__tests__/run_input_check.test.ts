import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { initDatabase, type InitializedDatabase } from "../../db"
import {
  CollectionRepository,
  EnvironmentRepository,
  ProjectRunRepository,
  RunRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../repositories"
import { ProjectRunner, type ProjectRunScheduler } from "../../runner/project_runner"
import { RunInputChecker, describeMissingRunInputs, type SecretState } from "../run_input_check"
import { MissingRunInputsError, RunService, type RunInputGate, type RunTrigger } from "../run_service"
import { ProjectRunService } from "../project_run_service"
import { ScopeResolver } from "../scope_resolver"
import { ValidationError } from "../../ipc/errors"
import type { RunInputsRefusal } from "@shared/types/RunInputsRefusal"

let db: InitializedDatabase
let workspaces: WorkspaceRepository
let workflows: WorkflowRepository
let environments: EnvironmentRepository
let workspaceId: string
/** Stored secret values by `name@scopeId`: the environment's id, or the workspace's. */
let stored: Map<string, string>

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  workspaces = new WorkspaceRepository(db.kvStore)
  workflows = new WorkflowRepository(db.kvStore)
  environments = new EnvironmentRepository(db.kvStore)
  workspaceId = workspaces.create({ name: "w", slug: "w" }).workspaceId
  stored = new Map()
})

afterEach(() => db.close())

/** The environment > workspace chain over `stored`, the way main opens it. */
async function secretState(name: string, chain: { environmentId?: string; workspaceId: string }): Promise<SecretState> {
  const scopes: ["environment" | "workspace", string | undefined][] = [["environment", chain.environmentId], ["workspace", chain.workspaceId]]
  for (const [scope, id] of scopes) {
    const value = id === undefined ? undefined : stored.get(`${name}@${id}`)
    if (value !== undefined) return value.trim() === "" ? { state: "empty", storedIn: scope } : { state: "set" }
  }
  return { state: "unset" }
}

function checker(): RunInputChecker {
  return new RunInputChecker({ workflows, environments, secretState })
}

function gate(refused: (refusal: RunInputsRefusal, agent: string | undefined) => void): RunInputGate {
  const inputs = checker()
  return { check: (ws, wf, env) => inputs.check(ws, wf, env), refused }
}

function http(nodeId: string, config: Record<string, unknown>, label?: string) {
  return { nodeId, type: "http-request" as const, position: { x: 0, y: 0 }, config, ...(label === undefined ? {} : { label }) }
}

function workflow(
  name: string,
  nodes: ReturnType<typeof http>[] | Record<string, unknown>[],
  options: { selectedEnvironmentId?: string | null; collectionId?: string } = {},
): string {
  return workflows.create({
    workspaceId,
    name,
    nodes: [{ nodeId: "start", type: "start", position: { x: 0, y: 0 } }, ...nodes] as never,
    edges: [],
    selectedEnvironmentId: options.selectedEnvironmentId ?? null,
    ...(options.collectionId === undefined ? {} : { collectionId: options.collectionId }),
  }).workflowId
}

describe("RunInputChecker", () => {
  it("names unset env variables and secrets with the steps that read them", async () => {
    const env = environments.create({ workspaceId, name: "Dev", variables: { BASE_URL: "http://x" } })
    const id = workflow("Login", [
      http("a", { url: "{{env.BASE_URL}}/login", headers: [{ key: "X-Tenant", value: "{{ env.TENANT }}" }] }, "Sign in"),
      http("b", { url: "{{env.BASE_URL}}/me", auth: { type: "bearer", bearer: { token: "{{secrets.API_TOKEN}}" } }, body: "{{env.USER.email}}" }),
    ])

    const check = await checker().check(workspaceId, id, env.environmentId)

    const a = { workflowId: id, workflowName: "Login", nodeId: "a", nodeLabel: "Sign in" }
    const b = { workflowId: id, workflowName: "Login", nodeId: "b", nodeLabel: "b" }
    expect(check.environment).toEqual({ environmentId: env.environmentId, name: "Dev" })
    expect(check.missing).toEqual([
      { kind: "env", name: "TENANT", reason: "unset", storedIn: null, usedBy: [a] },
      { kind: "env", name: "USER", reason: "unset", storedIn: null, usedBy: [b] },
      { kind: "secret", name: "API_TOKEN", reason: "unset", storedIn: null, usedBy: [b] },
    ])
  })

  it("names empty env variables and empty secrets, with the scope an empty secret sits in", async () => {
    const env = environments.create({ workspaceId, name: "Dev", variables: { BLANK: "  ", NULLED: null, ZERO: 0, OFF: false } })
    stored.set(`ENV_EMPTY@${env.environmentId}`, "")
    stored.set(`WS_EMPTY@${workspaceId}`, " ")
    const id = workflow("w", [
      http("a", { url: "{{env.BLANK}}{{env.NULLED}}{{env.ZERO}}{{env.OFF}}", headers: { a: "{{secrets.ENV_EMPTY}}", b: "{{secrets.WS_EMPTY}}" } }),
    ])

    const missing = (await checker().check(workspaceId, id, env.environmentId)).missing

    expect(missing.map(({ kind, name, reason, storedIn }) => ({ kind, name, reason, storedIn }))).toEqual([
      { kind: "env", name: "BLANK", reason: "empty", storedIn: null },
      { kind: "env", name: "NULLED", reason: "empty", storedIn: null },
      { kind: "secret", name: "ENV_EMPTY", reason: "empty", storedIn: "environment" },
      { kind: "secret", name: "WS_EMPTY", reason: "empty", storedIn: "workspace" },
    ])
  })

  it("reads an environment as a run does: a variable it blanks hides the one it inherits", async () => {
    const base = environments.create({ workspaceId, name: "Base", variables: { BASE_URL: "http://x", TOKEN: "t" } })
    const env = environments.create({ workspaceId, name: "Dev", baseEnvironmentId: base.environmentId, variables: { TOKEN: "" } })
    stored.set(`ENV_KEY@${env.environmentId}`, "k")
    stored.set(`WS_KEY@${workspaceId}`, "k")
    const id = workflow("w", [http("a", { url: "{{env.BASE_URL}}", headers: { a: "{{secrets.ENV_KEY}}", b: "{{secrets.WS_KEY}}", c: "{{env.TOKEN}}" } })])

    const missing = (await checker().check(workspaceId, id, env.environmentId)).missing

    expect(missing.map(({ name, reason }) => ({ name, reason }))).toEqual([{ name: "TOKEN", reason: "empty" }])
  })

  it("uses the workflow's saved environment unless told otherwise, and none when told null", async () => {
    const env = environments.create({ workspaceId, name: "Dev", variables: { BASE_URL: "http://x" } })
    const id = workflow("w", [http("a", { url: "{{env.BASE_URL}}" })], { selectedEnvironmentId: env.environmentId })

    expect((await checker().check(workspaceId, id, undefined)).missing).toEqual([])
    const none = await checker().check(workspaceId, id, null)
    expect(none.environment).toBeNull()
    expect(none.missing.map((input) => input.name)).toEqual(["BASE_URL"])
  })

  it("scans the workflows a Call Workflow node reaches, once each, and skips canvas notes", async () => {
    const child = workflow("Auth", [http("token", { url: "{{env.AUTH_URL}}" }, "Token")])
    const id = workflow("Parent", [
      { nodeId: "call", type: "workflow", position: { x: 0, y: 0 }, config: { targetWorkflowId: child } },
      { nodeId: "call2", type: "workflow", position: { x: 0, y: 0 }, config: { targetWorkflowId: child } },
      { nodeId: "note", type: "note", position: { x: 0, y: 0 }, config: { text: "{{env.IGNORED}}" } },
    ])

    const check = await checker().check(workspaceId, id, null)

    expect(check.missing).toEqual([
      { kind: "env", name: "AUTH_URL", reason: "unset", storedIn: null, usedBy: [{ workflowId: child, workflowName: "Auth", nodeId: "token", nodeLabel: "Token" }] },
    ])
  })

  it("ignores placeholders the runner would not resolve as a secret", async () => {
    const id = workflow("w", [http("a", { url: "{{secrets.not-a-name}}", body: "{{variables.x}} {{data.y}} {{prev.response.body}}" })])
    expect((await checker().check(workspaceId, id, null)).missing).toEqual([])
  })

  it("says who can fix what, for a reader that sees only the message", async () => {
    const env = environments.create({ workspaceId, name: "Dev", variables: { EMPTY: "" } })
    const id = workflow("Login", [http("a", { url: "{{env.BASE_URL}}{{env.EMPTY}}", headers: { k: "{{secrets.KEY}}" } })])
    const check = await checker().check(workspaceId, id, env.environmentId)

    const message = describeMissingRunInputs({ target: { kind: "workflow", name: "Login" }, checks: [check] })

    expect(message).toContain("Nothing was sent")
    expect(message).toContain(`{{env.BASE_URL}}, {{env.EMPTY}} (empty) are not set or are empty in environment 'Dev' (${env.environmentId})`)
    expect(message).toContain("{{secrets.KEY}}")
    expect(message).toContain("Only the user can add or change a secret")
  })
})

describe("RunService refuses a run that reads unset or empty values", () => {
  function service(refused: (refusal: RunInputsRefusal, agent: string | undefined) => void) {
    const enqueue = vi.fn(() => "run-1")
    const trigger = { enqueue, cancel: () => false } as unknown as RunTrigger
    const runs = new RunRepository(db.kvStore)
    const scope = new ScopeResolver({ workspaceExists: () => true, environmentExists: () => true })
    return { runService: new RunService(runs, scope, trigger, undefined, gate(refused)), enqueue }
  }

  it("before anything is enqueued, telling the gate which agent asked", async () => {
    const id = workflow("Login", [http("a", { url: "{{env.BASE_URL}}" })])
    const refused = vi.fn()
    const { runService, enqueue } = service(refused)

    const error = await runService.createRun(workspaceId, { workflowId: id }, { agent: "claude-code" }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(MissingRunInputsError)
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as MissingRunInputsError).details).toMatchObject({
      runInputs: { target: { kind: "workflow", name: "Login" }, checks: [{ workflowId: id, missing: [{ kind: "env", name: "BASE_URL" }] }] },
    })
    expect(refused).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: "workflow", name: "Login" } }), "claude-code")
    expect(enqueue).not.toHaveBeenCalled()
  })

  it("for data-driven runs too", async () => {
    const id = workflow("Login", [http("a", { url: "{{env.BASE_URL}}" })])
    const refused = vi.fn()
    const { runService, enqueue } = service(refused)

    await expect(runService.createIterations(workspaceId, { workflowId: id, rows: [{}] })).rejects.toBeInstanceOf(MissingRunInputsError)
    expect(refused).toHaveBeenCalledWith(expect.anything(), undefined)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it("for a browser inspection an agent asks for", async () => {
    const id = workflow("Login", [http("a", { url: "{{env.BASE_URL}}" })])
    const refused = vi.fn()
    const { runService, enqueue } = service(refused)

    await expect(
      runService.inspectBrowser(workspaceId, { workflowId: id, screenshot: false, maxBytes: 1000 }, { agent: "claude-code" }),
    ).rejects.toBeInstanceOf(MissingRunInputsError)
    expect(refused).toHaveBeenCalledWith(expect.anything(), "claude-code")
    expect(enqueue).not.toHaveBeenCalled()
  })

  it("and lets a run whose values are all set through", async () => {
    const env = environments.create({ workspaceId, name: "Dev", variables: { BASE_URL: "http://x" } })
    const id = workflow("Login", [http("a", { url: "{{env.BASE_URL}}" })])
    const refused = vi.fn()
    const { runService, enqueue } = service(refused)

    await runService.createRun(workspaceId, { workflowId: id, selectedEnvironmentId: env.environmentId }).catch(() => undefined)

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(refused).not.toHaveBeenCalled()
    expect((await runService.checkInputs(workspaceId, id, env.environmentId)).missing).toEqual([])
  })
})

describe("ProjectRunService refuses a project whose workflows read unset or empty values", () => {
  function setup(refused: (refusal: RunInputsRefusal, agent: string | undefined) => void) {
    const collections = new CollectionRepository(db.kvStore)
    const projectRuns = new ProjectRunRepository(db.kvStore)
    const enqueue = vi.fn(() => "run-1")
    const scheduler = { enqueue, cancel: () => false, whenFinished: async () => "completed" } as unknown as ProjectRunScheduler
    const runner = new ProjectRunner({ projectRuns, collections, workflows, environments, runs: new RunRepository(db.kvStore), scheduler })
    const scope = new ScopeResolver({ workspaceExists: () => true, environmentExists: () => true })
    return { service: new ProjectRunService(runner, projectRuns, collections, scope, gate(refused)), collections, projectRuns, enqueue }
  }

  it("before any workflow runs, with one check per workflow that lacks something", async () => {
    const refused = vi.fn()
    const { service, collections, projectRuns, enqueue } = setup(refused)
    const env = environments.create({ workspaceId, name: "Dev", variables: { BASE_URL: "http://x" } })
    const projectId = collections.create({ workspaceId, name: "Smoke" }).collectionId
    workflow("Fine", [http("a", { url: "{{env.BASE_URL}}" })], { collectionId: projectId })
    const lacking = workflow("Lacking", [http("a", { url: "{{env.BASE_URL}}", headers: { k: "{{secrets.KEY}}" } })], { collectionId: projectId })

    const error = await service.start(workspaceId, projectId, env.environmentId, "claude-code").catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(MissingRunInputsError)
    const refusal = (error as MissingRunInputsError).refusal
    expect(refusal.target).toEqual({ kind: "project", name: "Smoke" })
    expect(refusal.checks.map((check) => [check.workflowId, check.missing.map((item) => item.name)])).toEqual([[lacking, ["KEY"]]])
    expect((error as Error).message).toContain("Project 'Smoke' not started")
    expect(refused).toHaveBeenCalledWith(refusal, "claude-code")
    expect(enqueue).not.toHaveBeenCalled()
    expect(projectRuns.listByProject(projectId)).toEqual([])
  })

  it("and starts a project whose values are all set", async () => {
    const refused = vi.fn()
    const { service, collections } = setup(refused)
    const env = environments.create({ workspaceId, name: "Dev", variables: { BASE_URL: "http://x" } })
    const projectId = collections.create({ workspaceId, name: "Smoke" }).collectionId
    workflow("Fine", [http("a", { url: "{{env.BASE_URL}}" })], { collectionId: projectId })

    expect((await service.start(workspaceId, projectId, env.environmentId)).status).toBe("running")
    expect(refused).not.toHaveBeenCalled()
  })
})
