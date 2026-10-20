import type { Stats } from "node:fs"
import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { isTreePath } from "@shared/workspace-repo/format"
import { ValidationError } from "../ipc/errors"
import { checkFileSize, MAX_TREE_BYTES, MAX_TREE_FILES } from "../services/workspace_repo_format"

/** The folders whose `.json` files belong to the format: a file there that maps to no record is the format's to remove. */
export const RECORD_FOLDERS = ["projects", "workflows", "environments"] as const

/** Everything the format owns in a commit's tree: the format file's folder, `.gitattributes`, `workspace.json` and the record folders. */
export const FORMAT_PATHS = [".apiweave", ".gitattributes", "workspace.json", ...RECORD_FOLDERS] as const

/** The format's own files at the top of the tree, besides the record folders. */
const ROOT_FILES = [".apiweave/format.json", ".gitattributes", "workspace.json"] as const

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

function refuse(relative: string, reason: string): ValidationError {
  return new ValidationError(`${relative}: ${reason}`)
}

function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** `lstat`, so a link is seen as a link; undefined when nothing is there. */
async function lstatIfPresent(directory: string, relative: string): Promise<Stats | undefined> {
  try {
    return await lstat(path.join(directory, ...relative.split("/")))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw refuse(relative, `cannot be read: ${failure(error)}`)
  }
}

/** A folder that is there must be a real one: a link or a file in its place would lead out of the tree or hide it. */
async function requirePlainFolder(directory: string, relative: string): Promise<boolean> {
  const stats = await lstatIfPresent(directory, relative)
  if (stats === undefined) return false
  if (!stats.isDirectory()) throw refuse(relative, "must be a plain folder (not a link or a file) inside the repository")
  return true
}

/** Every entry under a record folder, subfolders included: what the format does not know is for `parseWorkspace` to refuse, naming it. */
async function recordEntries(directory: string, relative: string): Promise<string[]> {
  if (!(await requirePlainFolder(directory, relative))) return []
  let names: string[]
  try {
    names = await readdir(path.join(directory, ...relative.split("/")))
  } catch (error) {
    throw refuse(relative, `cannot be read: ${failure(error)}`)
  }
  const entries: string[] = []
  for (const name of names.sort()) {
    const child = `${relative}/${name}`
    const stats = await lstatIfPresent(directory, child)
    if (stats?.isDirectory() === true) entries.push(...(await recordEntries(directory, child)))
    else entries.push(child)
  }
  return entries
}

/** One file as text, or undefined when absent. A link, a folder or a device is refused, and so is a file over the size limit, before it is read. */
async function readPlainFile(directory: string, relative: string): Promise<string | undefined> {
  const stats = await lstatIfPresent(directory, relative)
  if (stats === undefined) return undefined
  if (!stats.isFile()) throw refuse(relative, "must be a plain file (not a link, a folder or a device) inside the repository")
  checkFileSize(relative, stats.size)
  try {
    return await readFile(path.join(directory, ...relative.split("/")), "utf8")
  } catch (error) {
    throw refuse(relative, `cannot be read: ${failure(error)}`)
  }
}

/** The caps the tree walk enforces as it reads files; both default to the format's own limits. */
export interface ReadWorkspaceTreeOptions {
  /** At most this many bytes in total. Defaults to {@link MAX_TREE_BYTES}. */
  readonly maxTotalBytes?: number
  /** At most this many files. Defaults to {@link MAX_TREE_FILES}. */
  readonly maxFiles?: number
}

/**
 * The files of `directory` for `parseWorkspace`: the format's root files that
 * exist and every entry under the record folders, nested ones too, so a file
 * the format does not know (`workflows/archive/x--id.json`, `x.json.orig`,
 * `X.JSON`) reaches the parser, which refuses it by name rather than letting a
 * run pass without it. A README, `.git` and the rest of the root are not read.
 * Nothing is followed out of the tree: a link or a non-regular file is
 * refused, and so is an oversized one before it is read. A missing file is
 * simply absent; `parseWorkspace` says what a repository lacks.
 *
 * The tree's own caps are enforced as files are read, not afterwards by
 * `parseWorkspace`: bytes and a file count accumulate per file, and the walk
 * refuses the file that crosses either, so an untrusted repository cannot make
 * the app hold a whole tree's contents before the totals are known. The
 * entries are listed and `lstat`ed first, before either cap applies: the
 * listing holds names only, never contents.
 */
export async function readWorkspaceTree(
  directory: string,
  options: ReadWorkspaceTreeOptions = {},
): Promise<Map<string, string>> {
  const maxTotalBytes = options.maxTotalBytes ?? MAX_TREE_BYTES
  const maxFiles = options.maxFiles ?? MAX_TREE_FILES
  const paths: string[] = [...ROOT_FILES]
  if (!(await requirePlainFolder(directory, ".apiweave"))) paths.splice(paths.indexOf(".apiweave/format.json"), 1)
  for (const folder of RECORD_FOLDERS) paths.push(...(await recordEntries(directory, folder)))
  const files = new Map<string, string>()
  let totalBytes = 0
  for (const relative of paths.sort()) {
    const text = await readPlainFile(directory, relative)
    if (text === undefined) continue
    if (files.size >= maxFiles) throw new ValidationError(`${relative} pushes the repository over its ${maxFiles}-file limit; at most ${maxFiles} files are read`)
    totalBytes += Buffer.byteLength(text, "utf8")
    if (totalBytes > maxTotalBytes) {
      throw new ValidationError(`${relative} pushes the repository over its ${maxTotalBytes}-byte limit (${totalBytes} bytes in total); at most ${maxTotalBytes} are read`)
    }
    files.set(relative, text)
  }
  return files
}
/**
 * Make `directory` hold `files` (as `serializeWorkspace` returns them): write
 * only a file whose bytes differ, so an unchanged record keeps its timestamp
 * and git has nothing to look at, and delete a record file that no longer maps
 * to a record. Anything else in the directory — `.git`, a README, CI config —
 * is left alone. A path that leaves the tree or names `.git` is refused before
 * anything is written.
 */
export async function writeWorkspaceTree(directory: string, files: ReadonlyMap<string, string>): Promise<void> {
  for (const relative of files.keys()) {
    if (!isTreePath(relative)) throw refuse(relative, "is not a path a repository may hold: it leaves the tree or names git's own .git folder")
  }
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
