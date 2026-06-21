/**
 * Tests for authenticatedApi — auth API client behaviour.
 *
 * Verifies: credentials:include, CSRF injection, no admin key, error handling.
 * Uses node:test + node:assert/strict.
 */

import { test } from 'vitest';
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

const { authenticatedFetch, authenticatedJson, copyInviteLink, readCookie } = await import('./authenticatedApi.ts');

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
    await authenticatedFetch('/api/workspaces/ws-1/workflows', { method: 'POST', body: '{}' });
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
    await authenticatedFetch('/api/workspaces/ws-1/workflows/wf-1', { method: 'DELETE' });
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
    await authenticatedFetch('/api/workspaces/ws-1/workflows');
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
    await authenticatedFetch('/api/workspaces/ws-1/workflows');
    const headers = calls[0]!.init.headers;
    assert.equal(headers['authorization'], undefined);
  } finally {
    restore();
  }
});

test('Authorization header is stripped even if caller passes one', async () => {
  const { calls, restore } = mockFetch();
  try {
    await authenticatedFetch('/api/workspaces/ws-1/workflows', {
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
      () => authenticatedJson('/api/workspaces/ws-1/workflows/missing'),
      (err: Error) => {
        assert.ok(err.message.includes('404'), `Expected 404 in: ${err.message}`);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test('409 response is still caught by authenticatedJson error handling', async () => {
  const { restore } = mockFetch(409, { detail: 'Invite already exists' });
  try {
    await assert.rejects(
      () => authenticatedJson('/api/auth/invites'),
      (err: Error) => {
        assert.ok(err.message.includes('409'), `Expected 409 in: ${err.message}`);
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
    const data = await authenticatedJson<{ id: string; name: string }>('/api/workspaces/ws-1/workflows/wf-1');
    assert.equal(data.id, 'wf-1');
    assert.equal(data.name, 'My Workflow');
  } finally {
    restore();
  }
});

test('copyInviteLink returns true when clipboard write succeeds', async () => {
  const originalNavigator = globalThis.navigator;
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const clipboardMock = {
    writeText: async (text: string) => {
      assert.equal(text, 'https://example.com/invite/token');
    },
  } as unknown as Clipboard;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: clipboardMock } as Navigator,
  });

  try {
    const result = await copyInviteLink('https://example.com/invite/token');
    assert.equal(result, true);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalDescriptor);
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator,
      });
    }
  }
});

test('copyInviteLink returns false when clipboard write fails', async () => {
  const originalNavigator = globalThis.navigator;
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const clipboardMock = {
    writeText: async () => {
      throw new Error('clipboard unavailable');
    },
  } as unknown as Clipboard;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: clipboardMock } as Navigator,
  });

  try {
    const result = await copyInviteLink('https://example.com/invite/token');
    assert.equal(result, false);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalDescriptor);
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator,
      });
    }
  }
});
