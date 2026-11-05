import { z } from "zod"

/** The running app's versions, platform and data folder — see `AppInfo`. */
export const AppInfoSchema = z
  .object({
    version: z.string().min(1),
    electron: z.string().min(1),
    chromium: z.string().min(1),
    node: z.string().min(1),
    platform: z.string().min(1),
    arch: z.string().min(1),
    osVersion: z.string(),
    dataFolder: z.string().min(1),
  })
  .strict()
