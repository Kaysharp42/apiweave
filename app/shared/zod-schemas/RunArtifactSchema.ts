import { z } from "zod"

/**
 * A stored run artifact's bytes on the wire. Base64 rather than a Buffer
 * because every transport here is JSON (the renderer's IPC bridge and the MCP
 * bridge's loopback HTTP); the renderer turns it into an object URL.
 */
export const RunArtifactSchema = z
  .object({
    mime: z.string().min(1),
    base64: z.string(),
  })
  .strict()
