import { z } from "zod"

export const WorkspaceOriginSchema = z.enum(["local", "cloud", "team"])
