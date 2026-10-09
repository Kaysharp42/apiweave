import { describe, expect, it } from "vitest";
import { buildCurlCommand, buildFetchCommand } from "./copyAsCurl";
import type { NodeModalHTTPRequestConfig } from "../../types";

function baseConfig(overrides: Partial<NodeModalHTTPRequestConfig> = {}): NodeModalHTTPRequestConfig {
  return {
    method: "GET",
    url: "https://api.example.com/x",
    headers: [],
    queryParams: [],
    body: "",
    bodyType: "none",
    auth: { type: "none" },
    ...overrides,
  } as NodeModalHTTPRequestConfig;
}

describe("copyAsCurl — GraphQL", () => {
  const graphql = { query: "query U($id: ID!) { user(id: $id) { id } }", variables: '{"id": {{variables.id}}}', operationName: "U" };

  it("posts the query as JSON with a JSON Content-Type", () => {
    const curl = buildCurlCommand(baseConfig({ method: "POST", bodyType: "graphql", graphql }));
    expect(curl).toContain("Content-Type: application/json");
    expect(curl).toContain(`{"query": "query U($id: ID!) { user(id: $id) { id } }", "variables": {"id": {{variables.id}}}, "operationName": "U"}`);
  });

  it("puts a GET's query in the URL", () => {
    const fetchCmd = buildFetchCommand(baseConfig({ method: "GET", bodyType: "graphql", graphql }));
    const url = new URL(JSON.parse(fetchCmd.slice("fetch(".length, fetchCmd.indexOf(", {"))) as string);
    expect(url.searchParams.get("query")).toBe(graphql.query);
    expect(url.searchParams.get("variables")).toBe(graphql.variables);
    expect(fetchCmd).not.toContain('"body"');
  });
});

describe("copyAsCurl — Basic auth header", () => {
  it("base64-encodes username:password (RFC 7617), not the raw pair", () => {
    const config = baseConfig({
      auth: { type: "basic", basic: { username: "alice", password: "hunter2" } },
    });

    const curl = buildCurlCommand(config);
    expect(curl).toContain(`Authorization: Basic ${btoa("alice:hunter2")}`);
    expect(curl).not.toContain("alice:hunter2");

    const fetchCmd = buildFetchCommand(config);
    expect(fetchCmd).toContain(btoa("alice:hunter2"));
    expect(fetchCmd).not.toContain("alice:hunter2");
  });
});
