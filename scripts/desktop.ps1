# Build/run the APIWeave desktop (Tauri) app on Windows.
#   .\scripts\desktop.ps1          # dev: live Vite dev server (HMR) + hot Rust reload
#   .\scripts\desktop.ps1 build    # produce the .msi/.exe installer
# dev serves the frontend from the Vite dev server (devUrl in tauri.conf.json) so
# frontend edits hot-reload; build compiles the static frontend bundle first.
# Start the backend/worker/mongod yourself for now (Phase 1/2 wires sidecars in).
param([ValidateSet('dev', 'build')][string]$Command = 'dev')
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $repo 'desktop')

# Tauri CLI is a devDependency; install it on first run.
if (-not (Test-Path node_modules)) { npm install }

# The MSVC target needs link.exe + a LIB that includes the Windows SDK.
# Always (re)activate the VS Developer environment rather than skipping when
# link.exe already exists: a stale LIB from an earlier activation (or a link.exe
# inherited from conda/PATH) would otherwise be reused, and the linker fails with
# "cannot open input file 'kernel32.lib'". Activation rebuilds LIB from scratch,
# so running it every time is safe and idempotent.
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
    throw "Visual Studio Installer not found. Install VS Build Tools with the 'Desktop development with C++' workload."
}
$vsPath = & $vswhere -latest -products * `
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    -property installationPath
if (-not $vsPath) {
    throw "No VS install with the C++ toolset found. Add the 'Desktop development with C++' workload."
}
Import-Module (Join-Path $vsPath 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll')
Enter-VsDevShell -VsInstallPath $vsPath -SkipAutomaticLocation `
    -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
Set-Location (Join-Path $repo 'desktop')  # dev shell can move us; go back

# Fail with one clear line if the SDK libs still aren't on LIB, instead of a
# 400-line linker error deep inside the cargo build.
if (-not ($env:LIB -split ';' | Where-Object { $_ -and (Test-Path (Join-Path $_ 'kernel32.lib')) })) {
    throw "Windows SDK libs not on LIB after activating VS (WindowsSDKVersion=$env:WindowsSDKVersion). Install/repair the Windows 11 SDK (Desktop C++) in Visual Studio."
}

npx tauri $Command
