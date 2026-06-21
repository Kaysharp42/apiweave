/**
 * Frontend auth test fixtures for E2E-ish QA scenarios.
 *
 * Provides helpers that mock `globalThis.fetch` to simulate different auth
 * states returned by `/api/auth/me`. Compatible with the node:test + node:assert
 * pattern used throughout the frontend test suite.
 *
 * No real OAuth provider secrets are required — all responses are synthetic.
 *
 * Usage:
 *
 *   import test from 'node:test';
 *   import assert from 'node:assert/strict';
 *   import { mockAdmin, mockViewer, mockUnauthenticated } from './testFixtures.ts';
 *
 *   test('admin sees invite button', async () => {
 *     const { restore } = mockAdmin();
 *     try {
 *       const user = await authenticatedJson('/api/auth/me');
 *       assert.ok(user.roles.includes('admin'));
 *     } finally {
 *       restore();
 *     }
 *   });
 */

import type { User } from '../../types/User.ts';
import type { DeploymentMode } from '../../types/DeploymentMode.ts';

// ---------------------------------------------------------------------------
// Stable test user IDs — use in assertions to avoid magic strings
// ---------------------------------------------------------------------------

export const FIXTURE_ADMIN_USER_ID = 'fixture-admin-1';
export const FIXTURE_EDITOR_USER_ID = 'fixture-editor-1';
export const FIXTURE_VIEWER_USER_ID = 'fixture-viewer-1';
export const FIXTURE_SINGLE_USER_OWNER_ID = 'usr-single-user-owner';

// ---------------------------------------------------------------------------
// Canonical permission sets (mirrors backend ROLE_PRESETS)
// ---------------------------------------------------------------------------

const ADMIN_PERMISSIONS: string[] = [
  'workflows:create', 'workflows:read', 'workflows:update', 'workflows:delete',
  'workflows:run', 'workflows:export', 'workflows:import',
  'collections:create', 'collections:read', 'collections:update', 'collections:delete',
  'collections:run', 'collections:export', 'collections:import',
  'environments:create', 'environments:read', 'environments:update', 'environments:delete',
  'environments:set_secret',
  'webhooks:create', 'webhooks:read', 'webhooks:update', 'webhooks:delete',
  'webhooks:rotate', 'webhooks:execute',
  'users:read', 'users:invite', 'users:update_role', 'users:delete',
  'settings:read', 'settings:update',
  'runs:read', 'runs:cancel',
];

const EDITOR_PERMISSIONS: string[] = [
  'workflows:create', 'workflows:read', 'workflows:update', 'workflows:delete',
  'workflows:run', 'workflows:export', 'workflows:import',
  'collections:create', 'collections:read', 'collections:update', 'collections:delete',
  'collections:run', 'collections:export', 'collections:import',
  'environments:create', 'environments:read', 'environments:update', 'environments:delete',
  'environments:set_secret',
  'webhooks:create', 'webhooks:read', 'webhooks:update', 'webhooks:delete',
  'webhooks:rotate', 'webhooks:execute',
  'runs:read', 'runs:cancel',
  // NOTE: no users:invite, users:update_role, users:delete, settings:update
];

const VIEWER_PERMISSIONS: string[] = [
  'workflows:read',
  'collections:read',
  'environments:read',
  'webhooks:read',
  'runs:read',
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface MockFetchHandle {
  /** Call in `finally` to restore the original globalThis.fetch. */
  restore: () => void;
}

/**
 * Replaces globalThis.fetch with a function that returns a fixed response
 * for `/api/auth/me` and passes all other requests through to the original.
 */
function _mockAuthMe(
  status: number,
  body: unknown,
): MockFetchHandle {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = String(input);
    if (url.includes('/api/auth/me')) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Pass through all other requests to the original fetch
    return originalFetch(input, init);
  };

  return { restore: () => { globalThis.fetch = originalFetch; } };
}

/**
 * Replaces globalThis.fetch with a function that returns a fixed response
 * for `/api/auth/mode` and passes all other requests through to the original.
 */
function _mockAuthMode(mode: DeploymentMode): MockFetchHandle {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = String(input);
    if (url.includes('/api/auth/mode')) {
      return new Response(JSON.stringify({ mode }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(input, init);
  };

  return { restore: () => { globalThis.fetch = originalFetch; } };
}

function _makeUser(
  userId: string,
  roles: string[],
  permissions: string[],
  isSetupComplete = true,
): User {
  return {
    userId,
    verified_email: `${userId}@example.com`,
    display_name: `Test ${userId}`,
    avatar_url: null,
    roles,
    permissions,
    oauth_accounts: [],
    is_setup_complete: isSetupComplete,
    created_at: '2026-01-01T00:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Public fixture factories
// ---------------------------------------------------------------------------

/**
 * Mocks `/api/auth/me` to return 401 (not authenticated).
 *
 * Use to test logged-out state: redirect to login, protected routes blocked, etc.
 */
export function mockUnauthenticated(): MockFetchHandle {
  return _mockAuthMe(401, { detail: 'Not authenticated' });
}

/**
 * Mocks `/api/auth/me` to return a fully-privileged admin user.
 *
 * Admin has all permissions including users:invite, settings:update, etc.
 */
export function mockAdmin(
  userId: string = FIXTURE_ADMIN_USER_ID,
): MockFetchHandle {
  const user = _makeUser(userId, ['admin'], ADMIN_PERMISSIONS);
  return _mockAuthMe(200, user);
}

/**
 * Mocks `/api/auth/me` to return an editor user.
 *
 * Editor can create/update/delete workflows, collections, environments, webhooks,
 * but cannot invite users or change settings.
 */
export function mockEditor(
  userId: string = FIXTURE_EDITOR_USER_ID,
): MockFetchHandle {
  const user = _makeUser(userId, ['editor'], EDITOR_PERMISSIONS);
  return _mockAuthMe(200, user);
}

/**
 * Mocks `/api/auth/me` to return a viewer user (read-only).
 *
 * Viewer can only read workflows, collections, environments, webhooks, and runs.
 */
export function mockViewer(
  userId: string = FIXTURE_VIEWER_USER_ID,
): MockFetchHandle {
  const user = _makeUser(userId, ['viewer'], VIEWER_PERMISSIONS);
  return _mockAuthMe(200, user);
}

/**
 * Mocks `/api/auth/me` to return a user in setup mode (first-run, no roles).
 *
 * Use to test the setup flow: SetupPage shown, no access to main app.
 */
export function mockSetupMode(): MockFetchHandle {
  const user = _makeUser('fixture-setup-1', [], [], false);
  return _mockAuthMe(200, user);
}

// ---------------------------------------------------------------------------
// Convenience: build a User object without mocking fetch
// (useful for unit tests that test logic directly, not via fetch)
// ---------------------------------------------------------------------------

export function buildAdminUser(userId: string = FIXTURE_ADMIN_USER_ID): User {
  return _makeUser(userId, ['admin'], ADMIN_PERMISSIONS);
}

export function buildEditorUser(userId: string = FIXTURE_EDITOR_USER_ID): User {
  return _makeUser(userId, ['editor'], EDITOR_PERMISSIONS);
}

export function buildViewerUser(userId: string = FIXTURE_VIEWER_USER_ID): User {
  return _makeUser(userId, ['viewer'], VIEWER_PERMISSIONS);
}

/**
 * Mocks `/api/auth/mode` to return a specific deployment mode.
 *
 * Use together with `mockAdmin` / `mockUnauthenticated` / etc. to simulate
 * the full bootstrap call. The frontend reads this to decide whether to
 * render the login screen (multi_tenant) or auto-authenticate as the
 * implicit owner (single_user).
 */
export function mockDeploymentMode(mode: DeploymentMode): MockFetchHandle {
  return _mockAuthMode(mode);
}
