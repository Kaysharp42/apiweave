import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Run } from "@shared/types/Run"
import type { RunResult } from "@shared/types/RunResult"
import { writeEvidence } from "../evidence"

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

const run = (runId: string, results: RunResult[]): Run => ({
  runId,
  workspaceId: "ws",
  workflowId: "wf",
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

describe("writeEvidence", () => {
  it("writes each failed browser step's screenshot and snapshot, and names them from where a report is", () => {
    const one = run("run_1", [
      failed("b/1", { action: "click", screenshotArtifactId: "art", ariaSnapshot: "- button \"Save\"" }),
      failed("b:1", { action: "click", ariaSnapshot: "- heading" }),
      failed("http", undefined),
      { ...failed("b2", { action: "click", ariaSnapshot: "passed" }), status: "passed" },
      failed("gone", { action: "click", screenshotArtifactId: "missing" }),
    ])
    const written = writeEvidence(dir, { kind: "iterations", title: "t", iterations: [{ kind: "run", run: one, workflow: null }] }, artifact)

    expect(written.fileCount).toBe(3)
    expect(fs.readFileSync(path.join(dir, "run_1", "b_1.jpg"))).toEqual(JPEG)
    expect(fs.readFileSync(path.join(dir, "run_1", "b_1.aria.yml"), "utf8")).toBe("- button \"Save\"")
    // Two ids that clean up to the same name each keep their own file.
    expect(fs.readFileSync(path.join(dir, "run_1", "b_1-2.aria.yml"), "utf8")).toBe("- heading")
    expect(fs.readdirSync(path.join(dir, "run_1")).sort()).toEqual(["b_1-2.aria.yml", "b_1.aria.yml", "b_1.jpg"])

    expect(written.relativeTo(dir)("run_1", "b/1")).toEqual({ screenshot: "run_1/b_1.jpg", ariaSnapshot: "run_1/b_1.aria.yml" })
    expect(written.relativeTo(path.join(dir, "reports"))("run_1", "b:1")).toEqual({ ariaSnapshot: "../run_1/b_1-2.aria.yml" })
    expect(written.relativeTo(dir)("run_1", "http")).toBeUndefined()
    expect(written.relativeTo(dir)("run_1", "b2")).toBeUndefined()
  })

  it("writes nothing for a run without a failed browser step", () => {
    const written = writeEvidence(dir, { kind: "run", run: run("run_2", [failed("http", undefined)]), workflow: null }, artifact)
    expect(written.fileCount).toBe(0)
    expect(fs.readdirSync(dir)).toEqual([])
  })
})
