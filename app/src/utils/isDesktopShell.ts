export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && Boolean(window.__APIWEAVE_IPC__);
}
