import type { z } from "zod"
import type { NodeEvidencePageSchema } from "../zod-schemas/NodeEvidencePageSchema"

export type NodeEvidencePage = z.infer<typeof NodeEvidencePageSchema>
