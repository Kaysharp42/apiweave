import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __clearSwaggerCacheForTests,
  MAX_SWAGGER_CACHE_ENTRIES,
  SWAGGER_CACHE_TTL_MS,
  fetchSwaggerNodes,
  swaggerCacheKey,
} from "./useSwaggerRefresh";
import * as apiweaveClient from "../utils/apiweaveClient";

describe("fetchSwaggerNodes caching", () => {
  afterEach(() => {
    __clearSwaggerCacheForTests();
    vi.restoreAllMocks();
  });

  it("reuses the cached result across calls for the same key instead of refetching", async () => {
    const fetchSpy = vi
      .spyOn(apiweaveClient, "authenticatedFetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: [], stats: {} }),
      } as Response);

    const key = swaggerCacheKey("ws1", "https://api.example.com/swagger.json");
    await fetchSwaggerNodes("https://server/import?url=1", key, false);
    await fetchSwaggerNodes("https://server/import?url=1", key, false);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent in-flight requests for the same key into one fetch", async () => {
    let resolveResponse: (v: Response) => void;
    const fetchSpy = vi
      .spyOn(apiweaveClient, "authenticatedFetch")
      .mockReturnValue(
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
      );

    const key = swaggerCacheKey("ws1", "https://api.example.com/swagger.json");
    const first = fetchSwaggerNodes("https://server/import?url=1", key, false);
    const second = fetchSwaggerNodes("https://server/import?url=1", key, false);

    resolveResponse!({
      ok: true,
      json: async () => ({ nodes: [], stats: {} }),
    } as Response);

    await Promise.all([first, second]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("bypasses the cache when force=true", async () => {
    const fetchSpy = vi
      .spyOn(apiweaveClient, "authenticatedFetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: [], stats: {} }),
      } as Response);

    const key = swaggerCacheKey("ws1", "https://api.example.com/swagger.json");
    await fetchSwaggerNodes("https://server/import?url=1", key, false);
    await fetchSwaggerNodes("https://server/import?url=1", key, true);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("drops expired entries instead of returning stale results", async () => {
    const fetchSpy = vi
      .spyOn(apiweaveClient, "authenticatedFetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: [], stats: {} }),
      } as Response);

    const key = swaggerCacheKey("ws1", "https://api.example.com/swagger.json");
    await fetchSwaggerNodes("https://server/import?url=1", key, false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const now = Date.now();
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(now + SWAGGER_CACHE_TTL_MS + 1);
    try {
      await fetchSwaggerNodes("https://server/import?url=1", key, false);
    } finally {
      dateSpy.mockRestore();
    }

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest entry once the cache exceeds its max size", async () => {
    const fetchSpy = vi
      .spyOn(apiweaveClient, "authenticatedFetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: [], stats: {} }),
      } as Response);

    const firstKey = swaggerCacheKey("ws1", "https://api.example.com/0.json");
    for (let i = 0; i < MAX_SWAGGER_CACHE_ENTRIES + 1; i++) {
      const key = swaggerCacheKey("ws1", `https://api.example.com/${i}.json`);
      await fetchSwaggerNodes(`https://server/import?url=${i}`, key, false);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(MAX_SWAGGER_CACHE_ENTRIES + 1);

    // The first key was the oldest and should have been evicted.
    await fetchSwaggerNodes("https://server/import?url=0", firstKey, false);
    expect(fetchSpy).toHaveBeenCalledTimes(MAX_SWAGGER_CACHE_ENTRIES + 2);
  });
});
