import type { AppInfo } from "@shared/types/AppInfo";

const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  win32: "Windows",
  darwin: "macOS",
  linux: "Linux",
};

/** "Windows (x64) · 10.0.22631" — the kernel release, not a marketing name. */
export function platformLabel(info: AppInfo): string {
  const name = PLATFORM_NAMES[info.platform] ?? info.platform;
  return `${name} (${info.arch}) · ${info.osVersion}`;
}

/**
 * The plain-text block Copy diagnostics puts on the clipboard: versions,
 * platform and the data folder, and nothing that could carry a credential.
 */
export function diagnosticsText(info: AppInfo): string {
  return [
    `APIWeave ${info.version}`,
    `Electron ${info.electron}`,
    `Chromium ${info.chromium}`,
    `Node ${info.node}`,
    `Platform ${platformLabel(info)}`,
    `Data folder ${info.dataFolder}`,
  ].join("\n");
}
