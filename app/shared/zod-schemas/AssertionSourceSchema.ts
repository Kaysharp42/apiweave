import { z } from "zod"

export const AssertionSourceSchema = z.enum(["prev", "variables", "status", "cookies", "headers"])
