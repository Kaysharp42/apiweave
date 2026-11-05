/**
 * What About reports about the running app: the versions it is built on, where
 * it is running, and where it keeps its data. Nothing here is secret — the
 * diagnostics block copies exactly these fields.
 */
export interface AppInfo {
  readonly version: string;
  readonly electron: string;
  readonly chromium: string;
  readonly node: string;
  /** `process.platform` — win32, darwin, linux. */
  readonly platform: string;
  /** `process.arch` — x64, arm64. */
  readonly arch: string;
  /** `os.release()` — the kernel release, not a marketing name. */
  readonly osVersion: string;
  readonly dataFolder: string;
}
