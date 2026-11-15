import type { BrowserRecordingEvent } from "@shared/types/BrowserRecordingEvent"
import type { BrowserRecordingRequest } from "@shared/types/BrowserRecordingRequest"
import type { BrowserRecordingStatus } from "@shared/types/BrowserRecordingStatus"
import { BrowserRecordingRequestSchema } from "@shared/zod-schemas/BrowserRecordingRequestSchema"
import { ConflictError, NotFoundError, ValidationError } from "../ipc/errors"
import { BrowserRecording, type RecordingOptions } from "../runner/browser/recording"
import type { RecordingValues } from "../runner/browser/recording_values"
import { BROWSER_STEP_PREFIX, type BrowserLaunchSettings } from "../runner/browser/session"
import { extractSecretRefsFromString } from "./secret_utils"

/** The secret store, as far as a recording needs it: names per scope, and the plaintext a run would use. */
export interface RecordingSecrets {
  list(workspaceId: string, scopeType: "workspace" | "environment", scopeId: string): Promise<readonly { readonly name: string }[]>
  resolvePlaintext(name: string, chain: { environmentId?: string; workspaceId?: string }): Promise<{ plaintext: string | null }>
}

export interface BrowserRecordingDeps {
  readonly workflows: { getByIdInWorkspace(workflowId: string, workspaceId: string): { readonly nodes: unknown } | undefined }
  readonly environments: {
    getById(environmentId: string): { readonly workspaceId: string } | undefined
    resolveEffectiveVariables(environmentId: string): Record<string, unknown>
  }
  readonly secrets: RecordingSecrets
  /** Settings > Browser's channel. A recording is always headed: the user is the one clicking. */
  readonly launch: () => Omit<BrowserLaunchSettings, "headless">
  readonly publish: (event: BrowserRecordingEvent) => void
  /** Milliseconds since the epoch, for ids in the canvas's own `<type>-<stamp>` form. */
  readonly now: () => number
  /** Starts the browser; tests replace it. */
  readonly record?: (options: RecordingOptions) => Promise<{ stop(): Promise<void> }>
}

const ENV_PLACEHOLDER = /\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

/**
 * Records a page into browser steps for one workflow at a time.
 *
 * Privileged, and off the router: it opens a window on the user's screen and
 * sees everything typed into it, so no MCP client may reach it. It holds the
 * plaintext of every secret in the workflow's scope for the length of one
 * recording, to recognise one when the user types it; only templates leave.
 * Steps are inserted by the canvas — this never writes a workflow.
 */
export class BrowserRecordingService {
  private active: { readonly status: BrowserRecordingStatus; readonly recording: { stop(): Promise<void> } } | null = null
  private starting = false

  public constructor(private readonly deps: BrowserRecordingDeps) {}

  public status(): BrowserRecordingStatus | null {
    return this.active?.status ?? null
  }

  public async start(input: unknown): Promise<BrowserRecordingStatus> {
    const parsed = BrowserRecordingRequestSchema.safeParse(input)
    if (!parsed.success) throw new ValidationError("This recording request is not valid", parsed.error.issues)
    const request = parsed.data
    if (this.active !== null || this.starting) throw new ConflictError("A recording is already running. Stop it before starting another.")
    this.starting = true
    try {
      return await this.begin(request)
    } finally {
      this.starting = false
    }
  }

  /** Stop the recording, if one is running. Its `ended` event follows. */
  public async stop(): Promise<void> {
    await this.active?.recording.stop()
  }

  private async begin(request: BrowserRecordingRequest): Promise<BrowserRecordingStatus> {
    const workflow = this.deps.workflows.getByIdInWorkspace(request.workflowId, request.workspaceId)
    if (workflow === undefined) throw new NotFoundError(`workflow ${request.workflowId} not found`)
    if (request.environmentId !== null && this.deps.environments.getById(request.environmentId)?.workspaceId !== request.workspaceId) {
      throw new NotFoundError(`environment ${request.environmentId} not found`)
    }
    const values = await this.values(request)
    const startUrl = fillStartUrl(request.startUrl, values.env)
    const stamp = this.deps.now()
    const status: BrowserRecordingStatus = { recordingId: `recording-${stamp}`, workspaceId: request.workspaceId, workflowId: request.workflowId }
    const { recordingId, workflowId } = status
    let next = 0
    // The user can close the browser the moment it opens: `ended` may come before `record` resolves.
    let ended = false
    const record = this.deps.record ?? ((options: RecordingOptions) => BrowserRecording.start(options))
    let recording: { stop(): Promise<void> }
    try {
      recording = await record({
        launch: { ...this.deps.launch(), headless: false },
        startUrl,
        values,
        takenSecretNames: new Set(extractSecretRefsFromString(JSON.stringify(workflow.nodes))),
        newStepId: () => `browser-${stamp}-${++next}`,
        listener: {
          step: (step) => this.deps.publish({ kind: "step", recordingId, workflowId, step }),
          warning: (message) => this.deps.publish({ kind: "warning", recordingId, workflowId, message }),
          ended: () => {
            ended = true
            if (this.active?.status.recordingId === recordingId) this.active = null
            this.deps.publish({ kind: "ended", recordingId, workflowId })
          },
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new ValidationError(`The recording could not start: ${message.replace(`${BROWSER_STEP_PREFIX} `, "")}`)
    }
    if (!ended) this.active = { status, recording }
    return status
  }

  /** The environment's string variables, and the plaintext of every secret its scope chain resolves. */
  private async values(request: BrowserRecordingRequest): Promise<RecordingValues> {
    const env: Record<string, string> = {}
    if (request.environmentId !== null) {
      for (const [key, value] of Object.entries(this.deps.environments.resolveEffectiveVariables(request.environmentId))) {
        if (typeof value === "string") env[key] = value
      }
    }
    const scopes = [
      this.deps.secrets.list(request.workspaceId, "workspace", request.workspaceId),
      ...(request.environmentId !== null ? [this.deps.secrets.list(request.workspaceId, "environment", request.environmentId)] : []),
    ]
    const names = new Set((await Promise.all(scopes)).flat().map((secret) => secret.name))
    const chain = { workspaceId: request.workspaceId, ...(request.environmentId !== null ? { environmentId: request.environmentId } : {}) }
    const secrets: Record<string, string> = {}
    for (const name of names) {
      const { plaintext } = await this.deps.secrets.resolvePlaintext(name, chain)
      if (plaintext !== null && plaintext !== "") secrets[name] = plaintext
    }
    return { env, secrets }
  }
}

/** The start URL with its `{{env.*}}` filled, checked to be a web page. */
function fillStartUrl(template: string, env: Readonly<Record<string, string>>): string {
  const missing: string[] = []
  const url = template.replace(ENV_PLACEHOLDER, (whole, name: string) => {
    const value = env[name]
    if (value === undefined) missing.push(name)
    return value ?? whole
  })
  if (missing.length > 0) throw new ValidationError(`The start address uses ${missing.map((name) => `env.${name}`).join(", ")}, which the selected environment does not define.`)
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ValidationError("The start address is not a valid URL. Use a full address such as https://dev.example.com/login.")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new ValidationError("The start address must begin with http:// or https://.")
  return parsed.toString()
}
