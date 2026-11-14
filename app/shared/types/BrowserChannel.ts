import type { z } from "zod"
import type { BrowserChannelSchema } from "../zod-schemas/BrowserChannelSchema"

export type BrowserChannel = z.infer<typeof BrowserChannelSchema>
