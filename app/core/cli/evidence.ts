import fs from "node:fs"
import path from "node:path"
import type { Run } from "@shared/types/Run"
import type { ReportEvidence, ReportEvidenceLookup, ReportInput } from "../runner/reporters"

/** A stored screenshot's bytes. */
interface ArtifactBytes {
  readonly mime: string
  readonly body: Buffer
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
 * over where the page showed a masked value when it was taken. Nothing is
 * deleted from `dir`: every run id is new, so earlier files are never
 * overwritten.
 */
export function writeEvidence(dir: string, input: ReportInput, artifact: (artifactId: string) => ArtifactBytes | undefined): WrittenEvidence {
  const written = new Map<string, EvidencePaths>()
  for (const run of runsOf(input)) {
    const names = new Set<string>()
    for (const result of run.results) {
      const browser = result.status === "failed" ? result.browser : undefined
      const shot = browser?.screenshotArtifactId === undefined ? undefined : artifact(browser.screenshotArtifactId)
      const files = writeStep(() => path.join(dir, fileName(run.runId, new Set()), fileName(result.nodeId, names)), shot, browser?.ariaSnapshot)
      if (files !== undefined) written.set(key(run.runId, result.nodeId), files)
    }
  }
  return {
    fileCount: [...written.values()].reduce((sum, files) => sum + Object.keys(files).length, 0),
    relativeTo: (from) => (runId, nodeId) => {
      const files = written.get(key(runId, nodeId))
      if (files === undefined) return undefined
      const relative = (file: string): string => path.relative(from, file).split(path.sep).join("/")
      const evidence: ReportEvidence = {
        ...(files.screenshot === undefined ? {} : { screenshot: relative(files.screenshot) }),
        ...(files.ariaSnapshot === undefined ? {} : { ariaSnapshot: relative(files.ariaSnapshot) }),
      }
      return evidence
    },
  }
}

interface EvidencePaths {
  screenshot?: string
  ariaSnapshot?: string
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
