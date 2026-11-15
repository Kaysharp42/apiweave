import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase, type InitializedDatabase } from "../../db"
import { RunRepository, WorkflowRepository, WorkspaceRepository } from "../../repositories"
import type { EnqueueRequest } from "../../runner/scheduler"
import type { InspectedPage } from "../../runner/browser/inspect"
import type { RunTerminalStatus } from "@shared/types/RunProgressEvent"
import { ScopeResolver } from "../scope_resolver"
import { RunService, type RunTrigger } from "../run_service"

/**
 * A scheduler that records the run and answers the inspection with `page`,
 * finishing as `status` — or, with `hold`, never finishing until cancelled.
 */
class FakeTrigger implements RunTrigger {
  public readonly cancelled: string[] = []
  public request: EnqueueRequest | undefined
  private readonly finished = new Map<string, (status: RunTerminalStatus) => void>()

  public constructor(
    private readonly runs: RunRepository,
    private readonly outcome: { page?: InspectedPage | null; status?: RunTerminalStatus; hold?: boolean },
  ) {}

  public enqueue(request: EnqueueRequest): string {
    this.request = request
    const run = this.runs.create({ workspaceId: request.workspaceId, workflowId: request.workflowId, status: "running" })
    if (!this.outcome.hold) {
      if (this.outcome.page !== undefined) request.inspect?.done(this.outcome.page)
      this.runs.updateStatus(run.runId, this.outcome.status ?? "completed")
    }
    return run.runId
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
      { workflowId, beforeNodeId: "submit", screenshot: false, maxBytes: 16_384 },
      { agent: "claude-code" },
    )
    expect(trigger.request?.agent).toBe("claude-code")
    expect(trigger.request?.inspect?.beforeNodeId).toBe("submit")
    expect(inspection).toMatchObject({
      status: "completed",
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
    })
    expect(inspection.note).toMatch(/larger maxBytes/)
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
      workflowId,
      beforeNodeId: "open",
      screenshot: false,
      maxBytes: 16_384,
    })
    expect(none.page).toBeNull()
    expect(none.note).toBe("No browser step ran before open, so no page was open. Add a navigate step first.")

    const unread = await service(new FakeTrigger(runs, { status: "failed" })).inspectBrowser(workspaceId, {
      workflowId,
      screenshot: false,
      maxBytes: 16_384,
    })
    expect(unread.status).toBe("failed")
    expect(unread.note).toBe("The run stopped before the page could be read.")
  })

  it("cancels the run when the caller goes away: nobody would read the page", async () => {
    const trigger = new FakeTrigger(runs, { hold: true })
    const controller = new AbortController()
    const pending = service(trigger).inspectBrowser(workspaceId, { workflowId, screenshot: false, maxBytes: 16_384 }, { signal: controller.signal })
    while (trigger.request === undefined) await new Promise((resolve) => setTimeout(resolve, 1))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(trigger.cancelled).toHaveLength(1)
  })
})
