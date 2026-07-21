import { z } from "zod"

export const IdSchema = z.string().min(1)
