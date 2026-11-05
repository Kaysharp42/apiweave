import { describe, expect, it, vi } from "vitest"
import type { AppInfo } from "@shared/types/AppInfo"
import { IpcRouter } from "../../router"
import { registerAppHandlers } from "../app"

const INFO: AppInfo = {
  version: "1.0.0",
  electron: "44.10.1",
  chromium: "142.0.0.0",
  node: "22.12.0",
  platform: "win32",
  arch: "x64",
  osVersion: "10.0.22631",
  dataFolder: "C:\\Users\\test\\AppData\\Roaming\\APIWeave",
}

function routerFor(revealDataFolder: () => void = vi.fn()): IpcRouter {
  const router = new IpcRouter()
  registerAppHandlers(router, { info: INFO, revealDataFolder })
  return router
}

describe("app handlers", () => {
  it("returns the injected app facts unchanged", async () => {
    const result = await routerFor().dispatch({ domain: "app", action: "info", payload: {} })

    expect(result).toEqual({ ok: true, data: INFO })
  })

  it("reveals the data folder and returns nothing to read", async () => {
    const reveal = vi.fn()
    const result = await routerFor(reveal).dispatch({ domain: "app", action: "revealDataFolder", payload: {} })

    expect(result).toEqual({ ok: true, data: null })
    expect(reveal).toHaveBeenCalledOnce()
  })

  it("rejects an unknown action rather than guessing one", async () => {
    const result = await routerFor().dispatch({ domain: "app", action: "quit", payload: {} })

    expect(result.ok).toBe(false)
  })
})
