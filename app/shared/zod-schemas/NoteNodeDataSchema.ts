import { z } from "zod"

/** Persisted text for a canvas-only sticky note. */
export const NoteNodeDataSchema = z
  .object({
    content: z.string().optional(),
  })
  .strict()
