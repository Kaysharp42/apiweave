import type { Page } from "playwright-core"
import type { BrowserLocator } from "@shared/types/BrowserLocator"
import type { BrowserNodeData } from "@shared/types/BrowserNodeData"
import type { BrowserRecordingEvent } from "@shared/types/BrowserRecordingEvent"
import type { BrowserRecordingRequest } from "@shared/types/BrowserRecordingRequest"
import type { BrowserRecordingStatus } from "@shared/types/BrowserRecordingStatus"
import type { BrowserReplayRequest } from "@shared/types/BrowserReplayRequest"
import { BrowserNodeDataSchema } from "@shared/zod-schemas/BrowserNodeDataSchema"
import { BrowserRecordingRequestSchema } from "@shared/zod-schemas/BrowserRecordingRequestSchema"
import { BrowserReplayRequestSchema } from "@shared/zod-schemas/BrowserReplayRequestSchema"
import { ConflictError, NotFoundError, ValidationError } from "../ipc/errors"
import { pickElement, type PickOutcome } from "../runner/browser/pick"
import { BrowserRecording, type NewRecordingOptions, type RecordingListener, type RecordingOptions } from "../runner/browser/recording"
import type { RecordingValues } from "../runner/browser/recording_values"
import { BROWSER_STEP_PREFIX, type BrowserLaunchSettings } from "../runner/browser/session"
import type { ReplayOutcome, ReplayRequest } from "./browser_replay"
import { extractSecretRefsFromString } from "./secret_utils"

/** The secret store, as far as a recording needs it: names per scope, and the plaintext a run would use. */
export interface RecordingSecrets {
  list(workspaceId: string, scopeType: "workspace" | "environment", scopeId: string): Promise<readonly { readonly name: string }[]>
  resolvePlaintext(name: string, chain: { environmentId?: string; workspaceId?: string }): Promise<{ plaintext: string | null }>
}

/** A recording, as far as the service drives it. */
interface RunningRecording {
  stop(): Promise<void>
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
  /** Run the workflow up to a node in a headed browser that stays open (`replayToNode`). */
  readonly replay: (request: ReplayRequest, signal: AbortSignal) => Promise<ReplayOutcome>
  /** Starts the browser; tests replace it. */
  readonly record?: (options: NewRecordingOptions) => Promise<RunningRecording>
  /** Records on a replayed page; tests replace it. */
  readonly attach?: (page: Page, options: RecordingOptions) => Promise<RunningRecording>
  /** Lets the user pick an element of a replayed page; tests replace it. */
  readonly pick?: (page: Page, values: RecordingValues) => Promise<PickOutcome>
}

const ENV_PLACEHOLDER = /\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

/** The one operation in progress, and how to end it at whatever stage it has reached. */
interface Active {
  readonly status: BrowserRecordingStatus
  stop: () => Promise<void>
}

/**
 * Records a page into browser steps, re-picks a step's element and re-records
 * from a step, for one workflow at a time.
 *
 * Privileged, and off the router: it opens a window on the user's screen and
 * sees everything typed into it, so no MCP client may reach it. It holds the
 * plaintext of every secret in the workflow's scope for the length of one
 * operation, to recognise one when the user types it; only templates leave.
 * Steps and locators go to the canvas, which edits the workflow — this never
 * writes one.
 */
export class BrowserRecordingService {
  private active: Active | null = null
  private starting = false

  public constructor(private readonly deps: BrowserRecordingDeps) {}

  public status(): BrowserRecordingStatus | null {
    return this.active?.status ?? null
  }

  /** Open a browser on the start address and record what the user does into steps. */
  public async start(input: unknown): Promise<BrowserRecordingStatus> {
    const parsed = BrowserRecordingRequestSchema.safeParse(input)
    if (!parsed.success) throw new ValidationError("This recording request is not valid", parsed.error.issues)
    return this.exclusively(() => this.begin(parsed.data))
  }

  /**
   * Replay the workflow up to a browser step, then let the user pick the
   * element that step should act on. Resolves with its locator — the canvas
   * puts it on the step — or null when the user cancelled.
   */
  public async repick(input: unknown): Promise<BrowserLocator | null> {
    const request = this.replayRequest(input)
    const config = this.browserStep(request)
    if (!("locator" in config)) throw new ValidationError("This step does not act on an element, so there is nothing to re-pick.")
    return this.exclusively(async () => {
      const values = await this.values(request)
      const replayed = await this.replayed(request, "repick")
      if (replayed === null) return null
      const { page, close, active } = replayed
      try {
        return pickedLocator(await (this.deps.pick ?? pickElement)(page, values))
      } finally {
        await close()
        this.end(active)
      }
    })
  }

  /**
   * Replay the workflow up to a browser step, then record from the page it
   * left. The canvas replaces that step and the browser steps after it with
   * what is recorded, once the first step arrives.
   */
  public async rerecord(input: unknown): Promise<BrowserRecordingStatus | null> {
    const request = this.replayRequest(input)
    this.browserStep(request)
    return this.exclusively(async () => {
      const values = await this.values(request)
      const replayed = await this.replayed(request, "rerecord")
      if (replayed === null) return null
      const { page, close, active } = replayed
      const attach = this.deps.attach ?? ((target: Page, options: RecordingOptions) => BrowserRecording.attach(target, options))
      const publisher = this.publisher(active)
      try {
        const recording = await attach(page, this.recordingOptions(active.status, values, publisher.listener))
        active.stop = () => recording.stop()
        publisher.release()
        return publisher.wasEnded() ? null : active.status
      } catch (error) {
        await close()
        this.end(active)
        throw new ValidationError(`The recording could not start: ${messageOf(error)}`)
      }
    })
  }

  /** Stop whatever is in progress: cancel the replay, close the picking browser, or end the recording. */
  public async stop(): Promise<void> {
    await this.active?.stop()
  }

  /** Run `work` as the only operation, refusing one while another is starting or running. */
  private async exclusively<T>(work: () => Promise<T>): Promise<T> {
    if (this.active !== null || this.starting) throw new ConflictError("A recording is already running. Stop it before starting another.")
    this.starting = true
    try {
      return await work()
    } finally {
      this.starting = false
    }
  }

  private async begin(request: BrowserRecordingRequest): Promise<BrowserRecordingStatus> {
    const workflow = this.deps.workflows.getByIdInWorkspace(request.workflowId, request.workspaceId)
    if (workflow === undefined) throw new NotFoundError(`workflow ${request.workflowId} not found`)
    this.checkEnvironment(request)
    const values = await this.values(request)
    const startUrl = fillStartUrl(request.startUrl, values.env)
    const active: Active = { status: this.newStatus(request, "record"), stop: async () => undefined }
    const publisher = this.publisher(active)
    const record = this.deps.record ?? ((options: NewRecordingOptions) => BrowserRecording.start(options))
    let recording: RunningRecording
    try {
      recording = await record({
        ...this.recordingOptions(active.status, values, publisher.listener),
        launch: { ...this.deps.launch(), headless: false },
        startUrl,
      })
    } catch (error) {
      // What a failed start reported is held, and dropped with this frame.
      throw new ValidationError(`The recording could not start: ${messageOf(error)}`)
    }
    active.stop = () => recording.stop()
    publisher.release()
    if (!publisher.wasEnded()) this.active = active
    return active.status
  }

  /**
   * The events of one recording. A recording can report a step before its
   * start has returned — the navigate for the start page arrives as the page
   * loads — so every event is held until `release`: a start that then fails
   * leaves no step, no warning and no end on the canvas. The user can close the
   * browser the moment it opens, so `ended` may come before the start returns.
   */
  private publisher(active: Active): { listener: RecordingListener; release: () => void; wasEnded: () => boolean } {
    const { recordingId, workflowId } = active.status
    let holding = true
    let ended = false
    const held: BrowserRecordingEvent[] = []
    const publish = (event: BrowserRecordingEvent): void => {
      if (holding) held.push(event)
      else this.deps.publish(event)
    }
    return {
      listener: {
        step: (step) => publish({ kind: "step", recordingId, workflowId, step }),
        warning: (message) => publish({ kind: "warning", recordingId, workflowId, message }),
        ended: () => {
          ended = true
          if (this.active === active) this.active = null
          publish({ kind: "ended", recordingId, workflowId })
        },
      },
      release: () => {
        holding = false
        for (const event of held) this.deps.publish(event)
      },
      wasEnded: () => ended,
    }
  }

  /** Step ids are `browser-<stamp>-<n>` for a recording `recording-<stamp>`: the canvas finds a recording's steps by them after a reload. */
  private recordingOptions(status: BrowserRecordingStatus, values: RecordingValues, listener: RecordingListener): RecordingOptions {
    const workflow = this.deps.workflows.getByIdInWorkspace(status.workflowId, status.workspaceId)
    const stamp = status.recordingId.replace(/^recording-/, "")
    let next = 0
    return {
      values,
      takenSecretNames: new Set(extractSecretRefsFromString(JSON.stringify(workflow?.nodes ?? []))),
      newStepId: () => `browser-${stamp}-${++next}`,
      listener,
    }
  }

  /**
   * Replay up to the request's step, as the active operation, so Stop cancels
   * the run. The page it left, or null when the user stopped it; throws when
   * the steps before failed or opened no page.
   */
  private async replayed(
    request: BrowserReplayRequest,
    operation: "repick" | "rerecord",
  ): Promise<{ page: Page; close: () => Promise<void>; active: Active } | null> {
    const controller = new AbortController()
    const active: Active = { status: this.newStatus(request, operation), stop: async () => controller.abort() }
    this.active = active
    let outcome: ReplayOutcome
    try {
      outcome = await this.deps.replay({ ...request, beforeNodeId: request.nodeId }, controller.signal)
    } catch (error) {
      this.end(active)
      throw new ValidationError(`The steps before this one could not be replayed: ${messageOf(error)}`)
    }
    if (outcome.kind !== "page") {
      this.end(active)
      if (outcome.kind === "failed" && outcome.status === "cancelled") return null
      throw new ValidationError(
        outcome.kind === "no-page"
          ? "No browser step before this one opens a page. Re-pick and re-record start from the page the steps before leave open: use Record instead."
          : "The steps before this one did not pass, so there is no page to continue from. The run is in the run history: fix the step that failed first.",
      )
    }
    const { recordingId, workflowId } = active.status
    active.stop = () => outcome.close()
    this.deps.publish({ kind: "replayed", recordingId, workflowId })
    return { page: outcome.page, close: outcome.close, active }
  }

  /** Free the slot and tell the canvas, unless something else has taken it since. */
  private end(active: Active): void {
    if (this.active !== active) return
    this.active = null
    const { recordingId, workflowId } = active.status
    this.deps.publish({ kind: "ended", recordingId, workflowId })
  }

  private newStatus(request: { readonly workspaceId: string; readonly workflowId: string; readonly nodeId?: string }, operation: BrowserRecordingStatus["operation"]): BrowserRecordingStatus {
    return {
      recordingId: `recording-${this.deps.now()}`,
      workspaceId: request.workspaceId,
      workflowId: request.workflowId,
      operation,
      ...(request.nodeId !== undefined ? { nodeId: request.nodeId } : {}),
    }
  }

  private replayRequest(input: unknown): BrowserReplayRequest {
    const parsed = BrowserReplayRequestSchema.safeParse(input)
    if (!parsed.success) throw new ValidationError("This request is not valid", parsed.error.issues)
    return parsed.data
  }

  /** The request's step, which must be a valid browser step of the workflow in the request's workspace. */
  private browserStep(request: BrowserReplayRequest): BrowserNodeData {
    const workflow = this.deps.workflows.getByIdInWorkspace(request.workflowId, request.workspaceId)
    if (workflow === undefined) throw new NotFoundError(`workflow ${request.workflowId} not found`)
    this.checkEnvironment(request)
    const nodes = Array.isArray(workflow.nodes) ? (workflow.nodes as readonly unknown[]) : []
    const node = nodes.find((candidate): candidate is { nodeId: string; type?: unknown; config?: unknown } =>
      typeof candidate === "object" && candidate !== null && (candidate as { nodeId?: unknown }).nodeId === request.nodeId,
    )
    if (node === undefined) throw new NotFoundError(`step ${request.nodeId} not found. Save the workflow and try again.`)
    const config = BrowserNodeDataSchema.safeParse(node.config)
    if (node.type !== "browser" || !config.success) throw new ValidationError("Only a complete browser step can be re-picked or re-recorded from.")
    return config.data
  }

  private checkEnvironment(request: { readonly workspaceId: string; readonly environmentId: string | null }): void {
    if (request.environmentId !== null && this.deps.environments.getById(request.environmentId)?.workspaceId !== request.workspaceId) {
      throw new NotFoundError(`environment ${request.environmentId} not found`)
    }
  }

  /** The environment's string variables, and the plaintext of every secret its scope chain resolves. */
  private async values(request: { readonly workspaceId: string; readonly environmentId: string | null }): Promise<RecordingValues> {
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

/** The locator a pick produced, null when cancelled; a pick that cannot be stored says why. */
function pickedLocator(outcome: PickOutcome): BrowserLocator | null {
  switch (outcome.kind) {
    case "locator":
      return outcome.locator
    case "cancelled":
      return null
    case "secret":
      throw new ValidationError("The element you picked shows a secret value, so its locator was not saved. Pick an element near it instead.")
    case "undescribable":
      throw new ValidationError("The element you picked could not be described as a locator. Pick another one, or edit the step's element by hand.")
  }
}

/** A failure's first line, without the browser-step prefix a toast does not need. */
function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(`${BROWSER_STEP_PREFIX} `, "")
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
