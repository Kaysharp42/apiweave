import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase, type InitializedDatabase } from "../../db"
import { RunRepository, WorkflowRepository, WorkspaceRepository } from "../../repositories"
import { AGENT_RUN_DENIED_ERROR, type EnqueueRequest } from "../../runner/scheduler"
import type { InspectedPage } from "../../runner/browser/inspect"
import type { RunTerminalStatus } from "@shared/types/RunProgressEvent"
import { NotFoundError, ValidationError } from "../../ipc/errors"
import { ScopeResolver } from "../scope_resolver"
import { RunService, type RunTrigger } from "../run_service"

/**
 * A scheduler that records the run and answers the inspection with `page`,
 * finishing as `status` — or, with `hold`, never finishing until `finish` is
 * called by the test.
 */
class FakeTrigger implements RunTrigger {
  public readonly cancelled: string[] = []
  public request: EnqueueRequest | undefined
  public runId: string | undefined
  private readonly requests = new Map<string, EnqueueRequest>()
  private readonly finished = new Map<string, (status: RunTerminalStatus) => void>()

  public constructor(
    private readonly runs: RunRepository,
    private readonly outcome: { page?: InspectedPage | null; status?: RunTerminalStatus; error?: string; hold?: boolean },
  ) {}

  public enqueue(request: EnqueueRequest): string {
    this.request = request
    const run = this.runs.create({ workspaceId: request.workspaceId, workflowId: request.workflowId, status: "running" })
    this.runId = run.runId
    this.requests.set(run.runId, request)
    if (!this.outcome.hold) this.finish(run.runId, this.outcome.status ?? "completed", this.outcome.page, this.outcome.error)
    return run.runId
  }

  /** End a held run, handing back its page the way the scheduler does. */
  public finish(runId: string, status: RunTerminalStatus = "completed", page?: InspectedPage | null, error?: string): void {
    if (page !== undefined) this.requests.get(runId)?.inspect?.done(page)
    this.runs.updateStatus(runId, status, error)
    this.finished.get(runId)?.(status)
  }

  public whenFinished(runId: string): Promise<RunTerminalStatus> {
    const status = this.runs.getById(runId)?.status
    if (status !== undefined && status !== "running" && status !== "pending") return Promise.resolve(status)
    return new Promise((resolve) => this.finished.set(runId, resolve))
  }

  public cancel(runId: string): boolean {
    this.cancelled.push(runId)
    this.runs.updateStatus(runId, "cancelled")
    this.finished.get(runId)?.("cancelled")
    return true
  }

  public resultsOf(): [] {
    return []
  }

  public clearIterationResults(): void {}

  public ensureConcurrency(): void {}

  public hasBrowserSteps(): boolean {
    return true
  }
}

const PAGE: InspectedPage = { url: "http://app.test/login", title: "Sign in", ariaSnapshot: '- heading "Sign in" [level=1]\n- button "Sign in"' }

/** A snapshot whose open dialog is the part worth reading, under a main landmark. */
const DIALOG_PAGE: InspectedPage = {
  url: "http://app.test/checkout",
  title: "Checkout",
  ariaSnapshot: [
    "- banner [ref=e1]:",
    '  - heading "Shop" [level=1]',
    "- main [ref=e2]:",
    '  - textbox "Email": ann@example.test',
    '- dialog "Confirm order" [ref=e9]:',
    '  - button "Place order" [ref=e10]',
  ].join("\n"),
}

/** What `scopeAriaSnapshot` extracts from DIALOG_PAGE under "auto" or "dialog". */
const DIALOG_SCOPE = '- dialog "Confirm order" [ref=e9]:\n  - button "Place order" [ref=e10]'

const request = (workflowId: string, waitMs?: number): { workflowId: string; screenshot: boolean; maxBytes: number; waitMs?: number } => ({
  workflowId,
  screenshot: false,
  maxBytes: 16_384,
  ...(waitMs !== undefined ? { waitMs } : {}),
})

describe("RunService.inspectBrowser", () => {
  let db: InitializedDatabase
  let runs: RunRepository
  let workspaceId: string
  let workflowId: string

  beforeEach(() => {
    db = initDatabase({ databasePath: ":memory:" })
    runs = new RunRepository(db.kvStore)
    const workspaces = new WorkspaceRepository(db.kvStore)
    workspaceId = workspaces.create({ name: "Local", slug: "local" }).workspaceId
    workflowId = new WorkflowRepository(db.kvStore).create({ workspaceId, name: "web", nodes: [], edges: [] }).workflowId
  })

  afterEach(() => db.close())

  function service(trigger: RunTrigger): RunService {
    return new RunService(runs, new ScopeResolver({ workspaceExists: () => true, environmentExists: () => true }), trigger)
  }

  it("runs up to the node as the agent that asked, and returns the page", async () => {
    const trigger = new FakeTrigger(runs, { page: PAGE })
    const inspection = await service(trigger).inspectBrowser(
      workspaceId,
      { ...request(workflowId), beforeNodeId: "submit" },
      { agent: "claude-code" },
    )
    expect(trigger.request?.agent).toBe("claude-code")
    expect(trigger.request?.inspect?.beforeNodeId).toBe("submit")
    expect(inspection).toMatchObject({
      status: "completed",
      terminal: true,
      deniedByUser: false,
      stoppedBeforeNodeId: "submit",
      failedNodeIds: [],
      page: { url: PAGE.url, title: "Sign in", ariaSnapshot: { preview: PAGE.ariaSnapshot, previewTruncated: false } },
    })
    expect(inspection.note).toBeUndefined()
    expect(inspection.screenshot).toBeUndefined()
  })

  it("cuts the snapshot at maxBytes and says how to read more", async () => {
    const inspection = await service(new FakeTrigger(runs, { page: PAGE })).inspectBrowser(workspaceId, {
      workflowId,
      screenshot: false,
      maxBytes: 20,
    })
    expect(inspection.page?.ariaSnapshot).toEqual({
      preview: PAGE.ariaSnapshot!.slice(0, 20),
      previewTruncated: true,
      totalBytes: Buffer.byteLength(PAGE.ariaSnapshot!),
      scope: "page",
      scopeNote: "No dialog or main landmark in this ARIA snapshot; returned the whole page.",
    })
    expect(inspection.note).toMatch(/larger maxBytes/)
  })

  it("reports a requested byte window as a window, not as a cut at maxBytes", async () => {
    const windowed = await service(new FakeTrigger(runs, { page: PAGE })).inspectBrowser(workspaceId, {
      ...request(workflowId),
      start: 10,
      end: 25,
      maxBytes: 1024,
    })
    expect(windowed.page?.ariaSnapshot).toMatchObject({
      preview: PAGE.ariaSnapshot!.slice(10, 25),
      previewTruncated: true,
    })
    // Nothing was removed beyond the window the caller asked for.
    expect(windowed.note).toBeUndefined()

    // The cap still speaks for itself when it removes bytes from that window.
    const capped = await service(new FakeTrigger(runs, { page: PAGE })).inspectBrowser(workspaceId, {
      ...request(workflowId),
      start: 10,
      end: 40,
      maxBytes: 4,
    })
    expect(capped.page?.ariaSnapshot?.preview).toBe(PAGE.ariaSnapshot!.slice(10, 14))
    expect(capped.note).toMatch(/cut at 4 bytes/)
  })

  it("scopes the snapshot to the open dialog by default, and windows the scoped text", async () => {
    const trigger = new FakeTrigger(runs, { page: DIALOG_PAGE })
    const inspection = await service(trigger).inspectBrowser(workspaceId, {
      ...request(workflowId),
      // maxBytes tight enough that only the scoped dialog fits: the point of
      // scoping is that the banner and main landmark are not what the preview
      // spends its bytes on.
      maxBytes: Buffer.byteLength(DIALOG_SCOPE, "utf8"),
    })
    expect(inspection.page?.ariaSnapshot).toEqual({
      preview: DIALOG_SCOPE,
      previewTruncated: false,
      totalBytes: Buffer.byteLength(DIALOG_SCOPE, "utf8"),
      scope: "dialog",
      scopeNote: 'A main landmark is also on the page; scope "main" or "page" shows it.',
    })
    expect(inspection.note).toBeUndefined()

    const windowed = await service(new FakeTrigger(runs, { page: DIALOG_PAGE })).inspectBrowser(workspaceId, {
      ...request(workflowId),
      scope: "dialog",
      start: 10,
      end: 25,
    })
    expect(windowed.page?.ariaSnapshot).toMatchObject({
      preview: DIALOG_SCOPE.slice(10, 25),
      previewTruncated: true,
      totalBytes: Buffer.byteLength(DIALOG_SCOPE, "utf8"),
      scope: "dialog",
    })

    // A named scope that is absent falls back to the whole page, with a note.
    const absent = await service(new FakeTrigger(runs, { page: DIALOG_PAGE })).inspectBrowser(workspaceId, {
      ...request(workflowId),
      scope: "main",
    })
    expect(absent.page?.ariaSnapshot).toMatchObject({ scope: "main", preview: '- main [ref=e2]:\n  - textbox "Email": ann@example.test' })
  })

  it("scopes a continued inspection the same way, by runId", async () => {
    const trigger = new FakeTrigger(runs, { hold: true })
    const runService = service(trigger)
    const first = await runService.inspectBrowser(workspaceId, request(workflowId, 10))
    expect(first.terminal).toBe(false)

    trigger.finish(first.runId, "completed", DIALOG_PAGE)
    const second = await runService.inspectBrowser(workspaceId, {
      runId: first.runId,
      screenshot: false,
      maxBytes: 16_384,
      scope: "dialog",
    })
    expect(second.page?.ariaSnapshot).toMatchObject({ preview: DIALOG_SCOPE, scope: "dialog" })
  })

  it("returns the screenshot as base64 JPEG, for the bridge to send as an image", async () => {
    const screenshot = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    const inspection = await service(new FakeTrigger(runs, { page: { ...PAGE, screenshot } })).inspectBrowser(workspaceId, {
      workflowId,
      screenshot: true,
      maxBytes: 16_384,
    })
    expect(inspection.screenshot).toEqual({ mime: "image/jpeg", base64: screenshot.toString("base64") })
  })

  it("says why there is no page", async () => {
    const none = await service(new FakeTrigger(runs, { page: null })).inspectBrowser(workspaceId, {
      ...request(workflowId),
      beforeNodeId: "open",
    })
    expect(none.page).toBeNull()
    expect(none.terminal).toBe(true)
    expect(none.note).toBe("No browser step ran before open, so no page was open. Add a navigate step first.")

    const unread = await service(new FakeTrigger(runs, { status: "failed" })).inspectBrowser(workspaceId, request(workflowId))
    expect(unread.status).toBe("failed")
    expect(unread.note).toBe("The run stopped before the page could be read.")
  })

  it("reports a refused run as deniedByUser, and says to tell the user instead of retrying", async () => {
    const inspection = await service(
      new FakeTrigger(runs, { status: "failed", error: AGENT_RUN_DENIED_ERROR }),
    ).inspectBrowser(workspaceId, request(workflowId))
    expect(inspection).toMatchObject({
      status: "failed",
      terminal: true,
      deniedByUser: true,
      page: null,
      error: AGENT_RUN_DENIED_ERROR,
    })
    // The refusal's note outranks the generic "run stopped" one.
    expect(inspection.note).toBe(
      "The user did not allow this run to send secrets. Tell them, and do not call browser_inspect again for this workflow until they agree.",
    )
  })

  it("returns a non-terminal result at the deadline and leaves the run alone", async () => {
    const trigger = new FakeTrigger(runs, { hold: true })
    const inspection = await service(trigger).inspectBrowser(workspaceId, request(workflowId, 10))
    expect(inspection).toMatchObject({ terminal: false, status: "running", page: null })
    expect(inspection.note).toMatch(/browser_inspect with this runId/)
    // A deadline is not a cancel: the run keeps going, to be read later.
    expect(trigger.cancelled).toEqual([])
    expect(runs.getById(inspection.runId)?.status).toBe("running")
  })

  it("continues an inspection with its runId, and refuses the runId once read", async () => {
    const trigger = new FakeTrigger(runs, { hold: true })
    const runService = service(trigger)
    const first = await runService.inspectBrowser(workspaceId, request(workflowId, 10))
    expect(first.terminal).toBe(false)

    trigger.finish(first.runId, "completed", PAGE)
    const second = await runService.inspectBrowser(workspaceId, {
      runId: first.runId,
      screenshot: false,
      maxBytes: 16_384,
    })
    expect(second).toMatchObject({
      runId: first.runId,
      terminal: true,
      status: "completed",
      page: { url: PAGE.url, title: "Sign in" },
    })

    // The page is held once: a screenshot must not be handed out twice.
    await expect(
      runService.inspectBrowser(workspaceId, { runId: first.runId, screenshot: false, maxBytes: 16_384 }),
    ).rejects.toMatchObject({ name: "NotFoundError", message: expect.stringMatching(/browser_inspect with a workflowId/) })
  })

  it("refuses a run that was not an inspection", async () => {
    const plain = runs.create({ workspaceId, workflowId, status: "completed" })
    await expect(
      service(new FakeTrigger(runs, {})).inspectBrowser(workspaceId, { runId: plain.runId, screenshot: false, maxBytes: 16_384 }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("requires exactly one of workflowId and runId", async () => {
    const serviceUnderTest = service(new FakeTrigger(runs, {}))
    await expect(
      serviceUnderTest.inspectBrowser(workspaceId, { workflowId, runId: "run-1", screenshot: false, maxBytes: 16_384 }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      serviceUnderTest.inspectBrowser(workspaceId, { screenshot: false, maxBytes: 16_384 }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("leaves the run alone when the caller goes away", async () => {
    const trigger = new FakeTrigger(runs, { hold: true })
    const controller = new AbortController()
    const pending = service(trigger).inspectBrowser(workspaceId, request(workflowId, 5_000), { signal: controller.signal })
    while (trigger.runId === undefined) await new Promise((resolve) => setTimeout(resolve, 1))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(trigger.cancelled).toEqual([])
    expect(runs.getById(trigger.runId)?.status).toBe("running")
  })
})
