import { z } from "zod"
import { BrowserChannelSchema } from "./BrowserChannelSchema"

/**
 * Settings > Browser, as stored in `app_settings` (`browser.settings`).
 * Per machine and never part of a workflow or an export.
 */
export const BrowserSettingsSchema = z
  .object({
    channel: BrowserChannelSchema.optional().describe(
      "Installed browser runs use. Absent means auto: the first of Google Chrome, Microsoft Edge and Playwright's Chromium that starts.",
    ),
    showBrowser: z.boolean().describe(
      "Show the browser window while a run drives it. Applies to runs started from the desktop app; agent-started runs are always headless.",
    ),
  })
  .strict()
