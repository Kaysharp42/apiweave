/**
 * Tests for authenticatedApi — auth API client behaviour.
 *
 * All tests use node:test + node:assert/strict.
 * No real provider secrets or live endpoints are required.
 */

import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Minimal fetch mock infrastructure
// ---------------------------------------------------------------------------

interface CapturedRequest {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
}

/** Replace global fetch with a spy that records calls and returns a canned response. */
function mockFetch(
  statusCode = 200,
  body: unknown = { ok: true },
): { calls: CapturedRequest[]; restore: () => void } {
  const calls: CapturedRequest[] = [];

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (init.headers instanceof Headers) {
      init.headers.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (init.headers && typeof init.headers === "object") {
      Object.assign(headers, init.headers);
    }

    calls.push({ url: String(input), init: { ...init, headers } });

    const responseBody = JSON.stringify(body);
    return new Response(responseBody, {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    });
  };

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

// ---------------------------------------------------------------------------
// Import the module under test AFTER the mock infrastructure is defined
// ---------------------------------------------------------------------------

// Dynamic import so we can control the environment before the module loads.
// We use a top-level await-compatible pattern via test() callbacks.

const { authenticatedFetch, authenticatedJson, readCookie } = await import(
  "./authenticatedApi.ts"
);

// ---------------------------------------------------------------------------
// readCookie
// ---------------------------------------------------------------------------

test("readCookie returns null when document is undefined", () => {
  // In Node.js there is no document — the function should return null gracefully.
  // We test the exported function directly; it guards with typeof document check.
  const result = readCookie("csrftoken");
  // In a Node.js test environment document is not defined, so null is expected.
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// credentials: "include"
// ---------------------------------------------------------------------------

test("authenticatedFetch always sends credentials: include", async () => {
  const { calls, restore } = mockFetch();
  try {
    await authenticatedFetch("/api/test");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.init.credentials, "include");
  } finally {
    restore();
  }
});

test("authenticatedFetch sends credentials: include on POST", async () => {
  const { calls, restore } = mockFetch();
  try {
    await authenticatedFetch("/api/test", { method: "POST", body: "{}" });
    assert.equal(calls[0]!.init.credentials, "include");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// CSRF header on state-changing methods
// ---------------------------------------------------------------------------

test("authenticatedFetch attaches X-CSRF-Token on POST when cookie is present", async () => {
  const { calls, restore } = mockFetch();
  // Simulate a browser environment with a csrftoken cookie
  const originalDoc = globalThis.document;
  // @ts-expect-error — injecting minimal document mock for Node.js test env
  globalThis.document = { cookie: "csrftoken=test-csrf-value-abc" };
  try {
    await authenticatedFetch("/api/workflows", { method: "POST", body: "{}" });
    const headers = calls[0]!.init.headers;
    assert.equal(headers["x-csrf-token"], "test-csrf-value-abc");
  } finally {
    globalThis.document = originalDoc;
    restore();
  }
});

test("authenticatedFetch attaches X-CSRF-Token on PUT", async () => {
  const { calls, restore } = mockFetch();
  // @ts-expect-error — injecting minimal document mock
  globalThis.document = { cookie: "csrftoken=put-csrf-token" };
  const originalDoc = globalThis.document;
  try {
    await authenticatedFetch("/api/workflows/wf-1", {
      method: "PUT",
      body: "{}",
    });
    const headers = calls[0]!.init.headers;
    assert.equal(headers["x-csrf-token"], "put-csrf-token");
  } finally {
    globalThis.document = originalDoc;
    restore();
  }
});

test("authenticatedFetch attaches X-CSRF-Token on DELETE", async () => {
  const { calls, restore } = mockFetch();
  // @ts-expect-error — injecting minimal document mock
  globalThis.document = { cookie: "csrftoken=delete-csrf-token" };
  const originalDoc = globalThis.document;
  try {
    await authenticatedFetch("/api/workflows/wf-1", { method: "DELETE" });
    const headers = calls[0]!.init.headers;
    assert.equal(headers["x-csrf-token"], "delete-csrf-token");
  } finally {
    globalThis.document = originalDoc;
    restore();
  }
});

test("authenticatedFetch does NOT attach X-CSRF-Token on GET", async () => {
  const { calls, restore } = mockFetch();
  // @ts-expect-error — injecting minimal document mock
  globalThis.document = { cookie: "csrftoken=should-not-appear" };
  const originalDoc = globalThis.document;
  try {
    await authenticatedFetch("/api/workflows");
    const headers = calls[0]!.init.headers;
    assert.equal(
      headers["x-csrf-token"],
      undefined,
      "GET must not include CSRF header",
    );
  } finally {
    globalThis.document = originalDoc;
    restore();
  }
});

test("authenticatedFetch does NOT attach X-CSRF-Token when cookie is absent", async () => {
  const { calls, restore } = mockFetch();
  // @ts-expect-error — injecting minimal document mock with no csrftoken
  globalThis.document = { cookie: "session=some-session-id" };
  const originalDoc = globalThis.document;
  try {
    await authenticatedFetch("/api/workflows", { method: "POST", body: "{}" });
    const headers = calls[0]!.init.headers;
    assert.equal(
      headers["x-csrf-token"],
      undefined,
      "No CSRF header when cookie absent",
    );
  } finally {
    globalThis.document = originalDoc;
    restore();
  }
});

// ---------------------------------------------------------------------------
// No Authorization header with admin key
// ---------------------------------------------------------------------------

test("authenticatedFetch strips Authorization header if caller passes one", async () => {
  const { calls, restore } = mockFetch();
  try {
    await authenticatedFetch("/api/workflows", {
      headers: { Authorization: "Bearer admin-secret-key" },
    });
    const headers = calls[0]!.init.headers;
    assert.equal(
      headers["authorization"],
      undefined,
      "Authorization header must be stripped",
    );
  } finally {
    restore();
  }
});

test("authenticatedFetch never sends Authorization header by default", async () => {
  const { calls, restore } = mockFetch();
  try {
    await authenticatedFetch("/api/workflows");
    const headers = calls[0]!.init.headers;
    assert.equal(headers["authorization"], undefined);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// authenticatedJson — error handling
// ---------------------------------------------------------------------------

test("authenticatedJson returns parsed JSON on 200", async () => {
  const { restore } = mockFetch(200, { id: "wf-1", name: "My Workflow" });
  try {
    const data = await authenticatedJson<{ id: string; name: string }>(
      "/api/workflows/wf-1",
    );
    assert.equal(data.id, "wf-1");
    assert.equal(data.name, "My Workflow");
  } finally {
    restore();
  }
});

test("authenticatedJson throws on non-2xx status", async () => {
  const { restore } = mockFetch(404, { detail: "Not found" });
  try {
    await assert.rejects(
      () => authenticatedJson("/api/workflows/missing"),
      (err: Error) => {
        assert.ok(err.message.includes("404"), `Expected 404 in: ${err.message}`);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("authenticatedJson sends credentials: include", async () => {
  const { calls, restore } = mockFetch(200, {});
  try {
    await authenticatedJson("/api/me");
    assert.equal(calls[0]!.init.credentials, "include");
  } finally {
    restore();
  }
});
