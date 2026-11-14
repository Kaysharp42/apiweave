import type { z } from "zod"
import type { BrowserLocatorSchema } from "../zod-schemas/BrowserLocatorSchema"

export type BrowserLocator = z.infer<typeof BrowserLocatorSchema>
