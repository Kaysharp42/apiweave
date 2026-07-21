import { z } from "zod"

export const RevisionSchema = z.number().int().nonnegative()
