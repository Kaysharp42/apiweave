import { describe, expect, it } from "vitest"
import type { BrowserRecordingEvent } from "@shared/types/BrowserRecordingEvent"
import type { RecordingOptions } from "../../runner/browser/recording"
import { BrowserRecordingService, type BrowserRecordingDeps } from "../browser_recording_service"

const WORKSPACE = "ws-1"
const ENVIRONMENT = "env-1"
const WORKFLOW = "wf-1"

interface Harness {
  readonly service: BrowserRecordingService
  readonly events: BrowserRecordingEvent[]
  readonly started: RecordingOptions[]
}

function harness(overrides: Partial<BrowserRecordingDeps> = {}): Harness {
  const events: BrowserRecordingEvent[] = []
  const started: RecordingOptions[] = []
  const secretsByScope: Record<string, Array<{ name: string }>> = {
    [WORKSPACE]: [{ name: "TEST_PASSWORD" }, { name: "API_KEY" }],
    [ENVIRONMENT]: [{ name: "API_KEY" }, { name: "EMPTY" }],
  }
  const plaintext: Record<string, string> = { TEST_PASSWORD: "fixture-pass-2468", API_KEY: "env-key-1234", EMPTY: "" }
  const service = new BrowserRecordingService({
    workflows: {
      getByIdInWorkspace: (workflowId, workspaceId) =>
        workflowId === WORKFLOW && workspaceId === WORKSPACE
          ? { nodes: [{ nodeId: "a", type: "browser", config: { action: "fill", value: "{{secrets.UNSET_PASSWORD_1}}" } }] }
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
    ...overrides,
  })
  return { service, events, started }
}

const request = { workspaceId: WORKSPACE, workflowId: WORKFLOW, environmentId: ENVIRONMENT, startUrl: "{{env.BASE_URL}}/login" }

describe("BrowserRecordingService", () => {
  it("starts a headed recording with the environment's values and every secret in scope", async () => {
    const { service, started } = harness()
    const status = await service.start(request)
    expect(status).toEqual({ recordingId: "recording-1700000000000", workspaceId: WORKSPACE, workflowId: WORKFLOW })
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
