import { app } from "electron"
import { copyFileSync } from "node:fs"
import path from "node:path"
import { MCP_LAUNCHER_FILE, MCP_LAUNCH_FILE, writeJsonFile, type McpLaunchCommand } from "../core/mcp/launcher/contract"

/**
 * Put the stdio MCP launcher where an agent's config can name it for good —
 * the user-data folder, which neither an update nor an AppImage's temporary
 * mount moves — and record how to start this app. Run at every launch, so an
 * update replaces the launcher and a moved AppImage is found again.
 */
export function installMcpLauncher(userDataPath: string): string {
  const launcherPath = path.join(userDataPath, MCP_LAUNCHER_FILE)
  // The bundle sits next to main.cjs, inside app.asar once packaged.
  copyFileSync(path.join(__dirname, MCP_LAUNCHER_FILE), launcherPath)
  writeJsonFile(path.join(userDataPath, MCP_LAUNCH_FILE), launchCommand())
  return launcherPath
}

function launchCommand(): McpLaunchCommand {
  // An AppImage's execPath is inside its temporary mount; APPIMAGE is the file the user has.
  const command = process.env["APPIMAGE"] || process.execPath
  // Run from source, Electron is given the app folder; a packaged app is its own.
  return { command, args: app.isPackaged ? [] : [app.getAppPath()] }
}
