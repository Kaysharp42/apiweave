import { z } from "zod"

/**
 * Per-node CONFIG schema for `type: "group"` frames.
 *
 * A frame is canvas furniture: it groups nodes visually and moves them with it,
 * and it never executes. Its geometry therefore lives in `config` rather than
 * in runtime canvas state — the size a user drags a frame to is part of the
 * document, the same way `position` is.
 *
 * `color` is a design token name, not a CSS colour: the frame's tint has to
 * follow the theme, and a persisted `#rrggbb` would not.
 */
export const GroupNodeDataSchema = z
  .object({
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    color: z
      .enum(["slate", "blue", "green", "amber", "violet", "rose"])
      .optional(),
  })
  .strict()
