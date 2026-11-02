import { z } from "zod"
import { GuideContentSchema } from "@shared/zod-schemas"
import { NotFoundError } from "../errors"
import type { IpcRouter } from "../router"
import { MCP_GUIDES, guideUri } from "../../mcp/guide"

/**
 * Bounded guide reading over the registry, for MCP clients that cannot make
 * resources available to the model. Same {@link MCP_GUIDES} source the
 * resources serve — one text, two transports — so the prose cannot drift.
 */
export function registerGuideHandlers(router: IpcRouter): void {
  router.register("guides", "get", {
    input: z.object({ slug: z.string().min(1).describe("Guide slug: the last segment of a guide URI from server_info, e.g. start-here.") }).strict(),
    output: GuideContentSchema,
    handle: (input) => {
      const guide = MCP_GUIDES.find((candidate) => candidate.slug === input.slug)
      if (guide === undefined) throw new NotFoundError(`guide ${input.slug} not found`)
      return {
        slug: guide.slug,
        title: guide.title,
        description: guide.description,
        uri: guideUri(guide.slug),
        text: guide.text,
      }
    },
  })
}
