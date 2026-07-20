import { z } from "zod"

export const WorkspaceSyncModeSchema = z.enum(["none", "push", "bi-directional"])
