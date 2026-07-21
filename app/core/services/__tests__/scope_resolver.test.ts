import { afterEach, describe, expect, it } from "vitest"
import type { ScopeRef } from "../../auth/PermissionProvider"
import { LocalOwnerProvider } from "../../auth/LocalOwnerProvider"
import {
  getPermissionProvider,
  resetPermissionProvider,
  setPermissionProvider,
} from "../../services-locator"
import {
  LOCAL_OWNER_ID,
  ScopeResolver,
  type ScopeExistence,
} from "../scope_resolver"

/** Fake existence source: workspace/environment ids present in the sets exist. */
function fakeExistence(workspaces: string[], environments: string[] = []): ScopeExistence {
  const ws = new Set(workspaces)
  const env = new Set(environments)
  return {
    workspaceExists: (id) => ws.has(id),
    environmentExists: (id) => env.has(id),
  }
}

describe("ScopeResolver existence-hiding", () => {
  // Seed a workspace the owner can see (A); no workspace B.
  const resolver = new ScopeResolver(fakeExistence(["A"], ["env-A"]))

  it("returns not_found — NOT denied — for an unknown workspace", async () => {
    const result = await resolver.resolve({ scopeType: "workspace", scopeId: "B" })
    expect(result.ok).toBe(false)
    // The security-critical assertion: unknown scope must not leak existence.
    expect(result.ok === false && result.code).toBe("not_found")
    expect(result.ok === false && result.code).not.toBe("denied")
  })

  it("resolves a known workspace successfully", async () => {
    const scope: ScopeRef = { scopeType: "workspace", scopeId: "A" }
    const result = await resolver.resolve(scope)
    expect(result).toEqual({ ok: true, scope })
  })

  it("returns not_found for an unknown environment", async () => {
    const result = await resolver.resolve({ scopeType: "environment", scopeId: "env-B" })
    expect(result.ok === false && result.code).toBe("not_found")
  })

  it("resolves a known environment successfully", async () => {
    const result = await resolver.resolve({ scopeType: "environment", scopeId: "env-A" })
    expect(result.ok).toBe(true)
  })

  it("resolves the local owner's own user scope", async () => {
    const result = await resolver.resolve({ scopeType: "user", scopeId: LOCAL_OWNER_ID })
    expect(result.ok).toBe(true)
  })

  it("hides a foreign user scope as not_found", async () => {
    const result = await resolver.resolve({ scopeType: "user", scopeId: "usr-someone-else" })
    expect(result.ok === false && result.code).toBe("not_found")
  })
})

describe("LocalOwnerProvider always-allow", () => {
  const provider = new LocalOwnerProvider()
  const scope: ScopeRef = { scopeType: "workspace", scopeId: "A" }

  it("allows every action on a known scope for the local owner", () => {
    for (const action of ["read", "create", "update", "delete", "run"] as const) {
      expect(provider.evaluate(action, scope, "workflows")).toEqual({ decision: "allow" })
    }
  })
})

describe("service-locator PermissionProvider singleton", () => {
  afterEach(() => resetPermissionProvider())

  it("defaults to LocalOwnerProvider", () => {
    resetPermissionProvider()
    expect(getPermissionProvider()).toBeInstanceOf(LocalOwnerProvider)
  })

  it("setPermissionProvider overrides and reset reseeds the default", () => {
    const custom = new LocalOwnerProvider()
    setPermissionProvider(custom)
    expect(getPermissionProvider()).toBe(custom)
    resetPermissionProvider()
    expect(getPermissionProvider()).toBeInstanceOf(LocalOwnerProvider)
  })
})
