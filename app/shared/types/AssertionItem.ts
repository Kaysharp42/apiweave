import type { z } from "zod"
import type { AssertionItemSchema } from "../zod-schemas/AssertionItemSchema"

export type AssertionItem = z.infer<typeof AssertionItemSchema>
