import type { Page } from "playwright-core"
import { describe, expect, it } from "vitest"
import type { BrowserRecordingEvent } from "@shared/types/BrowserRecordingEvent"
import type { NewRecordingOptions, RecordingOptions } from "../../runner/browser/recording"
import { BrowserRecordingService, type BrowserRecordingDeps } from "../browser_recording_service"
import type { ReplayRequest } from "../browser_replay"

const WORKSPACE = "ws-1"
const ENVIRONMENT = "env-1"
const WORKFLOW = "wf-1"
/** Stands in for the page a replay left open: the fakes below never touch it. */
const REPLAYED_PAGE = {} as Page
const DELETE_BUTTON = { kind: "role", role: "button", name: "Delete" } as const

interface Harness {
  readonly service: BrowserRecordingService
  readonly events: BrowserRecordingEvent[]
  readonly started: NewRecordingOptions[]
  readonly attached: RecordingOptions[]
  readonly replays: ReplayRequest[]
  /** How many times a replayed browser was closed. */
  readonly closed: () => number
}

function harness(overrides: Partial<BrowserRecordingDeps> = {}): Harness {
  const events: BrowserRecordingEvent[] = []
  const started: NewRecordingOptions[] = []
  const attached: RecordingOptions[] = []
  const replays: ReplayRequest[] = []
  let closed = 0
  const secretsByScope: Record<string, Array<{ name: string }>> = {
    [WORKSPACE]: [{ name: "TEST_PASSWORD" }, { name: "API_KEY" }],
    [ENVIRONMENT]: [{ name: "API_KEY" }, { name: "EMPTY" }],
  }
  const plaintext: Record<string, string> = { TEST_PASSWORD: "fixture-pass-2468", API_KEY: "env-key-1234", EMPTY: "" }
  const service = new BrowserRecordingService({
    workflows: {
      getByIdInWorkspace: (workflowId, workspaceId) =>
        workflowId === WORKFLOW && workspaceId === WORKSPACE
          ? {
              nodes: [
                { nodeId: "a", type: "browser", config: { action: "fill", value: "{{secrets.UNSET_PASSWORD_1}}" } },
                { nodeId: "open", type: "browser", config: { action: "navigate", url: "{{env.BASE_URL}}/orders" } },
                { nodeId: "delete", type: "browser", config: { action: "click", locator: DELETE_BUTTON, dialog: "accept" } },
                { nodeId: "api", type: "http-request", config: { method: "GET", url: "https://x.test" } },
                { nodeId: "start", type: "start", config: {} },
                { nodeId: "frame", type: "group", config: {} },
                { nodeId: "note", type: "note", config: {} },
              ],
            }
          : undefined,
    },
    environments: {
      getById: (environmentId) => (environmentId === ENVIRONMENT ? { workspaceId: WORKSPACE } : undefined),
      resolveEffectiveVariables: () => ({ BASE_URL: "http://127.0.0.1:4777", TEST_EMAIL: "ada@acme.test", RETRIES: 3 }),
    },
    secrets: {
      list: async (_workspaceId, _scopeType, scopeId) => secretsByScope[scopeId] ?? [],
      resolvePlaintext: async (name) => ({ plaintext: plaintext[name] ?? null }),
    },
    launch: () => ({ channel: "msedge" }),
    publish: (event) => events.push(event),
    now: () => 1_700_000_000_000,
    record: async (options) => {
      started.push(options)
      return { stop: async () => options.listener.ended() }
    },
    replay: async (replayRequest) => {
      replays.push(replayRequest)
      return { kind: "page", page: REPLAYED_PAGE, close: async () => void closed++ }
    },
    attach: async (_page, options) => {
      attached.push(options)
      return { stop: async () => options.listener.ended() }
    },
    pick: async () => ({ kind: "locator", locator: { kind: "role", role: "button", name: "Remove" } }),
    ...overrides,
  })
  return { service, events, started, attached, replays, closed: () => closed }
}

const request = { workspaceId: WORKSPACE, workflowId: WORKFLOW, environmentId: ENVIRONMENT, startUrl: "{{env.BASE_URL}}/login" }

describe("BrowserRecordingService", () => {
  it("starts a headed recording with the environment's values and every secret in scope", async () => {
    const { service, started } = harness()
    const status = await service.start(request)
    expect(status).toEqual({ recordingId: "recording-1700000000000", workspaceId: WORKSPACE, workflowId: WORKFLOW, operation: "record" })
    expect(service.status()).toEqual(status)
    const options = started[0]
    expect(options?.launch).toEqual({ channel: "msedge", headless: false })
    expect(options?.startUrl).toBe("http://127.0.0.1:4777/login")
    expect(options?.values).toEqual({
      env: { BASE_URL: "http://127.0.0.1:4777", TEST_EMAIL: "ada@acme.test" },
      secrets: { TEST_PASSWORD: "fixture-pass-2468", API_KEY: "env-key-1234" },
    })
    expect([...(options?.takenSecretNames ?? [])]).toEqual(["UNSET_PASSWORD_1"])
    expect([options?.newStepId(), options?.newStepId()]).toEqual(["browser-1700000000000-1", "browser-1700000000000-2"])
  })

  it("publishes steps, warnings and the end under the recording's ids, and frees the slot when it ends", async () => {
    const { service, events, started } = harness()
    await service.start(request)
    const listener = started[0]?.listener
    listener?.step({ stepId: "browser-1", config: { action: "navigate", url: "{{env.BASE_URL}}/login" } })
    listener?.warning("popup")
    await service.stop()
    expect(events.map((event) => event.kind)).toEqual(["step", "warning", "ended"])
    expect(events.every((event) => event.recordingId === "recording-1700000000000" && event.workflowId === WORKFLOW)).toBe(true)
    expect(service.status()).toBeNull()
  })

  it("runs one recording at a time", async () => {
    const { service } = harness()
    await service.start(request)
    await expect(service.start(request)).rejects.toThrow(/already running/)
    await service.stop()
    await expect(service.start(request)).resolves.toBeDefined()
  })

  it("is free again when the browser is closed before the start returns", async () => {
    const { service } = harness({
      record: async (options) => {
        options.listener.ended()
        return { stop: async () => undefined }
      },
    })
    await service.start(request)
    expect(service.status()).toBeNull()
  })

  it("publishes nothing when the start fails, though the recorder had already sent a step", async () => {
    const { service, events } = harness({
      record: async (options) => {
        options.listener.step({ stepId: "browser-1", config: { action: "navigate", url: "{{env.BASE_URL}}/login" } })
        options.listener.warning("popup")
        options.listener.ended()
        throw new Error("Browser step: the start page could not be opened: net::ERR_CONNECTION_REFUSED")
      },
    })
    await expect(service.start(request)).rejects.toThrow(/could not start: the start page could not be opened/)
    expect(events).toEqual([])
    expect(service.status()).toBeNull()
  })

  it("publishes what the recorder sent before the start returned, in order, once it has", async () => {
    let reported: () => void = () => undefined
    let release: () => void = () => undefined
    const emitted = new Promise<void>((resolve) => (reported = resolve))
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { service, events } = harness({
      record: async (options) => {
        options.listener.step({ stepId: "browser-1", config: { action: "navigate", url: "{{env.BASE_URL}}/login" } })
        options.listener.warning("popup")
        // The user closes the browser the moment it opens.
        options.listener.ended()
        reported()
        await gate
        return { stop: async () => undefined }
      },
    })
    const starting = service.start(request)
    await emitted
    expect(events).toEqual([])
    release()
    await expect(starting).resolves.toBeDefined()
    expect(events.map((event) => event.kind)).toEqual(["step", "warning", "ended"])
    expect(events.every((event) => event.recordingId === "recording-1700000000000" && event.workflowId === WORKFLOW)).toBe(true)
    expect(service.status()).toBeNull()
  })

  it("works without an environment: no variables, workspace secrets only", async () => {
    const { service, started } = harness()
    await service.start({ ...request, environmentId: null, startUrl: "https://dev.example.com" })
    expect(started[0]?.values).toEqual({ env: {}, secrets: { TEST_PASSWORD: "fixture-pass-2468", API_KEY: "env-key-1234" } })
    expect(started[0]?.startUrl).toBe("https://dev.example.com/")
  })

  it.each([
    [{ ...request, startUrl: "{{env.MISSING}}/x" }, /env\.MISSING/],
    [{ ...request, startUrl: "dev.example.com" }, /not a valid URL/],
    [{ ...request, startUrl: "file:///etc/hosts" }, /http:\/\/ or https:\/\//],
    [{ ...request, workflowId: "other" }, /workflow other not found/],
    [{ ...request, environmentId: "env-elsewhere" }, /environment env-elsewhere not found/],
    [{ ...request, extra: true }, /not valid/],
  ])("refuses %j", async (input, message) => {
    const { service, started } = harness()
    await expect(service.start(input)).rejects.toThrow(message)
    expect(started).toEqual([])
    expect(service.status()).toBeNull()
  })

  it("says why the browser could not start, without the run's prefix, and stays free", async () => {
    const { service } = harness({
      record: async () => {
        throw new Error("Browser step: Microsoft Edge was not found on this machine.")
      },
    })
    await expect(service.start(request)).rejects.toThrow("The recording could not start: Microsoft Edge was not found on this machine.")
    expect(service.status()).toBeNull()
  })
})

const replayRequest = { workspaceId: WORKSPACE, workflowId: WORKFLOW, environmentId: ENVIRONMENT, nodeId: "delete" }

/** A replay that runs until Stop aborts it, as a slow run would. */
const replayUntilStopped: BrowserRecordingDeps["replay"] = (_request, signal) =>
  new Promise((resolve) => signal.addEventListener("abort", () => resolve({ kind: "failed", runId: "run-1", status: "cancelled" })))

describe("BrowserRecordingService.repick", () => {
  it("replays up to the step, lets the user pick, and hands the locator over as an event before the end", async () => {
    const { service, events, replays, closed } = harness()
    await expect(service.repick(replayRequest)).resolves.toBeUndefined()
    expect(replays).toEqual([{ workspaceId: WORKSPACE, workflowId: WORKFLOW, environmentId: ENVIRONMENT, stop: { beforeNodeId: "delete" } }])
    expect(events.map((event) => event.kind)).toEqual(["replayed", "picked", "ended"])
    expect(events[1]).toEqual({
      kind: "picked",
      recordingId: "recording-1700000000000",
      workflowId: WORKFLOW,
      nodeId: "delete",
      locator: { kind: "role", role: "button", name: "Remove" },
    })
    expect(closed()).toBe(1)
    expect(service.status()).toBeNull()
  })

  it("picks with the environment's values and the secrets in scope", async () => {
    let seen: unknown
    const { service } = harness({
      pick: async (_page, values) => {
        seen = values
        return { kind: "cancelled" }
      },
    })
    await expect(service.repick(replayRequest)).resolves.toBeUndefined()
    expect(seen).toEqual({
      env: { BASE_URL: "http://127.0.0.1:4777", TEST_EMAIL: "ada@acme.test" },
      secrets: { TEST_PASSWORD: "fixture-pass-2468", API_KEY: "env-key-1234" },
    })
  })

  it("hands over nothing when the user cancels the pick", async () => {
    const { service, events, closed } = harness({ pick: async () => ({ kind: "cancelled" }) })
    await expect(service.repick(replayRequest)).resolves.toBeUndefined()
    expect(events.map((event) => event.kind)).toEqual(["replayed", "ended"])
    expect(closed()).toBe(1)
    expect(service.status()).toBeNull()
  })

  it.each([
    ["a step with no element", "open", /nothing to re-pick/],
    ["another kind of node", "api", /complete browser step/],
    ["an incomplete browser step", "a", /complete browser step/],
    ["a step that is not in the saved workflow", "gone", /step gone not found/],
  ])("refuses %s, and replays nothing", async (_what, nodeId, message) => {
    const { service, replays } = harness()
    await expect(service.repick({ ...replayRequest, nodeId })).rejects.toThrow(message)
    expect(replays).toEqual([])
    expect(service.status()).toBeNull()
  })

  it("is stopped during the replay: cancelled, not an error, and the slot is free", async () => {
    const { service, events } = harness({ replay: replayUntilStopped })
    const repicking = service.repick(replayRequest)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(service.status()).toMatchObject({ operation: "repick", nodeId: "delete" })
    await service.stop()
    await expect(repicking).resolves.toBeUndefined()
    expect(events.map((event) => event.kind)).toEqual(["ended"])
    expect(service.status()).toBeNull()
  })

  it("is stopped while the user picks: the browser closes and nothing is picked", async () => {
    let closePicker: () => void = () => undefined
    const { service, events } = harness({
      replay: async () => ({ kind: "page", page: REPLAYED_PAGE, close: async () => closePicker() }),
      pick: () => new Promise((resolve) => (closePicker = () => resolve({ kind: "cancelled" }))),
    })
    const repicking = service.repick(replayRequest)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await service.stop()
    await expect(repicking).resolves.toBeUndefined()
    expect(events.map((event) => event.kind)).toEqual(["replayed", "ended"])
  })

  it.each([
    [{ kind: "failed", runId: "run-1", status: "failed" } as const, /did not pass/],
    [{ kind: "no-page" } as const, /No browser step before this one opens a page/],
  ])("says why there is no page to pick from: %j", async (outcome, message) => {
    const { service, events } = harness({ replay: async () => outcome })
    await expect(service.repick(replayRequest)).rejects.toThrow(message)
    expect(events.map((event) => event.kind)).toEqual(["ended"])
    expect(service.status()).toBeNull()
  })

  it.each([
    [{ kind: "secret" } as const, /shows a secret value/],
    [{ kind: "undescribable" } as const, /could not be described/],
  ])("does not hand back a pick it cannot store: %j", async (outcome, message) => {
    const { service, events, closed } = harness({ pick: async () => outcome })
    await expect(service.repick(replayRequest)).rejects.toThrow(message)
    expect(events.map((event) => event.kind)).toEqual(["replayed", "ended"])
    expect(closed()).toBe(1)
    expect(service.status()).toBeNull()
  })

  it("shares the one slot with recording", async () => {
    const { service } = harness()
    await service.start(request)
    await expect(service.repick(replayRequest)).rejects.toThrow(/already running/)
  })
})

describe("BrowserRecordingService.rerecord", () => {
  it("replays up to the step, then records from that page under the recording's ids", async () => {
    const { service, events, attached } = harness()
    const status = await service.rerecord(replayRequest)
    expect(status).toEqual({
      recordingId: "recording-1700000000000",
      workspaceId: WORKSPACE,
      workflowId: WORKFLOW,
      operation: "rerecord",
      nodeId: "delete",
    })
    expect(service.status()).toEqual(status)
    const options = attached[0]
    expect(options?.newStepId()).toBe("browser-1700000000000-1")
    expect(options?.values.env).toMatchObject({ BASE_URL: "http://127.0.0.1:4777" })
    options?.listener.step({ stepId: "browser-1700000000000-1", config: { action: "click", locator: DELETE_BUTTON } })
    await service.stop()
    expect(events.map((event) => event.kind)).toEqual(["replayed", "step", "ended"])
    expect(service.status()).toBeNull()
  })

  it("re-records from a step with no element, such as opening a page", async () => {
    const { service } = harness()
    await expect(service.rerecord({ ...replayRequest, nodeId: "open" })).resolves.toMatchObject({ nodeId: "open" })
  })

  it("closes the browser and frees the slot when recording cannot start on the page", async () => {
    const { service, events, closed } = harness({
      attach: async () => {
        throw new Error("Browser step: the replayed page has no browser to record in")
      },
    })
    await expect(service.rerecord(replayRequest)).rejects.toThrow("The recording could not start: the replayed page has no browser to record in")
    expect(closed()).toBe(1)
    // Only the end: no `replayed`, or the canvas would say both that it is
    // recording and that nothing was re-recorded.
    expect(events.map((event) => event.kind)).toEqual(["ended"])
    expect(service.status()).toBeNull()
  })

  it("is stopped during the replay: null, and no recording starts", async () => {
    const { service, attached } = harness({ replay: replayUntilStopped })
    const rerecording = service.rerecord(replayRequest)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await service.stop()
    await expect(rerecording).resolves.toBeNull()
    expect(attached).toEqual([])
  })

  it("re-records from an incomplete browser step, which recording replaces anyway", async () => {
    const { service, events } = harness()
    await expect(service.rerecord({ ...replayRequest, nodeId: "a" })).resolves.toMatchObject({ operation: "rerecord", nodeId: "a" })
    await service.stop()
    expect(events.map((event) => event.kind)).toEqual(["replayed", "ended"])
  })

  it("is stopped while the secrets are read: nothing is replayed, and the slot is free", async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { service, events, replays, attached } = harness({
      secrets: {
        list: async () => [{ name: "TEST_PASSWORD" }],
        resolvePlaintext: async () => {
          await gate
          return { plaintext: "read-too-late" }
        },
      },
    })
    const rerecording = service.rerecord(replayRequest)
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The operation exists, and Stop reaches it, before the replay could start.
    expect(service.status()).toMatchObject({ operation: "rerecord", nodeId: "delete" })
    await service.stop()
    release()
    await expect(rerecording).resolves.toBeNull()
    expect(replays).toEqual([])
    expect(attached).toEqual([])
    expect(events.map((event) => event.kind)).toEqual(["ended"])
    expect(service.status()).toBeNull()
    await expect(service.rerecord(replayRequest)).resolves.toMatchObject({ operation: "rerecord", nodeId: "delete" })
    await service.stop()
  })

  it.each([
    ["another kind of node", "api", /Only a browser step can be re-recorded from/],
    ["a step that is not in the saved workflow", "gone", /step gone not found/],
  ])("refuses %s, and replays nothing", async (_what, nodeId, message) => {
    const { service, replays } = harness()
    await expect(service.rerecord({ ...replayRequest, nodeId })).rejects.toThrow(message)
    expect(replays).toEqual([])
    expect(service.status()).toBeNull()
  })
})

describe("BrowserRecordingService.recordAfter", () => {
  it("replays through the step, then records from the page it left under the recording's ids", async () => {
    const { service, events, attached, replays } = harness()
    const status = await service.recordAfter(replayRequest)
    expect(status).toEqual({
      recordingId: "recording-1700000000000",
      workspaceId: WORKSPACE,
      workflowId: WORKFLOW,
      operation: "record-after",
      nodeId: "delete",
    })
    expect(replays).toEqual([{ workspaceId: WORKSPACE, workflowId: WORKFLOW, environmentId: ENVIRONMENT, stop: { afterNodeId: "delete" } }])
    expect(attached[0]?.newStepId()).toBe("browser-1700000000000-1")
    await service.stop()
    expect(events.map((event) => event.kind)).toEqual(["replayed", "ended"])
    expect(service.status()).toBeNull()
  })

  it("records after a node of another kind", async () => {
    const { service } = harness()
    await expect(service.recordAfter({ ...replayRequest, nodeId: "api" })).resolves.toMatchObject({ operation: "record-after", nodeId: "api" })
    await service.stop()
  })

  it.each([["start"], ["frame"], ["note"]])("refuses %s, which a run never stops after, before replaying anything", async (nodeId) => {
    const { service, replays } = harness()
    await expect(service.recordAfter({ ...replayRequest, nodeId })).rejects.toThrow("Steps can only be recorded after a step that runs.")
    expect(replays).toEqual([])
  })

  it("says the step itself is replayed when the replay fails or opens no page", async () => {
    const failed = harness({ replay: async () => ({ kind: "failed", runId: "run-1", status: "failed" }) })
    await expect(failed.service.recordAfter(replayRequest)).rejects.toThrow(/^The steps up to and including this one did not pass/)
    const blank = harness({ replay: async () => ({ kind: "no-page" }) })
    await expect(blank.service.recordAfter(replayRequest)).rejects.toThrow(/No browser step up to this one opens a page/)
    expect(blank.service.status()).toBeNull()
  })

  it("shares the one slot with recording", async () => {
    const { service } = harness()
    await service.start(request)
    await expect(service.recordAfter(replayRequest)).rejects.toThrow(/already running/)
  })
})
