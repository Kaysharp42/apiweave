import { z } from "zod"
import type { IpcRouter } from "../router"
import { NoInput, type HandlerDeps } from "./common"

const HttpSafetySettingsSchema = z
  .object({
    allowPrivateNetworks: z.boolean(),
  })
  .strict()

/**
 * App-scoped settings. Currently the single http-safety opt-in that unblocks
 * RFC1918/unique-local targets on the shared SafeHttp instance; the value is
 * persisted by the composition root and applied live.
 */
export function registerSettingsHandlers(router: IpcRouter, deps: HandlerDeps): void {
  const { httpSafety } = deps

  router.register("settings", "get", {
    input: NoInput,
    output: HttpSafetySettingsSchema,
    handle: () => ({ allowPrivateNetworks: httpSafety.allowPrivateNetworks }),
  })

  router.register("settings", "setPrivateNetworks", {
    input: z.object({ enabled: z.boolean() }).strict(),
    output: HttpSafetySettingsSchema,
    handle: (i) => {
      httpSafety.setAllowPrivateNetworks(i.enabled)
      return { allowPrivateNetworks: httpSafety.allowPrivateNetworks }
    },
  })
}
