import { describe, expect, it } from "vitest";
import { isSensitiveAutoRefreshTarget } from "./useSwaggerRefresh";

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
