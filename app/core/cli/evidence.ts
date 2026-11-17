import fs from "node:fs"
import path from "node:path"
import type { Run } from "@shared/types/Run"
import type { RunResult } from "@shared/types/RunResult"
import type { ReportEvidence, ReportEvidenceLookup, ReportInput, ReportWorkflow } from "../runner/reporters"

/** A stored screenshot's bytes. */
interface ArtifactBytes {
  readonly mime: string
  readonly body: Buffer
}

/** Where the evidence comes from: what the store holds, masked like the report input. */
export interface EvidenceSource {
  readonly artifact: (artifactId: string) => ArtifactBytes | undefined
  /** A Call Workflow node's child run, which the report input does not carry. Masked. */
  readonly loadRun: (runId: string) => Run | undefined
  /** A child run's workflow, whose name and labels become step names in the reports. Masked. */
  readonly loadWorkflow: (workflowId: string) => ReportWorkflow | undefined
}

/** What `--evidence-dir` wrote: the files, and how each report should name them. */
export interface WrittenEvidence {
  readonly fileCount: number
  /** The lookup a report takes, its paths relative to `from` (the HTML file's folder, or the working directory). */
  readonly relativeTo: (from: string) => ReportEvidenceLookup
}

const EXTENSIONS: Readonly<Record<string, string>> = { "image/jpeg": ".jpg", "image/png": ".png" }

/**
 * `--evidence-dir`: each failed browser step's screenshot and ARIA snapshot as
 * files, `<dir>/<runId>/<nodeId>.jpg` and `<nodeId>.aria.yml`, so a pipeline
 * can keep them with the reports, which link them. `input` is the masked
 * report input, so the snapshot is the masked one; the screenshot was painted
 * over where the page showed a masked value when it was taken. A step of a
 * workflow reached through Call Workflow is filed under that call's own child
 * run id and linked from the calling node's case. Nothing is deleted from
 * `dir`: every run id is new, so earlier files are never overwritten.
 */
export function writeEvidence(dir: string, input: ReportInput, source: EvidenceSource): WrittenEvidence {
  const written = new Map<string, WrittenStep[]>()
  // A child run is reachable from several calls, and a cycle is no run at all.
  const visited = new Set<string>()

  const add = (caseKey: string, step: WrittenStep): void => {
    const steps = written.get(caseKey)
    if (steps === undefined) written.set(caseKey, [step])
    else steps.push(step)
  }

  /** Every failed browser step of `run`, filed under its own run id, under the case key of each result. */
  const writeRun = (run: Run, caseKeyOf: (nodeId: string) => string, name: ((nodeId: string) => string) | undefined): void => {
    const names = new Set<string>()
    const runName = fileName(run.runId, new Set())
    for (const result of run.results) {
      const browser = result.status === "failed" ? result.browser : undefined
      const shot = browser?.screenshotArtifactId === undefined ? undefined : source.artifact(browser.screenshotArtifactId)
      const files = writeStep(() => path.join(dir, runName, fileName(result.nodeId, names)), shot, browser?.ariaSnapshot)
      if (files !== undefined) add(caseKeyOf(result.nodeId), { files, ...(name === undefined ? {} : { step: name(result.nodeId) }) })
    }
  }

  /** The failed steps of every run `run` calls, at the top-level case that is the calling node, however deep. */
  const followCalls = (run: Run, topCaseKeyOf: (nodeId: string) => string): void => {
    for (const result of run.results) {
      const called = childRunIds(result)
      if (called.length === 0) continue
      const caseKey = topCaseKeyOf(result.nodeId)
      for (const childRunId of called) {
        if (visited.has(childRunId)) continue
        visited.add(childRunId)
        const child = source.loadRun(childRunId)
        if (child === undefined) continue
        const workflow = source.loadWorkflow(child.workflowId)
        const labels = new Map((workflow?.nodes ?? []).map((node) => [node.nodeId, node.label]))
        const stepName = (nodeId: string): string => `${workflow?.name ?? child.workflowId} › ${labels.get(nodeId) || nodeId}`
        writeRun(child, () => caseKey, stepName)
        followCalls(child, () => caseKey)
      }
    }
  }

  for (const run of runsOf(input)) {
    if (visited.has(run.runId)) continue
    visited.add(run.runId)
    const caseKeyOf = (nodeId: string): string => key(run.runId, nodeId)
    writeRun(run, caseKeyOf, undefined)
    followCalls(run, caseKeyOf)
  }
  return {
    fileCount: [...written.values()].flat().reduce((sum, step) => sum + Object.keys(step.files).length, 0),
    relativeTo: (from) => (runId, nodeId) => {
      const steps = written.get(key(runId, nodeId))
      if (steps === undefined) return undefined
      const relative = (file: string): string => path.relative(from, file).split(path.sep).join("/")
      return steps.map((step) => {
        const evidence: ReportEvidence = {
          ...(step.files.screenshot === undefined ? {} : { screenshot: relative(step.files.screenshot) }),
          ...(step.files.ariaSnapshot === undefined ? {} : { ariaSnapshot: relative(step.files.ariaSnapshot) }),
          ...(step.step === undefined ? {} : { step: step.step }),
        }
        return evidence
      })
    },
  }
}

interface EvidencePaths {
  screenshot?: string
  ariaSnapshot?: string
}

interface WrittenStep {
  readonly files: EvidencePaths
  /** The called workflow and step, absent for a top-level step. */
  readonly step?: string
}

/** The runs a Call Workflow result ran: its one call, or each iteration of a forEach call. */
function childRunIds(result: RunResult): readonly string[] {
  const sub = result.subWorkflow
  if (sub === undefined) return []
  return [sub.runId, ...(sub.forEach?.iterations.map((iteration) => iteration.runId) ?? [])].filter(
    (runId): runId is string => runId !== undefined,
  )
}

/** One step's files, at `base()` plus an extension; nothing (and no name taken) when it has neither. */
function writeStep(base: () => string, shot: ArtifactBytes | undefined, ariaSnapshot: string | undefined): EvidencePaths | undefined {
  if (shot === undefined && ariaSnapshot === undefined) return undefined
  const stem = base()
  fs.mkdirSync(path.dirname(stem), { recursive: true })
  const files: EvidencePaths = {}
  if (shot !== undefined) {
    files.screenshot = `${stem}${EXTENSIONS[shot.mime] ?? ".bin"}`
    fs.writeFileSync(files.screenshot, shot.body)
  }
  if (ariaSnapshot !== undefined) {
    files.ariaSnapshot = `${stem}.aria.yml`
    fs.writeFileSync(files.ariaSnapshot, ariaSnapshot, "utf8")
  }
  return files
}

const key = (runId: string, nodeId: string): string => `${runId}\u0000${nodeId}`

/** Every stored run a report input covers. A load run keeps none (it refuses browser steps). */
function runsOf(input: ReportInput): readonly Run[] {
  switch (input.kind) {
    case "run":
      return [input.run]
    case "project":
      return input.runs
    case "iterations":
      return input.iterations.flatMap(runsOf)
    case "projects":
      return input.projects.flatMap(runsOf)
    case "load":
      return []
  }
}

/**
 * An id as a file name: anything but letters, digits, `.`, `_` and `-`
 * becomes `_`, and a name already `taken` (two ids that clean up the same)
 * gets a number.
 */
function fileName(id: string, taken: Set<string>): string {
  const clean = id.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_") || "_"
  let name = clean
  for (let index = 2; taken.has(name.toLowerCase()); index += 1) name = `${clean}-${index}`
  taken.add(name.toLowerCase())
  return name
}
