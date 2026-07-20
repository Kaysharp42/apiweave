# Installation

*Get APIWeave running on Windows, macOS, or Linux. The desktop app is a single self-contained installer — no Python, no MongoDB, no Docker, no separate backend, no exposed ports.*

## Prerequisites

- A supported operating system:
  - **Windows**: Windows 10 or newer (x64).
  - **macOS**: macOS 11 (Big Sur) or newer (Intel and Apple Silicon).
  - **Linux**: a current distro with glibc 2.31+ (Ubuntu 20.04+, Debian 11+, Fedora 33+). For the AppImage, FUSE 2 must be installed; on Arch, prefer the `.pacman` package.
- About 500 MB of free disk space for the installer and the local SQLite database.
- A network connection on first launch (the desktop app does not phone home afterwards; the database and the secret store stay on your machine).

For contributors who want to build the desktop app from source: Node.js 20+ and npm. The build itself is `scripts/desktop.ps1 build` on Windows, `scripts/desktop.sh build` on Linux/macOS. See the [Developer Guide](../../AGENTS.md) for the full dev workflow.

## Download the Installer

Grab the latest installer for your OS from the [latest release](https://github.com/Kaysharp42/apiweave/releases). Each release also includes `SHA256SUMS.txt` for download verification.

- **Windows**: `APIWeave-<version>-win-x64.exe` (NSIS per-user installer).
- **macOS**: `APIWeave-<version>-mac-x64.dmg` for Intel or `APIWeave-<version>-mac-arm64.dmg` for Apple Silicon.
- **Linux**: AppImage, `.deb`, `.rpm`, and `.pacman` x64 builds. Pick the one that matches your distro.

## Windows

1. Double-click the installer. The installer is per-user and does not require administrator rights.
2. Choose an install location if the default does not fit.
3. Wait for the install to complete. A Start menu entry is added under **APIWeave**.
4. Launch APIWeave from the Start menu.

The installer and binaries are unsigned, so SmartScreen may warn on first launch. Click **More info → Run anyway**.

## macOS

1. Open the `.dmg` and drag **APIWeave** to **Applications**.
2. The build is unsigned and un-notarized, so the first launch is blocked by Gatekeeper. Right-click the app in **Applications** and choose **Open**, or clear the quarantine flag with:
   ```bash
   xattr -dr com.apple.quarantine /Applications/APIWeave.app
   ```
3. Launch APIWeave from **Applications** or Spotlight.

## Linux

Four install paths. Pick what fits your distro.

**AppImage** (portable, runs anywhere):

```bash
chmod +x APIWeave-<version>-linux-x86_64.AppImage
./APIWeave-<version>-linux-x86_64.AppImage
```

If FUSE 2 is missing (common on Arch), install it (`sudo pacman -S fuse2`) or run the AppImage without FUSE:

```bash
./APIWeave-<version>-linux-x86_64.AppImage --appimage-extract-and-run
```

**Debian / Ubuntu**:

```bash
sudo apt install ./APIWeave-<version>-linux-amd64.deb
```

**Fedora / RHEL / openSUSE**:

```bash
sudo dnf install ./APIWeave-<version>-linux-x86_64.rpm
```

**Arch / Manjaro**:

```bash
sudo pacman -U APIWeave-<version>-linux-x64.pacman
```

On Arch + Hyprland, the app requests native Wayland automatically (`ozone-platform-hint=auto`), so it runs directly on Hyprland with no XWayland. If a compositor quirk forces XWayland, launch with an explicit override: `apiweave --ozone-platform=wayland` (or `--ozone-platform=x11` to force XWayland).

## First Launch

When APIWeave opens for the first time:

- The app creates its data directory under the OS-standard user data path:
  - **Windows**: `%APPDATA%\APIWeave`
  - **macOS**: `~/Library/Application Support/APIWeave`
  - **Linux**: `~/.config/APIWeave`
- A single SQLite database (`apiweave.db`) is created in that directory and migrations are applied.
- The keyfile for the encrypted secret store is generated and written to the data directory. Treat this file like a private key: if you copy it elsewhere, the secret store follows it. If you delete it, the secret store is gone for good.
- The app lands directly on the workflows list. There is no login screen.

## Optional: Enable the Local MCP Bridge

The local MCP bridge is opt-in. To enable it for a local AI agent:

1. Open the **Settings** panel in the app (the gear icon in the header).
2. Toggle **Enable MCP bridge**.
3. The app binds a loopback HTTP server on `127.0.0.1` and writes a static per-install token to a file in the data directory. The **MCP** panel in the app shows the URL and the token; point your local agent at the URL with the token. See [MCP Integration](../features/mcp-integration.md) for setup recipes.

If you do not enable the MCP bridge, nothing is listening on any port. The desktop app has no exposed network surface by default.

## Build from Source (Contributors)

If you are working on APIWeave itself, build the desktop installer from source.

```bash
# Clone the repository
git clone https://github.com/Kaysharp42/apiweave.git
cd apiweave

# Install everything in one step (recommended)
./scripts/setup.sh        # macOS / Linux
# Windows (PowerShell):
# .\scripts\setup.ps1

# Or install the single package manually:
cd app && npm install && cd ..

# Build the installer
# Windows (PowerShell):
scripts/desktop.ps1 build
# macOS / Linux:
./scripts/desktop.sh build
```

The installer lands in `app/release/`. For day-to-day development, run `cd app && npm run dev` instead. It builds the main process and renderer, then launches Electron with the renderer loaded from `app://local/`. It does not start an HTTP server. Restart the command after source changes.

## Verify the Install

A quick checklist after first launch:

1. The window opens at the workflows list. No login screen.
2. The data directory was created and contains `apiweave.db` and `keyfile`.
3. **Settings → About** shows the version you installed.
4. (Optional) Toggle the MCP bridge in **Settings** and confirm the **MCP** panel shows a `127.0.0.1` URL and a token.

## Where Things Live

| What | Where |
|------|-------|
| Database (SQLite) | `<userData>/apiweave.db` |
| Secret keyfile | `<userData>/keyfile` |
| MCP token (when enabled) | `<userData>/mcp.token` |
| Run artifacts (JUnit, HTML) | `<userData>/artifacts/` |
| App logs (renderer + main) | The terminal that launched Electron, or the OS console |

`<userData>` is the OS-standard user data path for the app:

- **Windows**: `%APPDATA%\APIWeave`
- **macOS**: `~/Library/Application Support/APIWeave`
- **Linux**: `~/.config/APIWeave`

## Next Steps

Move on to [Your First Workflow](first-workflow.md) for a 5-minute tour of the canvas. If you would rather read the building blocks first, [Concepts](concepts.md) defines every term you will see in the rest of the docs.

## Troubleshooting

- **If the Windows installer is blocked by SmartScreen**, click **More info → Run anyway**. The binaries are unsigned.
- **If macOS Gatekeeper blocks the first launch**, right-click the app in **Applications** and choose **Open**, or clear the quarantine flag with `xattr -dr com.apple.quarantine /Applications/APIWeave.app`.
- **If the Linux AppImage fails with a FUSE error** (common on Arch), install FUSE 2 (`sudo pacman -S fuse2`) or run with `--appimage-extract-and-run`. The `.pacman` package has no such requirement.
- **If the app opens to a blank window**, your GPU driver may not be compatible with the renderer's WebGL canvas. Launch with `apiweave --disable-gpu` to use the software rasterizer.
- **If the data directory is read-only**, the OS user account does not have write permission to the user data path. Check the OS-level permission on the path and the disk's free space.
- **If the MCP bridge refuses to start**, another process is already bound to the chosen loopback port. Change the port in the MCP settings, or stop the conflicting process.

## Related

- [Your First Workflow](first-workflow.md)
- [Concepts](concepts.md)
- [Workflows and Nodes](../features/workflows-and-nodes.md)
- [Environment Variables Reference](../reference/environment-variables.md)
- [Changelog](../../CHANGELOG.md) for the desktop transition.
