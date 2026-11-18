import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Run } from "@shared/types/Run"
import type { RunResult } from "@shared/types/RunResult"
import type { ReportWorkflow } from "../../runner/reporters"
import { writeEvidence, type EvidenceSource } from "../evidence"

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "apiweave-evidence-"))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const failed = (nodeId: string, browser: RunResult["browser"]): RunResult => ({
  nodeId,
  status: "failed",
  duration: 1,
  request: null,
  response: null,
  error: "Browser step: failed",
  ...(browser === undefined ? {} : { browser }),
})

/** A Call Workflow result: the child run ids say which workflow ran, not this node's browser step. */
const call = (nodeId: string, subWorkflow: NonNullable<RunResult["subWorkflow"]>): RunResult => ({
  nodeId,
  status: "failed",
  duration: 1,
  request: null,
  response: null,
  error: "Sub-workflow failed in 1 node(s)",
  subWorkflow,
})

const run = (runId: string, results: RunResult[], workflowId = "wf"): Run => ({
  runId,
  workspaceId: "ws",
  workflowId,
  status: "failed",
  trigger: "manual",
  variables: {},
  results,
  nodeStatuses: {},
  rev: 1,
  createdAt: "",
  updatedAt: "",
})

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
const artifact = (artifactId: string) => (artifactId === "art" ? { mime: "image/jpeg", body: JPEG } : undefined)

const source = ({ runs = [], workflows = [] }: { runs?: readonly Run[]; workflows?: readonly ReportWorkflow[] } = {}): EvidenceSource => {
  const runsById = new Map(runs.map((one) => [one.runId, one]))
  const workflowsById = new Map(workflows.map((one) => [one.workflowId, one]))
  return { artifact, loadRun: (runId) => runsById.get(runId), loadWorkflow: (workflowId) => workflowsById.get(workflowId) }
}

const LOGIN: ReportWorkflow = {
  workflowId: "wf_login",
  name: "Login",
  nodes: [{ nodeId: "check", type: "browser", label: "Check heading", position: { x: 0, y: 0 } }],
}

const PAY: ReportWorkflow = {
  workflowId: "wf_pay",
  name: "Pay",
  nodes: [{ nodeId: "pay", type: "browser", label: "Pay now", position: { x: 0, y: 0 } }],
}

const callSummary = (workflowId: string, runId: string): NonNullable<RunResult["subWorkflow"]> => ({
  workflowId,
  runId,
  status: "failed",
  nodeCount: 1,
  failedNodeCount: 1,
  outputVariableNames: [],
})

describe("writeEvidence", () => {
  it("writes each browser step's screenshot and snapshot, passed or failed, and names them from where a report is", () => {
    const one = run("run_1", [
      failed("b/1", { action: "click", screenshotArtifactId: "art", ariaSnapshot: "- button \"Save\"" }),
      failed("b:1", { action: "click", ariaSnapshot: "- heading" }),
      failed("http", undefined),
      { ...failed("b2", { action: "click", ariaSnapshot: "kept" }), status: "passed" },
      failed("gone", { action: "click", screenshotArtifactId: "missing" }),
    ])
    const written = writeEvidence(dir, { kind: "iterations", title: "t", iterations: [{ kind: "run", run: one, workflow: null }] }, source())

    expect(written.fileCount).toBe(4)
    expect(fs.readFileSync(path.join(dir, "run_1", "b_1.jpg"))).toEqual(JPEG)
    expect(fs.readFileSync(path.join(dir, "run_1", "b_1.aria.yml"), "utf8")).toBe("- button \"Save\"")
    // Two ids that clean up to the same name each keep their own file.
    expect(fs.readFileSync(path.join(dir, "run_1", "b_1-2.aria.yml"), "utf8")).toBe("- heading")
    // A passed step's evidence is written too.
    expect(fs.readFileSync(path.join(dir, "run_1", "b2.aria.yml"), "utf8")).toBe("kept")
    expect(fs.readdirSync(path.join(dir, "run_1")).sort()).toEqual(["b2.aria.yml", "b_1-2.aria.yml", "b_1.aria.yml", "b_1.jpg"])

    expect(written.relativeTo(dir)("run_1", "b/1")).toEqual([{ screenshot: "run_1/b_1.jpg", ariaSnapshot: "run_1/b_1.aria.yml" }])
    expect(written.relativeTo(path.join(dir, "reports"))("run_1", "b:1")).toEqual([{ ariaSnapshot: "../run_1/b_1-2.aria.yml" }])
    expect(written.relativeTo(dir)("run_1", "http")).toBeUndefined()
    expect(written.relativeTo(dir)("run_1", "b2")).toEqual([{ ariaSnapshot: "run_1/b2.aria.yml" }])
  })

  it("writes nothing for a run without a browser step", () => {
    const written = writeEvidence(dir, { kind: "run", run: run("run_2", [failed("http", undefined)]), workflow: null }, source())
    expect(written.fileCount).toBe(0)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it("writes a called workflow's failed step under the child run, linked from the calling node", () => {
    const caller = run("run_1", [call("call", callSummary("wf_login", "child_1"))])
    const child = run("child_1", [failed("check", { action: "expect-text", screenshotArtifactId: "art", ariaSnapshot: "- heading" })], "wf_login")
    const written = writeEvidence(dir, { kind: "run", run: caller, workflow: null }, source({ runs: [child], workflows: [LOGIN] }))

    expect(written.fileCount).toBe(2)
    expect(fs.readdirSync(path.join(dir, "child_1")).sort()).toEqual(["check.aria.yml", "check.jpg"])
    expect(written.relativeTo(dir)("run_1", "call")).toEqual([
      { screenshot: "child_1/check.jpg", ariaSnapshot: "child_1/check.aria.yml", step: "Login › Check heading" },
    ])
    // The child is not a report case of its own.
    expect(written.relativeTo(dir)("child_1", "check")).toBeUndefined()
  })

  it("writes each failed forEach iteration, in item order, under its own run id", () => {
    const caller = run("run_1", [
      call("call", {
        ...callSummary("wf_login", "child_1"),
        failedNodeCount: 2,
        forEach: {
          itemCount: 2,
          ranCount: 2,
          failedCount: 2,
          iterations: [
            { index: 0, runId: "child_1", status: "failed" },
            { index: 1, runId: "child_2", status: "failed" },
          ],
        },
      }),
    ])
    const first = run("child_1", [failed("check", { action: "expect-text", ariaSnapshot: "- first" })], "wf_login")
    const second = run("child_2", [failed("check", { action: "expect-text", ariaSnapshot: "- second" })], "wf_login")
    const written = writeEvidence(dir, { kind: "run", run: caller, workflow: null }, source({ runs: [first, second], workflows: [LOGIN] }))

    expect(fs.readFileSync(path.join(dir, "child_1", "check.aria.yml"), "utf8")).toBe("- first")
    expect(fs.readFileSync(path.join(dir, "child_2", "check.aria.yml"), "utf8")).toBe("- second")
    expect(written.relativeTo(dir)("run_1", "call")).toEqual([
      { ariaSnapshot: "child_1/check.aria.yml", step: "Login › Check heading" },
      { ariaSnapshot: "child_2/check.aria.yml", step: "Login › Check heading" },
    ])
  })

  it("surfaces a nested call's step on the top-level calling node, named for the workflow it ran in", () => {
    const caller = run("run_1", [call("call", callSummary("wf_login", "child_1"))])
    const child = run("child_1", [call("inner", callSummary("wf_pay", "grandchild_1"))], "wf_login")
    const grandchild = run("grandchild_1", [failed("pay", { action: "click", screenshotArtifactId: "art" })], "wf_pay")
    const written = writeEvidence(
      dir,
      { kind: "run", run: caller, workflow: null },
      source({ runs: [child, grandchild], workflows: [LOGIN, PAY] }),
    )

    expect(fs.readdirSync(path.join(dir, "grandchild_1"))).toEqual(["pay.jpg"])
    expect(written.relativeTo(dir)("run_1", "call")).toEqual([{ screenshot: "grandchild_1/pay.jpg", step: "Pay › Pay now" }])
  })

  it("falls back to the ids when the called workflow is gone", () => {
    const caller = run("run_1", [call("call", callSummary("wf_gone", "child_1"))])
    const child = run("child_1", [failed("check", { action: "click", ariaSnapshot: "- heading" })], "wf_gone")
    const written = writeEvidence(dir, { kind: "run", run: caller, workflow: null }, source({ runs: [child] }))

    expect(written.relativeTo(dir)("run_1", "call")).toEqual([{ ariaSnapshot: "child_1/check.aria.yml", step: "wf_gone › check" }])
  })

  it("does not follow a call back to a run it already read", () => {
    const caller = run("run_1", [call("call", callSummary("wf_login", "child_1"))])
    const child = run("child_1", [failed("check", { action: "click", ariaSnapshot: "- heading" }), call("back", callSummary("wf", "run_1"))], "wf_login")
    const written = writeEvidence(dir, { kind: "run", run: caller, workflow: null }, source({ runs: [child], workflows: [LOGIN] }))

    expect(written.fileCount).toBe(1)
    expect(written.relativeTo(dir)("run_1", "call")).toEqual([{ ariaSnapshot: "child_1/check.aria.yml", step: "Login › Check heading" }])
    expect(fs.readdirSync(dir)).toEqual(["child_1"])
  })
})
