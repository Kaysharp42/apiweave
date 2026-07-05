import { z } from "zod"

export const RunnerNodeStatusSchema = z.enum(["idle", "pending", "running", "passed", "failed", "skipped"])
