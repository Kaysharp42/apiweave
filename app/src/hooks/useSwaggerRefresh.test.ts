import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __clearSwaggerCacheForTests,
  MAX_SWAGGER_CACHE_ENTRIES,
  SWAGGER_CACHE_TTL_MS,
  fetchSwaggerNodes,
} from "./useSwaggerRefresh";
import { apiweave } from "../utils/apiweaveClient";

describe("fetchSwaggerNodes caching", () => {
  afterEach(() => {
    __clearSwaggerCacheForTests();
    vi.restoreAllMocks();
  });

  it("reuses the cached result across calls for the same key instead of refetching", async () => {
    const fetchSpy = vi
      .spyOn(apiweave.workflows, "importOpenapiUrl")
      .mockResolvedValue({ nodes: [], stats: {} });

    const doc = "https://api.example.com/swagger.json";
    await fetchSwaggerNodes("ws1", doc, false);
    await fetchSwaggerNodes("ws1", doc, false);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent in-flight requests for the same key into one fetch", async () => {
    let resolveResponse: (v: unknown) => void;
    const fetchSpy = vi
      .spyOn(apiweave.workflows, "importOpenapiUrl")
      .mockReturnValue(
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
      );

    const doc = "https://api.example.com/swagger.json";
    const first = fetchSwaggerNodes("ws1", doc, false);
    const second = fetchSwaggerNodes("ws1", doc, false);

    resolveResponse!({ nodes: [], stats: {} });

    await Promise.all([first, second]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("bypasses the cache when force=true", async () => {
    const fetchSpy = vi
      .spyOn(apiweave.workflows, "importOpenapiUrl")
      .mockResolvedValue({ nodes: [], stats: {} });

    const doc = "https://api.example.com/swagger.json";
    await fetchSwaggerNodes("ws1", doc, false);
    await fetchSwaggerNodes("ws1", doc, true);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("drops expired entries instead of returning stale results", async () => {
    const fetchSpy = vi
      .spyOn(apiweave.workflows, "importOpenapiUrl")
      .mockResolvedValue({ nodes: [], stats: {} });

    const doc = "https://api.example.com/swagger.json";
    await fetchSwaggerNodes("ws1", doc, false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const now = Date.now();
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(now + SWAGGER_CACHE_TTL_MS + 1);
    try {
      await fetchSwaggerNodes("ws1", doc, false);
    } finally {
      dateSpy.mockRestore();
    }

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest entry once the cache exceeds its max size", async () => {
    const fetchSpy = vi
      .spyOn(apiweave.workflows, "importOpenapiUrl")
      .mockResolvedValue({ nodes: [], stats: {} });

    for (let i = 0; i < MAX_SWAGGER_CACHE_ENTRIES + 1; i++) {
      await fetchSwaggerNodes("ws1", `https://api.example.com/${i}.json`, false);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(MAX_SWAGGER_CACHE_ENTRIES + 1);

    // The first key was the oldest and should have been evicted.
    await fetchSwaggerNodes("ws1", "https://api.example.com/0.json", false);
    expect(fetchSpy).toHaveBeenCalledTimes(MAX_SWAGGER_CACHE_ENTRIES + 2);
  });
});
