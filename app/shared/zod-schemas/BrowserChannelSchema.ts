import { z } from "zod"

/**
 * Which installed browser runs `browser` nodes: Google Chrome, Microsoft Edge,
 * or the Chromium build Playwright downloads (`npx playwright install chromium`).
 */
export const BrowserChannelSchema = z.enum(["chrome", "msedge", "chromium"])
