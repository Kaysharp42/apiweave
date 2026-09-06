import type { z } from "zod"
import type { NoteNodeDataSchema } from "../zod-schemas/NoteNodeDataSchema"

export type NoteNodeData = z.infer<typeof NoteNodeDataSchema>
