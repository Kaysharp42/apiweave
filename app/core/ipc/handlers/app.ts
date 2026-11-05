import { z } from "zod"
import type { AppInfo } from "@shared/types/AppInfo"
import { AppInfoSchema } from "@shared/zod-schemas"
import type { IpcRouter } from "../router"
import { NoInput } from "./common"

/**
 * What About needs from the process it is running in. Injected rather than
 * imported so the handler module stays Electron-free like every other domain.
 */
export interface AppHandlerDeps {
  readonly info: AppInfo
  /** Open the data folder in the OS file manager. */
  readonly revealDataFolder: () => void
}

/**
 * Facts about the running app, plus the one file-manager action About offers.
 * Read-only: it describes this install, it cannot change it.
 */
export function registerAppHandlers(router: IpcRouter, deps: AppHandlerDeps): void {
  router.register("app", "info", {
    input: NoInput,
    output: AppInfoSchema,
    handle: () => deps.info,
  })

  router.register("app", "revealDataFolder", {
    input: NoInput,
    output: z.null(),
    handle: () => {
      deps.revealDataFolder()
      return null
    },
  })
}
