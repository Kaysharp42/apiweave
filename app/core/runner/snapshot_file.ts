import fs from "node:fs"
import path from "node:path"
import type { JsonValue } from "@shared/types/JsonValue"
import type { SnapshotStore } from "./snapshots"

interface FileEntry {
  readonly value: JsonValue
  readonly updatedAt: string
}

interface FileShape {
  readonly version: 1
  /** workflowId → nodeId → ruleIndex → baseline. */
  readonly workflows: Record<string, Record<string, Record<string, FileEntry>>>
}

/**
 * Snapshot baselines kept in one JSON file, so a CI checkout carries them with
 * the workflows it runs: commit the file, and a later run compares against the
 * baseline this one recorded. The app keeps its baselines in its database; this
 * store is what the headless CLI uses, where there is no database between runs.
 *
 * The file is read on first use and rewritten whole on every change: a
 * baseline write happens at most once per assertion rule per run, so the file
 * stays small and a rewrite keeps its contents readable in a diff.
 */
export class FileSnapshotStore implements SnapshotStore {
  private state: FileShape | undefined

  public constructor(private readonly filePath: string) {}

  public read(workflowId: string, nodeId: string, ruleIndex: number): FileEntry | undefined {
    return this.load().workflows[workflowId]?.[nodeId]?.[String(ruleIndex)]
  }

  public write(workflowId: string, nodeId: string, ruleIndex: number, value: JsonValue, updatedAt: string): void {
    const state = this.load()
    const workflow = (state.workflows[workflowId] ??= {})
    const node = (workflow[nodeId] ??= {})
    node[String(ruleIndex)] = { value, updatedAt }
    this.save(state)
  }

  /** The number of baselines the file holds, for a run's summary. */
  public count(): number {
    return Object.values(this.load().workflows).flatMap((workflow) => Object.values(workflow)).flatMap((node) => Object.keys(node)).length
  }

  private load(): FileShape {
    if (this.state !== undefined) return this.state
    this.state = readFile(this.filePath)
    return this.state
  }

  private save(state: FileShape): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8")
    fs.renameSync(temporary, this.filePath)
  }
}

function readFile(filePath: string): FileShape {
  if (!fs.existsSync(filePath)) return { version: 1, workflows: {} }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<FileShape>
    return { version: 1, workflows: parsed.workflows ?? {} }
  } catch {
    // A corrupt file is no baseline: a run records instead of failing every
    // rule against parsed nonsense, and the next write repairs it.
    return { version: 1, workflows: {} }
  }
}
