/**
 * Running without a window: the tray icon, and starting at login.
 *
 * Login items are the OS's own record, read back from it rather than mirrored
 * in app_settings, so a user who removes one in Task Manager or System
 * Settings is never contradicted. Electron manages them on Windows and macOS;
 * Linux has no such API, so there it is an XDG autostart entry, which GNOME,
 * KDE, XFCE, Cinnamon and systemd's xdg-autostart-generator (Hyprland or Sway
 * under uwsm) all honour. A bare compositor reads neither: its own config needs
 * `exec-once = apiweave --hidden`, or the equivalent.
 */
import { app, Menu, nativeImage, Tray } from "electron"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

/** The argument a login launch carries, so the window stays in the tray. */
export const HIDDEN_ARG = "--hidden"

function autostartFile(): string {
  const config = process.env["XDG_CONFIG_HOME"] || path.join(os.homedir(), ".config")
  return path.join(config, "autostart", "apiweave.desktop")
}

/** Quoted per the Desktop Entry spec, where `"`, `` ` ``, `$` and `\` need escaping. */
export function autostartEntry(executable: string): string {
  const quoted = `"${executable.replace(/["`$\\]/g, "\\$&")}"`
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=APIWeave",
    `Exec=${quoted} ${HIDDEN_ARG}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n")
}

export function getOpenAtLogin(): boolean {
  if (process.platform === "linux") return existsSync(autostartFile())
  return app.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin
}

export function setOpenAtLogin(enabled: boolean): void {
  if (process.platform !== "linux") {
    app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_ARG] })
    return
  }
  const file = autostartFile()
  if (!enabled) {
    rmSync(file, { force: true })
    return
  }
  mkdirSync(path.dirname(file), { recursive: true })
  // An AppImage's execPath is inside its temporary mount; APPIMAGE is the file the user has.
  writeFileSync(file, autostartEntry(process.env["APPIMAGE"] || process.execPath))
}

/** macOS passes no arguments to a login item, so it reports the launch instead. */
export function launchedHidden(): boolean {
  if (process.argv.includes(HIDDEN_ARG)) return true
  return process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin === true
}

/**
 * Some Linux desktops (stock GNOME) show no tray at all. The icon is then
 * simply invisible, and launching APIWeave again brings the window back
 * through `second-instance` — so hiding never strands the user.
 */
export function createTray(iconPath: string, actions: { open: () => void; quit: () => void }): Tray {
  // macOS draws menu-bar icons at 16pt; Windows and Linux scale the PNG themselves.
  const image = nativeImage.createFromPath(iconPath)
  const tray = new Tray(process.platform === "darwin" ? image.resize({ width: 16, height: 16 }) : image)
  tray.setToolTip("APIWeave")
  // Linux AppIndicator trays deliver no clicks, only this menu, so Open must be in it.
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open APIWeave", click: actions.open },
      { type: "separator" },
      { label: "Quit APIWeave", click: actions.quit },
    ]),
  )
  tray.on("click", actions.open)
  return tray
}
