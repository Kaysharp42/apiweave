import { z } from "zod"

/** A secret a Postman import references but never stores: the user creates it under `name`. */
export const PostmanRequiredSecretSchema = z
  .object({
    name: z.string(),
    /** What in the collection it replaces, e.g. `bearer token of collection "Shop"` or `variable {{apiKey}}`. */
    usedBy: z.string(),
  })
  .strict()
