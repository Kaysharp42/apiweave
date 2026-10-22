import { execFileSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, vi } from "vitest"
import { GitService } from "../git_service"
import type { GitServiceOptions } from "../git_types"

// Every test here spawns real git processes; process creation on Windows is slow enough under a parallel full run to overrun the 5 s default.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const roots: string[] = []
const servers: http.Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 })
  }
})

export function makeTempDir(prefix = "apiweave-git-"): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  roots.push(root)
  return root
}

/**
 * The machine's own git configuration must not leak into a test: no global
 * identity, credential helper (a GUI prompt on Windows) or proxy.
 */
export function isolatedEnv(root: string): NodeJS.ProcessEnv {
  const globalConfig = path.join(root, "global.gitconfig")
  fs.writeFileSync(globalConfig, "")
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: "1" }
  for (const name of Object.keys(env)) {
    if (/^(?:https?|all|no)_proxy$/i.test(name)) {
      delete env[name]
    }
  }
  return env
}

export interface GitSandbox {
  readonly root: string
  readonly env: NodeJS.ProcessEnv
  readonly hooksDir: string
  readonly service: GitService
}

export function makeSandbox(overrides: Partial<GitServiceOptions> = {}): GitSandbox {
  const root = makeTempDir()
  const env = isolatedEnv(root)
  const hooksDir = path.join(root, "empty-hooks")
  fs.mkdirSync(hooksDir)
  const service = new GitService({
    hooksDir,
    identity: { name: "APIWeave Test", email: "test@example.invalid" },
    ...overrides,
    env: { ...env, ...overrides.env },
  })
  return { root, env, hooksDir, service }
}

/**
 * A service over the sandbox whose git names no author anywhere: no identity
 * option, the isolated global config is empty, and the variables that would
 * name one are gone — a machine where nobody ran `git config user.name`.
 */
export function anonymousService(sandbox: GitSandbox): GitService {
  const env = { ...sandbox.env }
  for (const name of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "EMAIL"]) {
    delete env[name]
  }
  return new GitService({ hooksDir: sandbox.hooksDir, env })
}

/** Plain git, outside the service, for setting up fixtures and proving what the service prevents. */
export function rawGit(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
}

/** A bare repository on disk, reachable as a `file://` remote. */
export function makeBareRemote(sandbox: GitSandbox, name = "remote.git"): { dir: string; url: string } {
  const dir = path.join(sandbox.root, name)
  rawGit(sandbox.root, sandbox.env, "init", "--bare", "--initial-branch=main", dir)
  return { dir, url: pathToFileURL(dir).href }
}

export function writeFile(dir: string, name: string, content: string): void {
  fs.writeFileSync(path.join(dir, name), content)
}

export async function listen(handler: http.RequestListener): Promise<{ url: string; port: number }> {
  const server = http.createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/repo.git`, port }
}

export async function closedPortUrl(): Promise<string> {
  const { port } = await listen(() => undefined)
  const server = servers.pop()
  await new Promise<void>((resolve) => server?.close(() => resolve()))
  return `http://127.0.0.1:${port}/repo.git`
}
