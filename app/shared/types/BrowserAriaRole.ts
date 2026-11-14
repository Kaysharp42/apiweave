import type { z } from "zod"
import type { BrowserAriaRoleSchema } from "../zod-schemas/BrowserLocatorSchema"

export type BrowserAriaRole = z.infer<typeof BrowserAriaRoleSchema>
