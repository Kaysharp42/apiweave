import { z } from "zod"

export const TimestampSchema = z.iso.datetime()
