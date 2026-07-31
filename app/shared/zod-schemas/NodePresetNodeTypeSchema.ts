import { z } from "zod"

/**
 * The node types a preset can hold — the configurable arms of
 * `WorkflowNodeSchema`. `start`/`end` are deliberately excluded: they carry no
 * config, so there is nothing about them worth naming and reusing.
 */
export const NodePresetNodeTypeSchema = z.enum(["http-request", "assertion", "delay", "merge", "workflow"])
