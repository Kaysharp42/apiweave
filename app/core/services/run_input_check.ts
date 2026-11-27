import type { Environment } from "@shared/types/Environment"
import type { JsonValue } from "@shared/types/JsonValue"
import type { MissingRunInput } from "@shared/types/MissingRunInput"
import type { RunInputCheck } from "@shared/types/RunInputCheck"
import type { RunInputsRefusal } from "@shared/types/RunInputsRefusal"
import type { RunInputUse } from "@shared/types/RunInputUse"
import type { Workflow } from "@shared/types/Workflow"
import { withoutCanvasOnlyNodes } from "@shared/graph/frames"
import { NotFoundError } from "../ipc/errors"
import { forEachString } from "./node_facts"

/**
 * Where a secret stands for a run: no value anywhere down the chain, a value
 * that is blank (in the scope that wins), or a usable one.
 */
export type SecretState =
  | { readonly state: "unset" }
  | { readonly state: "empty"; readonly storedIn: "environment" | "workspace" }
  | { readonly state: "set" }

/** Where a check reads from. Nothing here hands a secret's value out of main. */
export interface RunInputSources {
  readonly workflows: { getByIdInWorkspace(workflowId: string, workspaceId: string): Workflow | undefined }
  readonly environments: {
    getById(environmentId: string): Environment | undefined
    resolveEffectiveVariables(environmentId: string): Record<string, JsonValue>
  }
  /** `name` down the environment > workspace chain, the order a run resolves it in. */
  readonly secretState: (name: string, chain: { readonly environmentId?: string; readonly workspaceId: string }) => Promise<SecretState>
}

/**
 * `{{env.PATH}}` and `{{secrets.NAME}}` as the executor reads them: whatever
 * sits between the scope and the closing braces, spaces trimmed. An env path
 * is walked by dot keys and `[n]` indexes, so the variable it needs is its root; a secret
 * resolves only when the whole name is an identifier (see `secret_utils`).
 */
const REFERENCE_RE = /\{\{\s*(env|secrets)\.([^{}]*?)\s*\}\}/g
const SECRET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** A value that would go out as nothing: null, or text that is only whitespace. */
export function isBlank(value: JsonValue | undefined): boolean {
  return value === null || (typeof value === "string" && value.trim() === "")
}

/**
 * What a run would read that has no usable value, found before anything is sent.
 *
 * It scans the workflow and every workflow its Call Workflow nodes reach —
 * the same set the scheduler resolves secrets for, since a sub-run shares the
 * caller's environment and secrets — and compares the references with the
 * environment the run would use and the secrets the scope chain holds.
 */
export class RunInputChecker {
  constructor(private readonly sources: RunInputSources) {}

  /**
   * `selectedEnvironmentId` follows `runs.create`: undefined runs with the
   * workflow's saved environment, null with none.
   */
  async check(workspaceId: string, workflowId: string, selectedEnvironmentId: string | null | undefined): Promise<RunInputCheck> {
    const workflow = this.sources.workflows.getByIdInWorkspace(workflowId, workspaceId)
    if (workflow === undefined) throw new NotFoundError(`workflow ${workflowId} not found`)

    const environment = this.environmentFor(workspaceId, workflow, selectedEnvironmentId)
    const variables = environment === undefined ? {} : this.sources.environments.resolveEffectiveVariables(environment.environmentId)
    const chain = { ...(environment === undefined ? {} : { environmentId: environment.environmentId }), workspaceId }

    const missing: MissingRunInput[] = []
    for (const [key, usedBy] of collectReferences(workflow, workspaceId, this.sources.workflows)) {
      const [kind, name] = splitKey(key)
      const gap = kind === "env" ? envGap(variables, name) : secretGap(await this.sources.secretState(name, chain))
      if (gap !== undefined) missing.push({ kind, name, ...gap, usedBy })
    }
    missing.sort((left, right) => (left.kind === right.kind ? left.name.localeCompare(right.name) : left.kind === "env" ? -1 : 1))

    return {
      workspaceId,
      workflowId,
      workflowName: workflow.name,
      environment: environment === undefined ? null : { environmentId: environment.environmentId, name: environment.name },
      missing,
    }
  }

  private environmentFor(workspaceId: string, workflow: Workflow, selectedEnvironmentId: string | null | undefined): Environment | undefined {
    const environmentId = selectedEnvironmentId === undefined ? workflow.selectedEnvironmentId ?? null : selectedEnvironmentId
    const found = environmentId === null ? undefined : this.sources.environments.getById(environmentId)
    // An environment from another workspace is one this run cannot use.
    return found !== undefined && found.workspaceId === workspaceId ? found : undefined
  }
}

type Gap = Pick<MissingRunInput, "reason" | "storedIn">

function envGap(variables: Record<string, JsonValue>, name: string): Gap | undefined {
  if (!Object.hasOwn(variables, name)) return { reason: "unset", storedIn: null }
  return isBlank(variables[name]) ? { reason: "empty", storedIn: null } : undefined
}

function secretGap(secret: SecretState): Gap | undefined {
  if (secret.state === "unset") return { reason: "unset", storedIn: null }
  return secret.state === "empty" ? { reason: "empty", storedIn: secret.storedIn } : undefined
}

/** Keyed `env:NAME` / `secret:NAME`, each with the steps that read it. */
function collectReferences(
  root: Workflow,
  workspaceId: string,
  workflows: RunInputSources["workflows"],
): Map<string, RunInputUse[]> {
  const references = new Map<string, RunInputUse[]>()
  const seen = new Set<string>()
  const pending: Workflow[] = [root]
  for (let workflow = pending.pop(); workflow !== undefined; workflow = pending.pop()) {
    if (seen.has(workflow.workflowId)) continue
    seen.add(workflow.workflowId)
    for (const node of withoutCanvasOnlyNodes(workflow.nodes)) {
      const use: RunInputUse = {
        workflowId: workflow.workflowId,
        workflowName: workflow.name,
        nodeId: node.nodeId,
        nodeLabel: node.label || node.nodeId,
      }
      for (const key of nodeReferences(node.config)) references.set(key, [...(references.get(key) ?? []), use])
      const child = calledWorkflow(node, workspaceId, workflows)
      if (child !== undefined) pending.push(child)
    }
  }
  return references
}

/** The same lookup the scheduler makes: a target it cannot reach contributes nothing. */
function calledWorkflow(node: Workflow["nodes"][number], workspaceId: string, workflows: RunInputSources["workflows"]): Workflow | undefined {
  if (node.type !== "workflow") return undefined
  const target = (node.config as Record<string, unknown> | undefined)?.["targetWorkflowId"]
  return typeof target === "string" ? workflows.getByIdInWorkspace(target, workspaceId) : undefined
}

/** The reference key each `{{env.*}}` / `{{secrets.*}}` in `text` names. */
function* textReferences(text: string): Generator<string> {
  for (const match of text.matchAll(REFERENCE_RE)) {
    const path = match[2]!
    if (match[1] === "env") {
      // The root the runner reads: everything before the first `.` key or `[n]` index.
      const name = /^[^.[]*/.exec(path)![0]
      if (name !== "") yield `env:${name}`
    } else if (SECRET_NAME_RE.test(path)) {
      yield `secret:${path}`
    }
  }
}

/** Every reference key in one node's config, once each. */
function nodeReferences(config: unknown): Set<string> {
  const keys = new Set<string>()
  forEachString(config, (text) => {
    for (const key of textReferences(text)) keys.add(key)
  })
  return keys
}

function splitKey(key: string): [MissingRunInput["kind"], string] {
  const separator = key.indexOf(":")
  return [key.slice(0, separator) as MissingRunInput["kind"], key.slice(separator + 1)]
}

/**
 * The refusal in words, for whoever reads only the message — an agent, whose
 * error projection keeps no details. Says where each value goes and who can
 * fix it: an agent can set an environment variable, never a secret.
 */
export function describeMissingRunInputs(refusal: RunInputsRefusal): string {
  const what = refusal.target.kind === "project" ? `Project '${refusal.target.name}' not started` : "Run not started"
  const parts = [`${what}: it reads environment variables or secrets that are not set or are empty. Nothing was sent.`]
  for (const check of refusal.checks) {
    const env = check.missing.filter((item) => item.kind === "env")
    const secrets = check.missing.filter((item) => item.kind === "secret")
    const where = refusal.target.kind === "project" ? `Workflow '${check.workflowName}' (${check.workflowId}): ` : ""
    if (env.length > 0) {
      parts.push(
        check.environment === null
          ? `${where}environment variables ${list(env, "env")} need an environment, and this run has none.`
          : `${where}environment variables ${list(env, "env")} are not set or are empty in environment '${check.environment.name}' (${check.environment.environmentId}).`,
      )
    }
    if (secrets.length > 0) {
      parts.push(
        `${where}secrets ${list(secrets, "secrets")} have no value in ${check.environment === null ? "the workspace" : `environment '${check.environment.name}' or the workspace`}.`,
      )
    }
  }
  if (refusal.checks.some((check) => check.missing.some((item) => item.kind === "secret"))) {
    parts.push("Only the user can add or change a secret, in APIWeave; they have been shown what is missing.")
  }
  return parts.join(" ")
}

function list(items: readonly MissingRunInput[], scope: "env" | "secrets"): string {
  return items.map((item) => `{{${scope}.${item.name}}}${item.reason === "empty" ? " (empty)" : ""}`).join(", ")
}
