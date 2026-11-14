import type { BrowserSettings } from "@shared/types/BrowserSettings"
import { BrowserSettingsSchema } from "@shared/zod-schemas/BrowserSettingsSchema"
import type { AppSettingsRepository } from "../repositories"
import { ValidationError } from "../ipc/errors"

const SETTINGS_KEY = "browser.settings"

/** An auto-chosen browser and a headless run: nothing to explain, nothing on screen. */
export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = { showBrowser: false }

/**
 * Settings > Browser: which installed browser a run drives and whether it is
 * visible. Machine-wide, like the network settings, so it lives in
 * `app_settings` and is never part of a workflow or an export.
 *
 * Nothing here opens a browser: the stored settings are read on every launch
 * decision, and `core/runner/browser/detect.ts` is what probes the machine.
 */
export class BrowserSettingsService {
  public constructor(private readonly settings: AppSettingsRepository) {}

  /** The stored settings; unreadable or stale data falls back to the default. */
  public get(): BrowserSettings {
    const raw = this.settings.get(SETTINGS_KEY)
    if (raw === undefined) return DEFAULT_BROWSER_SETTINGS
    try {
      const parsed = BrowserSettingsSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : DEFAULT_BROWSER_SETTINGS
    } catch {
      // A row that is not JSON at all is as unusable as one that is the wrong shape.
      return DEFAULT_BROWSER_SETTINGS
    }
  }

  /** Validate, then store. Returns what was stored, so the caller reads one shape. */
  public save(input: unknown): BrowserSettings {
    const parsed = BrowserSettingsSchema.safeParse(input)
    if (!parsed.success) throw new ValidationError("These browser settings are not valid", parsed.error.issues)
    this.settings.set(SETTINGS_KEY, JSON.stringify(parsed.data))
    return parsed.data
  }
}
