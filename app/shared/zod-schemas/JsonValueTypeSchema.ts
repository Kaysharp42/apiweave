import { z } from "zod"

export const JsonValueTypeSchema = z.enum(["null", "boolean", "number", "string", "array", "object"])
