/**
 * Tests for authenticatedApi — auth API client behaviour.
 *
 * Verifies: credentials:include, CSRF injection, no admin key, error handling.
 * Uses node:test + node:assert/strict.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Minimal fetch mock
// ---------------------------------------------------------------------------

interface CapturedRequest {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
}

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
      init.headers.forEach((value, key) => { headers[key] = value; });
    } else if (init.headers && typeof init.headers === 'object') {
      Object.assign(headers, init.headers);
    }
    calls.push({ url: String(input), init: { ...init, headers } });
    return new Response(JSON.stringify(body), {
      status: statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

const { authenticatedFetch, authenticatedJson, readCookie } = await import('./authenticatedApi.ts');

// ---------------------------------------------------------------------------
// readCookie
// ---------------------------------------------------------------------------

test('readCookie returns null when document is undefined', () => {
  const result = readCookie('csrftoken');
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// credentials: "include"
// ---------------------------------------------------------------------------

test('request includes credentials: include on GET', async () => {
  const { calls, restore } = mockFetch();
  try {
    await authenticatedFetch('/api/test');
    assert.equal(calls[0]!.init.credentials, 'include');
  } finally {
    restore();
  }
});

test('request includes credentials: include on POST', async () => {
  const { calls, restore } = mockFetch();
  try {
    await authenticatedFetch('/api/test', { method: 'POST', body: '{}' });
    assert.equal(calls[0]!.init.credentials, 'include');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// CSRF header injection
// ---------------------------------------------------------------------------

test('state-changing request includes CSRF header on POST', async () => {
  const { calls, restore } = mockFetch();
  const originalDoc = globalThis.document;
  // @ts-expect-error — injecting minimal document mock for Node.js test env
  globalThis.document = { cookie: 'csrftoken=test-csrf-value-abc' };
  try {
    await authenticatedFetch('/api/workflows', { method: 'POST', body: '{}' });
    const headers = calls[0]!.init.headers;
    assert.equal(headers['x-csrf-token'], 'test-csrf-value-abc');
  } finally {
    globalThis.document = originalDoc;
    restore();
  }
});

test('state-changing request includes CSRF header on DELETE', async () => {
  const { calls, restore } = mockFetch();
  const originalDoc = globalThis.document;
  // @ts-expect-error — injecting minimal document mock
  globalThis.document = { cookie: 'csrftoken=delete-csrf-token' };
  try {
    await authenticatedFetch('/api/workflows/wf-1', { method: 'DELETE' });
    const headers = calls[0]!.init.headers;
    assert.equal(headers['x-csrf-token'], 'delete-csrf-token');
  } finally {
    globalThis.document = originalDoc;
    restore();
  }
});

test('GET request does NOT include CSRF header', async () => {
  const { calls, restore } = mockFetch();
  const originalDoc = globalThis.document;
  // @ts-expect-error — injecting minimal document mock
  globalThis.document = { cookie: 'csrftoken=should-not-appear' };
  try {
    await authenticatedFetch('/api/workflows');
    const headers = calls[0]!.init.headers;
    assert.equal(headers['x-csrf-token'], undefined, 'GET must not include CSRF header');
  } finally {
    globalThis.document = originalDoc;
    restore();
  }
});

// ---------------------------------------------------------------------------
// No admin key
// ---------------------------------------------------------------------------

test('no admin key is sent in requests by default', async () => {
  const { calls, restore } = mockFetch();
  try {
    await authenticatedFetch('/api/workflows');
    const headers = calls[0]!.init.headers;
    assert.equal(headers['authorization'], undefined);
  } finally {
    restore();
  }
});

test('Authorization header is stripped even if caller passes one', async () => {
  const { calls, restore } = mockFetch();
  try {
    await authenticatedFetch('/api/workflows', {
      headers: { Authorization: 'Bearer admin-secret-key' },
    });
    const headers = calls[0]!.init.headers;
    assert.equal(headers['authorization'], undefined, 'Authorization header must be stripped');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

test('non-2xx response throws error', async () => {
  const { restore } = mockFetch(404, { detail: 'Not found' });
  try {
    await assert.rejects(
      () => authenticatedJson('/api/workflows/missing'),
      (err: Error) => {
        assert.ok(err.message.includes('404'), `Expected 404 in: ${err.message}`);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test('authenticatedJson returns parsed JSON on 200', async () => {
  const { restore } = mockFetch(200, { id: 'wf-1', name: 'My Workflow' });
  try {
    const data = await authenticatedJson<{ id: string; name: string }>('/api/workflows/wf-1');
    assert.equal(data.id, 'wf-1');
    assert.equal(data.name, 'My Workflow');
  } finally {
    restore();
  }
});
