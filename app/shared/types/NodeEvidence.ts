import type { z } from "zod"
import type { NodeEvidenceSchema } from "../zod-schemas/NodeEvidenceSchema"

export type NodeEvidence = z.infer<typeof NodeEvidenceSchema>
