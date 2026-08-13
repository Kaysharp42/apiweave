/**
 * The cloud-sync redaction contract, asserted end to end.
 *
 * Three components decide what crosses the wire — the push sanitizer here, the
 * pull-side validator in `core/repositories/CloudSyncRepository.ts`, and the
 * server's `ValidateNoSecretPayload` in apiweave-cloud — and a disagreement
 * between any two of them strands a workflow: a sanitized payload a validator
 * rejects dead-letters after 10 push retries (blocking every later edit to that
 * record), and a payload the sanitizer keeps but the pull validator rejects
 * throws mid-pull on the receiving device, which then never advances its cursor
 * and stops syncing that workspace at all.
 *
 * So every fixture below is asserted twice: what the sanitizer emits, and that
 * the pull-side validator accepts that exact output. The same table is mirrored
 * in apiweave-cloud's `TestValidateNoSecretPayloadContract` (same fixture
 * names) to hold the third component to it — keep the two in step.
 */
import { describe, expect, it } from "vitest"
import type { JsonValue } from "@shared/types/JsonValue"
import type { Workflow } from "@shared/types/Workflow"
import { forbiddenCloudPayloadField } from "../../repositories/CloudSyncRepository"
import { recordWorkflowUpsert } from "../cloud-mutations"
import type { SyncMutation, SyncProvider } from "../SyncProvider"

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig"

interface Fixture {
  /** What the user configured on the sending machine. */
  readonly config: Record<string, JsonValue>
  /** What the sanitizer must put on the wire. */
  readonly expected: Record<string, JsonValue>
  /** Literals that must not survive anywhere in the payload. */
  readonly withheld?: readonly string[]
}

const fixtures: Record<string, Fixture> = {
  // Config that is not a credential and must round-trip untouched.
  plainBodyAndHeaders: {
    config: {
      body: "{\"username\":\"admin\",\"note\":\"hello\"}",
      headers: [{ key: "Content-Type", value: "application/json" }],
    },
    expected: {
      body: "{\"username\":\"admin\",\"note\":\"hello\"}",
      headers: [{ key: "Content-Type", value: "application/json" }],
    },
  },
  nonJsonBody: {
    config: { body: "<order><note>hello</note></order>" },
    expected: { body: "<order><note>hello</note></order>" },
  },
  // A reference names a slot on the receiving machine, so it survives even
  // under a sensitive key — that indirection is the whole point of syncing.
  referencesSurvive: {
    config: {
      body: "{\"username\":\"admin\",\"password\":\"{{secrets.PW}}\",\"note\":\"hello\"}",
      headers: [{ key: "Authorization", value: "Bearer {{secrets.TOKEN}}" }],
    },
    expected: {
      body: "{\"username\":\"admin\",\"password\":\"{{secrets.PW}}\",\"note\":\"hello\"}",
      headers: [{ key: "Authorization", value: "Bearer {{secrets.TOKEN}}" }],
    },
  },
  authReferencesSurvive: {
    config: {
      auth: {
        type: "bearer",
        bearer: { token: "{{secrets.TOKEN}}" },
        basic: { username: "admin", password: "{{secrets.PW}}" },
        apiKey: { key: "X-Api-Key", value: "{{secrets.K}}", in: "header" },
      },
    },
    expected: {
      auth: {
        type: "bearer",
        bearer: { token: "{{secrets.TOKEN}}" },
        basic: { username: "admin", password: "{{secrets.PW}}" },
        apiKey: { key: "X-Api-Key", in: "header", value: "{{secrets.K}}" },
      },
    },
  },
  // Literal credentials are withheld in place: the slot keeps its shape so the
  // receiving machine shows the operator what to re-enter.
  authLiteralsWithheld: {
    config: {
      auth: {
        type: "bearer",
        bearer: { token: "abc.123" },
        basic: { username: "admin", password: "hunter2" },
        apiKey: { key: "X-Api-Key", value: "sk_live_abc123", in: "header" },
      },
    },
    expected: {
      auth: {
        type: "bearer",
        bearer: { token: "" },
        basic: { username: "admin", password: "" },
        apiKey: { key: "X-Api-Key", in: "header", value: "" },
      },
    },
    withheld: ["abc.123", "hunter2", "sk_live_abc123"],
  },
  literalUnderSensitiveBodyKey: {
    config: { body: "{\"api_key\":\"literal-abc\",\"note\":\"hello\"}" },
    expected: { body: "{\n  \"api_key\": \"\",\n  \"note\": \"hello\"\n}" },
    withheld: ["literal-abc"],
  },
  // In a request body the sanitizer is deliberately stricter than the
  // validators: it blanks a whole container under a sensitive key instead of
  // trusting the leaf names inside it, so an opaque key nested one level down
  // (`{"apiKey":{"value":"..."}}`) still cannot leave the machine.
  objectUnderSensitiveBodyKey: {
    config: { body: "{\"apiKey\":{\"value\":\"abc\"},\"note\":\"hello\"}" },
    expected: { body: "{\n  \"apiKey\": \"\",\n  \"note\": \"hello\"\n}" },
  },
  arrayUnderSensitiveBodyKey: {
    config: { body: "{\"api_key\":[\"abc\"]}" },
    expected: { body: "{\n  \"api_key\": \"\"\n}" },
  },
  // Key-name spellings the validators normalize: plural and camelCase must be
  // withheld here too, or the receiving device rejects what this side kept.
  pluralSensitiveBodyKey: {
    config: { body: "{\"apiKeys\":\"abc\",\"userTokens\":[\"t\"],\"note\":\"hello\"}" },
    expected: { body: "{\n  \"apiKeys\": \"\",\n  \"userTokens\": \"\",\n  \"note\": \"hello\"\n}" },
  },
  vaultFieldNameInBody: {
    config: { body: "{\"ciphertext\":\"abc\",\"note\":\"hello\"}" },
    expected: { body: "{\n  \"ciphertext\": \"\",\n  \"note\": \"hello\"\n}" },
  },
  // A reference elsewhere in a value does not launder a literal credential.
  referenceDoesNotLaunderCredentials: {
    config: {
      body: `{"auth":"{{env.SCHEME}} ${JWT}","note":"hello"}`,
      headers: [{ key: "X-Trace", value: `{{env.T}} ${JWT}` }],
      cookies: [{ key: "sess", value: `{{env.SID}}; jwt=${JWT}` }],
    },
    expected: {
      body: "{\n  \"auth\": \"\",\n  \"note\": \"hello\"\n}",
      headers: [{ key: "X-Trace", value: "" }],
      cookies: [{ key: "sess", value: "" }],
    },
    withheld: [JWT],
  },
  credentialInNonJsonBody: {
    config: { body: "client_id={{env.CID}}&client_secret=sk_live_abc123" },
    expected: { body: "" },
    withheld: ["sk_live_abc123"],
  },
  // Config fields with no special handling are scanned too: the server scans
  // every string, so anything skipped here is a workflow that stops syncing.
  credentialInUnhandledConfigField: {
    config: {
      assertions: [{ path: "body.token", expected: JWT }],
      scriptCode: `const t = "Bearer abc.123"`,
    },
    expected: {
      assertions: [{ path: "body.token", expected: "" }],
      scriptCode: "",
    },
    withheld: [JWT, "Bearer abc.123"],
  },
  // Cookies carry session material under innocuous names, so every literal
  // value is withheld regardless of its key.
  cookieValuesAlwaysWithheld: {
    config: { cookies: [{ key: "theme", value: "dark" }, { key: "sess", value: "{{env.SID}}" }] },
    expected: { cookies: [{ key: "theme", value: "" }, { key: "sess", value: "{{env.SID}}" }] },
  },
  // A number is not an empty value to either validator, so it is withheld too.
  numberUnderSensitiveKeyWithheld: {
    config: { body: "{\"password\":1234}", headers: [{ key: "otp", value: 1234 }] },
    expected: { body: "{\n  \"password\": \"\"\n}", headers: [{ key: "otp", value: "" }] },
    withheld: ["1234"],
  },
}

describe("cloud-sync redaction contract", () => {
  for (const [name, fixture] of Object.entries(fixtures)) {
    it(`${name}: sanitizes as specified and passes the pull-side validator`, () => {
      const payload = pushWorkflow(fixture.config)
      const nodes = payload["nodes"]
      const config = Array.isArray(nodes) && typeof nodes[0] === "object" && nodes[0] !== null
        ? (nodes[0] as Record<string, JsonValue>)["config"]
        : undefined

      expect(config).toEqual(fixture.expected)
      for (const literal of fixture.withheld ?? []) {
        expect(JSON.stringify(payload)).not.toContain(literal)
      }
      // The invariant: whatever the sanitizer emits, the other device stores.
      expect(forbiddenCloudPayloadField(payload)).toBeUndefined()
    })
  }

  // Fields with no structural handling at all: the pull validator still scans
  // them, so an API example pasted into a description must not strand the sync.
  it("withholds credential material from labels, names and descriptions", () => {
    const payload = pushWorkflow({}, {
      name: `Login (${JWT})`,
      description: "curl -H 'Authorization: Bearer abc.123' https://api.test",
      label: "Bearer abc.123",
    })
    expect(payload["name"]).toBe("")
    expect(payload["description"]).toBe("")
    const nodes = payload["nodes"] as Array<Record<string, JsonValue>>
    expect(nodes[0]?.["label"]).toBe("")
    expect(forbiddenCloudPayloadField(payload)).toBeUndefined()
  })
})

function pushWorkflow(
  config: Record<string, JsonValue>,
  prose: { readonly name?: string; readonly description?: string; readonly label?: string } = {},
): Record<string, JsonValue> {
  const provider = new CapturingSyncProvider()
  recordWorkflowUpsert(provider, {
    workflowId: "workflow-1",
    workspaceId: "workspace-1",
    name: prose.name ?? "Contract",
    description: prose.description ?? null,
    nodes: [{ nodeId: "http-1", type: "http-request", label: prose.label ?? null, position: { x: 0, y: 0 }, config }],
    edges: [],
    variables: {},
    tags: [],
    collectionId: null,
    selectedEnvironmentId: null,
    nodeTemplates: [],
    rev: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as Workflow)
  const payload = provider.mutations[0]?.payload
  expect(payload).not.toBeNull()
  return JSON.parse(new TextDecoder().decode(payload ?? new Uint8Array())) as Record<string, JsonValue>
}

class CapturingSyncProvider implements SyncProvider {
  public readonly mutations: SyncMutation[] = []

  public recordMutation(mutation: SyncMutation): void {
    this.mutations.push(mutation)
  }

  public async pull(): Promise<void> {}

  public async push(): Promise<void> {}
}
