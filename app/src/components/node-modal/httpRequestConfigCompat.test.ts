import { describe, expect, it } from "vitest";
import { OAuth2AuthConfigSchema } from "@shared/zod-schemas/AuthConfigSchema";
import { normalizeAuthConfig, normalizeExpectedStatus, normalizeHttpRequestConfig, normalizeRetry } from "./httpRequestConfigCompat";
import { graphqlVariablesProblem } from "./GraphqlBodyEditor";
import { oauth2Problems } from "./OAuth2AuthFields";
import { awsSigV4Problems } from "./AwsSigV4AuthFields";
import { AwsSigV4AuthConfigSchema } from "@shared/zod-schemas/AuthConfigSchema";
import { secretNameOf, secretReferenceFor } from "./SecretNameField";

describe("normalizeAuthConfig", () => {
  it("drops stale sub-configs from other auth types", () => {
    const result = normalizeAuthConfig({
      type: "none",
      bearer: { token: "old-token" },
      basic: { username: "u", password: "old-pass" },
      apiKey: { key: "X-Api-Key", value: "old-secret", addTo: "header" },
    });
    expect(result).toEqual({ type: "none" });
  });

  it("keeps only the selected type's sub-config", () => {
    const result = normalizeAuthConfig({
      type: "bearer",
      bearer: { token: "keep-me" },
      apiKey: { key: "X-Api-Key", value: "stale-secret", addTo: "header" },
    });
    expect(result).toEqual({ type: "bearer", bearer: { token: "keep-me" } });
  });

  it("preserves apiKey config when selected", () => {
    const result = normalizeAuthConfig({
      type: "apiKey",
      apiKey: { key: "X-Api-Key", value: "current-secret", addTo: "query" },
    });
    expect(result).toEqual({
      type: "apiKey",
      apiKey: { key: "X-Api-Key", value: "current-secret", addTo: "query" },
    });
  });

  it("gives a new OAuth 2.0 config schema-valid defaults, and drops sign-in fields for client credentials", () => {
    const fresh = normalizeAuthConfig({ type: "oauth2" });
    expect(OAuth2AuthConfigSchema.safeParse(fresh.oauth2).success).toBe(true);
    expect(fresh.oauth2).toMatchObject({ grantType: "client_credentials", clientAuth: "basic" });

    const switched = normalizeAuthConfig({
      type: "oauth2",
      oauth2: { ...fresh.oauth2, grantType: "client_credentials", authorizationUrl: "x", tokenSecret: "{{secrets.T}}" },
    });
    expect(switched.oauth2).not.toHaveProperty("tokenSecret");
    expect(switched.oauth2).not.toHaveProperty("authorizationUrl");
  });
});

describe("OAuth 2.0 secret fields", () => {
  it("store only a {{secrets.NAME}} reference, whatever is typed", () => {
    expect(secretReferenceFor("CLIENT_SECRET")).toBe("{{secrets.CLIENT_SECRET}}");
    expect(secretReferenceFor("my-secret value!")).toBe("{{secrets.mysecretvalue}}");
    expect(secretReferenceFor("9abc")).toBe("{{secrets.abc}}");
    expect(secretReferenceFor("")).toBe("");
    expect(secretNameOf("{{secrets.CLIENT_SECRET}}")).toBe("CLIENT_SECRET");
    for (const typed of ["hunter2", "{{env.X}}", "a b"]) {
      expect(OAuth2AuthConfigSchema.shape.clientSecret.safeParse(secretReferenceFor(typed)).success).toBe(true);
    }
  });

  it("explain what a config is missing before it can get a token", () => {
    const problems = oauth2Problems({ grantType: "authorization_code", tokenUrl: "", clientId: "c" });
    expect(problems).toMatchObject({
      tokenUrl: "Enter the token URL",
      clientId: "",
      clientSecret: "",
      authorizationUrl: "Enter the authorization URL",
      tokenSecret: "Name the secret to store the token in",
    });
  });
});

describe("normalizeExpectedStatus", () => {
  it("keeps a single in-range status code", () => {
    expect(normalizeExpectedStatus(409)).toBe(409);
  });

  it("keeps an array of in-range status codes", () => {
    expect(normalizeExpectedStatus([409, 422])).toEqual([409, 422]);
  });

  it("drops out-of-range or non-integer entries from an array instead of discarding the whole field", () => {
    expect(normalizeExpectedStatus([409, 42, 200.5, 900])).toEqual([409]);
  });

  it("returns undefined for an out-of-range single value, an empty array, or a non-numeric value", () => {
    expect(normalizeExpectedStatus(42)).toBeUndefined();
    expect(normalizeExpectedStatus([])).toBeUndefined();
    expect(normalizeExpectedStatus("409")).toBeUndefined();
    expect(normalizeExpectedStatus(undefined)).toBeUndefined();
  });
});

describe("normalizeRetry", () => {
  it("clamps to what the workflow schema accepts and keeps rules editable", () => {
    expect(
      normalizeRetry({
        maxAttempts: 500,
        intervalMs: -5,
        backoff: "exponential",
        maxIntervalMs: 9_999_999,
        until: [{ source: "status", path: "", operator: "equals", expectedValue: 200 }, "junk"],
      }),
    ).toEqual({
      maxAttempts: 100,
      intervalMs: 0,
      backoff: "exponential",
      maxIntervalMs: 3_600_000,
      until: [{ source: "status", path: "", operator: "equals", expectedValue: "200" }],
    });
  });

  it("drops a backoff cap that only exponential backoff uses, and an absent policy", () => {
    expect(normalizeRetry({ maxAttempts: 3, intervalMs: 10, maxIntervalMs: 50 })).toEqual({ maxAttempts: 3, intervalMs: 10 });
    expect(normalizeRetry(undefined)).toBeUndefined();
  });
});

describe("GraphQL body", () => {
  it("keeps the GraphQL body type and drops empty variables and operation name", () => {
    const config = normalizeHttpRequestConfig({ bodyType: "graphql", graphql: { query: "{ me }", variables: "", operationName: "" } });
    expect(config.bodyType).toBe("graphql");
    expect(config.graphql).toEqual({ query: "{ me }" });
  });

  it("accepts variables whose placeholders stand in for values, and flags anything but an object", () => {
    expect(graphqlVariablesProblem('{"id": {{variables.id}}, "name": "{{env.NAME}}"}')).toBeUndefined();
    expect(graphqlVariablesProblem("")).toBeUndefined();
    expect(graphqlVariablesProblem("[1]")).toBe("Variables must be a JSON object");
    expect(graphqlVariablesProblem("{oops")).toBeDefined();
  });
});

describe("AWS Signature V4 auth", () => {
  it("normalizes to a schema-valid config, dropping an empty session token", () => {
    const auth = normalizeAuthConfig({ type: "awsSigV4", awsSigV4: { region: "us-east-1", sessionToken: "" }, bearer: { token: "stale" } });
    expect(auth).toEqual({
      type: "awsSigV4",
      awsSigV4: { accessKeyId: "", secretAccessKey: "", region: "us-east-1", service: "" },
    });
    expect(AwsSigV4AuthConfigSchema.safeParse(auth.awsSigV4).success).toBe(true);
  });

  it("names every field still missing", () => {
    const problems = awsSigV4Problems({ accessKeyId: "AKID", secretAccessKey: "", region: " ", service: "s3" });
    expect(problems).toEqual({
      accessKeyId: "",
      secretAccessKey: "Name the secret holding the secret access key",
      region: "Enter the region",
      service: "",
    });
  });
});

describe("Digest auth", () => {
  it("keeps only the username and the password's secret reference", () => {
    expect(
      normalizeAuthConfig({ type: "digest", digest: { username: "{{env.USER}}", password: "{{secrets.PASS}}", extra: 1 }, basic: { username: "x", password: "y" } }),
    ).toEqual({ type: "digest", digest: { username: "{{env.USER}}", password: "{{secrets.PASS}}" } });
  });
});
