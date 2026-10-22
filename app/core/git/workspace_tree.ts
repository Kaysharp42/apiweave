import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

/** The folders whose `.json` files belong to the format: a file there that maps to no record is the format's to remove. */
const RECORD_FOLDERS = ["projects", "workflows", "environments"] as const

async function readIfPresent(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function recordFiles(directory: string, folder: string): Promise<string[]> {
  try {
    const entries = await readdir(path.join(directory, folder), { withFileTypes: true })
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => `${folder}/${entry.name}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

/**
 * Make `directory` hold `files` (as `serializeWorkspace` returns them): write
 * only a file whose bytes differ, so an unchanged record keeps its timestamp
 * and git has nothing to look at, and delete a record file that no longer maps
 * to a record. Anything else in the directory — `.git`, a README, CI config —
 * is left alone.
 */
export async function writeWorkspaceTree(directory: string, files: ReadonlyMap<string, string>): Promise<void> {
  for (const folder of RECORD_FOLDERS) {
    for (const stale of await recordFiles(directory, folder)) {
      if (!files.has(stale)) await rm(path.join(directory, ...stale.split("/")), { force: true })
    }
  }
  for (const [relative, text] of files) {
    const target = path.join(directory, ...relative.split("/"))
    if ((await readIfPresent(target)) === text) continue
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, text, "utf8")
  }
}
