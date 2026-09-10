import type { z } from "zod"
import type { NodeSearchPageSchema } from "../zod-schemas/NodeSearchPageSchema"

export type NodeSearchPage = z.infer<typeof NodeSearchPageSchema>
