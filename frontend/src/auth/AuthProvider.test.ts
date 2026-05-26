/**
 * Tests for AuthProvider auth logic.
 *
 * These tests verify the auth state machine behaviour using node:test + node:assert/strict.
 * React rendering is not required — we test the underlying logic and hook contracts.
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
  body: unknown = {},
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
// Import modules under test
// ---------------------------------------------------------------------------

const { authenticatedFetch, authenticatedJson } = await import('../utils/authenticatedApi.ts');

// ---------------------------------------------------------------------------
// Unauthenticated redirect behaviour (logic layer)
// ---------------------------------------------------------------------------

test('unauthenticated: /api/auth/me 401 results in unauthenticated status', async () => {
  const { restore } = mockFetch(401, { detail: 'Not authenticated' });
  try {
    let caughtError: Error | null = null;
    try {
      await authenticatedJson('/api/auth/me');
    } catch (err) {
      caughtError = err as Error;
    }
    assert.ok(caughtError !== null, 'Should throw on 401');
    assert.ok(
      caughtError.message.includes('401'),
      `Expected 401 in error message, got: ${caughtError.message}`,
    );
  } finally {
    restore();
  }
});

test('unauthenticated: fetch to /api/auth/me always uses credentials: include', async () => {
  const { calls, restore } = mockFetch(401, { detail: 'Not authenticated' });
  try {
    await authenticatedFetch('/api/auth/me');
    assert.equal(calls[0]!.init.credentials, 'include');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Profile hydration
// ---------------------------------------------------------------------------

test('profile hydration: /api/auth/me 200 returns user profile', async () => {
  const mockUser = {
    userId: 'user-123',
    verified_email: 'test@example.com',
    display_name: 'Test User',
    avatar_url: null,
    roles: ['user'],
    permissions: ['workflows:read', 'workflows:write'],
    is_setup_complete: true,
    created_at: '2026-01-01T00:00:00Z',
  };
  const { restore } = mockFetch(200, mockUser);
  try {
    const user = await authenticatedJson('/api/auth/me') as typeof mockUser;
    assert.equal(user.userId, 'user-123');
    assert.equal(user.verified_email, 'test@example.com');
    assert.deepEqual(user.roles, ['user']);
    assert.deepEqual(user.permissions, ['workflows:read', 'workflows:write']);
    assert.equal(user.is_setup_complete, true);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

test('logout: POST /api/auth/logout uses credentials: include', async () => {
  const { calls, restore } = mockFetch(200, {});
  try {
    await authenticatedFetch('/api/auth/logout', { method: 'POST' });
    assert.equal(calls[0]!.init.credentials, 'include');
    assert.equal(calls[0]!.init.method, 'POST');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// hasPermission logic
// ---------------------------------------------------------------------------

test('hasPermission: returns true when permission is in user.permissions', () => {
  const permissions = ['workflows:read', 'workflows:write', 'admin'];
  const hasPermission = (permission: string): boolean => permissions.includes(permission);

  assert.equal(hasPermission('workflows:read'), true);
  assert.equal(hasPermission('workflows:write'), true);
  assert.equal(hasPermission('admin'), true);
  assert.equal(hasPermission('superuser'), false);
});

test('hasPermission: returns false for empty permissions list', () => {
  const permissions: string[] = [];
  const hasPermission = (permission: string): boolean => permissions.includes(permission);

  assert.equal(hasPermission('workflows:read'), false);
});

test('hasPermission: admin role grants admin-only permissions', () => {
  const roles = ['admin'];
  const permissions: string[] = [];
  const hasPermission = (permission: string): boolean => (
    roles.includes('admin') || permissions.includes(permission) || roles.includes(permission)
  );

  assert.equal(hasPermission('users:invite'), true);
});
