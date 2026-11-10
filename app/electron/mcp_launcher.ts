import { app } from "electron"
import { copyFileSync } from "node:fs"
import path from "node:path"
import { getLogger } from "../core/logging/logger"
import { MCP_LAUNCHER_FILE, MCP_LAUNCH_FILE, writeJsonFile, type McpLaunchCommand } from "../core/mcp/launcher/contract"

const log = getLogger("mcp")

/**
 * Put the stdio MCP launcher where an agent's config can name it for good —
 * the user-data folder, which neither an update nor an AppImage's temporary
 * mount moves — and record how to start this app. Run at every launch, so an
 * update replaces the launcher and a moved AppImage is found again.
 *
 * Null when it could not be installed: the app still works, and Connect your
 * agents says why instead. Never throws, because a failed copy must not stop
 * the window from opening.
 */
export function installMcpLauncher(userDataPath: string): string | null {
  const launcherPath = path.join(userDataPath, MCP_LAUNCHER_FILE)
  try {
    // The bundle sits next to main.cjs, inside app.asar once packaged.
    copyFileSync(path.join(__dirname, MCP_LAUNCHER_FILE), launcherPath)
    writeJsonFile(path.join(userDataPath, MCP_LAUNCH_FILE), launchCommand())
    return launcherPath
  } catch (error) {
    log.error(`could not install the MCP launcher: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function launchCommand(): McpLaunchCommand {
  // An AppImage's execPath is inside its temporary mount; APPIMAGE is the file the user has.
  const command = process.env["APPIMAGE"] || process.execPath
  // Run from source, Electron is given the app folder; a packaged app is its own.
  return { command, args: app.isPackaged ? [] : [app.getAppPath()] }
}
