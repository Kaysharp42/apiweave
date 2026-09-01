import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __clearSwaggerCacheForTests,
  fetchSwaggerNodes,
  isSensitiveAutoRefreshTarget,
  swaggerCacheKey,
} from "./useSwaggerRefresh";
import * as apiweaveClient from "../utils/apiweaveClient";

describe("isSensitiveAutoRefreshTarget", () => {
  it.each([
    "http://localhost:8080/swagger.json",
    "http://127.0.0.1/swagger.json",
    "http://[::1]/swagger.json",
    "http://host.docker.internal/swagger.json",
    "http://10.0.0.5/swagger.json",
    "http://172.20.0.1/swagger.json",
    "http://192.168.1.1/swagger.json",
    "http://169.254.169.254/latest/meta-data",
  ])("flags loopback/private target: %s", (url) => {
    expect(isSensitiveAutoRefreshTarget(url)).toBe(true);
  });

  it.each([
    "https://api.example.com/swagger.json",
    "https://petstore.swagger.io/v2/swagger.json",
    "not a url",
    "",
  ])("allows public/invalid target: %s", (url) => {
    expect(isSensitiveAutoRefreshTarget(url)).toBe(false);
  });
});

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
});
