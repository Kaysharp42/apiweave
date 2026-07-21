import type { ContractResult } from "./errors"

/**
 * The single primitive the preload bridge exposes across `contextBridge`. Every
 * typed method on the client funnels through it. Kept as a plain function (not a
 * Proxy) because `contextBridge` cannot clone Proxies — the ergonomic proxy is
 * built renderer-side by `createApiweaveClient` after `invoke` crosses the bridge.
 */
export type InvokeFn = (
  domain: string,
  action: string,
  payload: unknown,
) => Promise<ContractResult<unknown>>

export type ClientMethod = (payload?: unknown) => Promise<ContractResult<unknown>>

export type ApiweaveClient = Readonly<Record<string, Readonly<Record<string, ClientMethod>>>>

/**
 * Wraps a raw `invoke` into `client.domain.action(payload)` sugar. Renderer code
 * (Task 17) casts the result to a contract-typed client for compile-time safety;
 * the runtime behaviour is uniform regardless of the cast.
 */
export function createApiweaveClient(invoke: InvokeFn): ApiweaveClient {
  const domainProxy = (domain: string): Readonly<Record<string, ClientMethod>> =>
    new Proxy(
      {},
      {
        get: (_t, action: string | symbol): ClientMethod | undefined =>
          typeof action === "string"
            ? (payload?: unknown) => invoke(domain, action, payload)
            : undefined,
      },
    )

  return new Proxy(
    {},
    {
      get: (_t, domain: string | symbol) =>
        typeof domain === "string" ? domainProxy(domain) : undefined,
    },
  )
}
