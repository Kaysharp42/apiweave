import { execFile } from "node:child_process"
import { resolveExecutable } from "../../agents/executable"

/** The oldest Node.js the launcher bundle runs on (it is built for `node20`). */
export const MIN_NODE_MAJOR = 20

export interface NodeRuntime {
  readonly path: string | null
  readonly problem: string | null
}

/**
 * The Node.js a connected client should run the launcher with, by absolute path.
 *
 * Absolute rather than `node`, because a client started from the desktop does
 * not get the user's shell PATH: Claude Desktop or VS Code opened from the
 * Dock cannot see an nvm or Homebrew `node` that a terminal can. APIWeave's own
 * PATH has been widened from the login shell (`login_path.ts`), so it can.
 */
export function findNodeRuntime(env: NodeJS.ProcessEnv = process.env): Promise<NodeRuntime> {
  const nodePath = resolveExecutable("node", env)
  if (nodePath === undefined) {
    return Promise.resolve({ path: null, problem: `Node.js was not found on PATH. Install Node.js ${MIN_NODE_MAJOR} or newer, then refresh.` })
  }
  return new Promise((resolve) => {
    execFile(nodePath, ["--version"], { timeout: 5_000, windowsHide: true, env }, (error, stdout) => {
      const major = Number(/^v(\d+)\./.exec(stdout.trim())?.[1])
      if (error !== null || !Number.isInteger(major)) {
        resolve({ path: null, problem: `${nodePath} did not report its version: ${error?.message ?? stdout.trim()}` })
      } else if (major < MIN_NODE_MAJOR) {
        resolve({ path: null, problem: `${nodePath} is Node.js ${stdout.trim()}; the launcher needs ${MIN_NODE_MAJOR} or newer.` })
      } else {
        resolve({ path: nodePath, problem: null })
      }
    })
  })
}
