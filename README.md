# APIWeave

Visual API Test Story Builder. Build, run, and inspect API test workflows on a canvas.

## What Is APIWeave?

APIWeave is a local-first, open-source desktop app for visual API testing. You assemble test workflows on a ReactFlow canvas from drag-and-drop nodes (HTTP request, assertion, delay, merge, start, end), chain requests with extracted variables and dynamic functions, run them against an environment, and inspect results node by node. Projects group workflows into ordered runs. Environments and secrets live on your machine, encrypted at rest. Webhooks and the MCP server are not part of the desktop app — you run the workflow from the UI or from a local agent.

APIWeave ships as a single-process Electron app with an embedded SQLite store. There is no server to deploy, no MongoDB to install, no SSO to configure, no ports to expose. Download the installer, run it, and you are inside the canvas in seconds.

## Quick Start

**Recommended for most users:** download the installer for your OS from the [latest release](https://github.com/Kaysharp42/apiweave/releases). The installer puts a self-contained app on your machine. No Python, no Node, no database, no Docker.

**For contributors:** clone the repo, install the desktop and frontend dependencies, and run the dev shell. See the [Developer Guide](AGENTS.md) for the dev workflow.

> **npm 12+ note:** The `@apiweave/proto` dependency is a remote tarball. npm 12+ blocks this by default — `scripts/setup.sh` creates `app/.npmrc` with `allow-remote=all` automatically. If your global npm config has `allow-scripts=false`, Electron's postinstall will be blocked; `scripts/setup.sh` also downloads the binary manually in that case.

## Desktop App

APIWeave ships as a self-contained Electron app. The app is single-process: the renderer (the React UI), the main process (the Node.js execution engine), the embedded SQLite store, and the optional local MCP bridge all run inside one process, talking to each other over Electron IPC. No external services. No open ports on your network. No telemetry.

Download the installer for your OS from the [latest release](https://github.com/Kaysharp42/apiweave/releases), or build it locally with `scripts/desktop.ps1 build` (Windows) or `scripts/desktop.sh build` (Linux/macOS).

### Windows

Run `APIWeave-<version>-win-x64.exe`. It installs per-user (no admin prompt) and adds a Start-menu entry. The installer and binaries are unsigned, so SmartScreen may warn on first launch — choose **More info → Run anyway**.

### macOS

Download the `mac-x64.dmg` build for Intel Macs or the `mac-arm64.dmg` build for Apple Silicon, then drag APIWeave to Applications. The build is unsigned/un-notarized, so the first launch is blocked by Gatekeeper: right-click the app → **Open**, or clear the quarantine flag with `xattr -dr com.apple.quarantine /Applications/APIWeave.app`.

### Linux

Four artifacts are published; pick what fits your distro:

- **AppImage** — portable, runs on any distro. `chmod +x APIWeave-<version>-linux-x86_64.AppImage && ./APIWeave-<version>-linux-x86_64.AppImage`.
- **`.deb`** — Debian, Ubuntu, and Mint: `sudo apt install ./APIWeave-<version>-linux-amd64.deb`.
- **`.rpm`** — Fedora, RHEL, and openSUSE: `sudo dnf install ./APIWeave-<version>-linux-x86_64.rpm`.
- **`.pacman`** — Arch and Manjaro: `sudo pacman -U APIWeave-<version>-linux-x64.pacman`.

**Arch Linux + Hyprland (Wayland).** The app requests native Wayland automatically (`ozone-platform-hint=auto`), so it runs directly on Hyprland with no XWayland. Two Arch-specific notes:

- The **AppImage** needs FUSE 2 (`sudo pacman -S fuse2`), or run it with `./APIWeave-<version>-linux-x86_64.AppImage --appimage-extract-and-run`. The **`.pacman`** package has no such requirement — prefer it on Arch.
- If a compositor quirk forces XWayland, launch with an explicit override: `apiweave --ozone-platform=wayland` (or `--ozone-platform=x11` to force XWayland).

The Linux binaries are built on Ubuntu (older glibc), so they run on Arch's newer glibc without issue.

## Features

The feature guides are the deep reference for everything you can do in APIWeave. Each is a self-contained tutorial with worked examples and a troubleshooting section.

- [Workflows and Nodes](docs/features/workflows-and-nodes.md): canvas, the six node types, toolbar actions, resume after a failed run.
- [Variables and Extractors](docs/features/variables-and-extractors.md): the four placeholder namespaces and how to pull values from responses.
- [Projects](docs/features/projects.md): ordered groups of workflows, project runs, and `.awecollection` v2 export and import (references only).
- [Environments and Secrets](docs/features/environments-and-secrets.md): local environments, the encrypted secret store, and the metadata-only display.
- [MCP Integration](docs/features/mcp-integration.md): a local loopback HTTP bridge for AI agents. The desktop app has no webhooks and no exposed ports.
- [Swagger and OpenAPI Import](docs/features/swagger-import.md): turn a spec into reusable request templates.

## Documentation

The [Documentation Hub](docs/README.md) is the entry point for every user-facing guide. It routes you through three paths (use it, build with it, fix something) and links to the reference index. Start there for install paths, the first-workflow tutorial, and the central FAQ.

There is no operations section in the desktop app: no authentication to set up, no deployment to plan, no security guide to follow beyond the encrypted-at-rest secret store, and no audit log. Everything is on your machine.

## Tech Stack

- Frontend (renderer): React 18, ReactFlow 11, Vite 5, Tailwind CSS 3, Zustand 5, TypeScript strict.
- Desktop shell: Electron 33, esbuild, electron-builder.
- Local store: better-sqlite3 (embedded SQLite, single file).
- IPC: a typed handler registry in the main process. The same handlers back the local MCP HTTP bridge on the loopback interface.
- Secrets: Libsodium sealed-box write-only ingress plus envelope encryption at rest. No plaintext on the wire, no read API for stored values.
- Execution: an in-process `RunScheduler` driven by IPC events streamed to the renderer.

## Project Layout

```text
apiweave/
  app/
    src/       React app, ReactFlow canvas, contexts, components (the renderer)
    electron/  Electron main process and preload entry points
    core/      IPC handlers, repositories, runner, services, and MCP bridge
    shared/    Cross-process TypeScript contracts and Zod schemas
    package.json
  scripts/     setup / start / build scripts (Linux + Windows)
  docs/        User-facing documentation (the hub and all guides)
  progress/    Internal implementation notes and history
```

## License

MIT. See [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, branching, commit style, and the pull-request flow. The developer workflow lives in [AGENTS.md](AGENTS.md).

## Roadmap

See [ROADMAP.md](ROADMAP.md) for what's next. For historical releases, see [CHANGELOG.md](CHANGELOG.md).
