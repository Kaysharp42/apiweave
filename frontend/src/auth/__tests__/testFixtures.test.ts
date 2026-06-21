/**
 * Tests for auth test fixtures (testFixtures.ts).
 *
 * Verifies that each fixture mock returns the correct auth state
 * when consumed via authenticatedJson('/api/auth/me').
 *
 * No OAuth provider secrets required — all responses are synthetic.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
  mockUnauthenticated,
  mockAdmin,
  mockEditor,
  mockViewer,
  mockSetupMode,
  mockDeploymentMode,
  buildAdminUser,
  buildEditorUser,
  buildViewerUser,
  FIXTURE_ADMIN_USER_ID,
  FIXTURE_EDITOR_USER_ID,
  FIXTURE_VIEWER_USER_ID,
} from './testFixtures.ts';

const { authenticatedJson } = await import('../../utils/authenticatedApi.ts');

// ---------------------------------------------------------------------------
// mockUnauthenticated
// ---------------------------------------------------------------------------

test('mockUnauthenticated: /api/auth/me returns 401', async () => {
  const { restore } = mockUnauthenticated();
  try {
    let threw = false;
    try {
      await authenticatedJson('/api/auth/me');
    } catch (err) {
      threw = true;
      assert.ok((err as Error).message.includes('401'));
    }
    assert.ok(threw, 'Should throw on 401');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// mockAdmin
// ---------------------------------------------------------------------------

test('mockAdmin: /api/auth/me returns admin user with all permissions', async () => {
  const { restore } = mockAdmin();
  try {
    const user = await authenticatedJson('/api/auth/me') as ReturnType<typeof buildAdminUser>;
    assert.equal(user.userId, FIXTURE_ADMIN_USER_ID);
    assert.ok(user.roles.includes('admin'), 'Should have admin role');
    assert.ok(user.permissions.includes('users:invite'), 'Admin should have users:invite');
    assert.ok(user.permissions.includes('settings:update'), 'Admin should have settings:update');
    assert.ok(user.permissions.includes('workflows:create'), 'Admin should have workflows:create');
    assert.equal(user.is_setup_complete, true);
  } finally {
    restore();
  }
});

test('mockAdmin: accepts custom userId', async () => {
  const { restore } = mockAdmin('custom-admin-99');
  try {
    const user = await authenticatedJson('/api/auth/me') as ReturnType<typeof buildAdminUser>;
    assert.equal(user.userId, 'custom-admin-99');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// mockEditor
// ---------------------------------------------------------------------------

test('mockEditor: /api/auth/me returns editor user', async () => {
  const { restore } = mockEditor();
  try {
    const user = await authenticatedJson('/api/auth/me') as ReturnType<typeof buildEditorUser>;
    assert.equal(user.userId, FIXTURE_EDITOR_USER_ID);
    assert.ok(user.roles.includes('editor'), 'Should have editor role');
    assert.ok(user.permissions.includes('workflows:create'), 'Editor should have workflows:create');
    assert.ok(user.permissions.includes('collections:create'), 'Editor should have collections:create');
    assert.ok(!user.permissions.includes('users:invite'), 'Editor must NOT have users:invite');
    assert.ok(!user.permissions.includes('settings:update'), 'Editor must NOT have settings:update');
    assert.equal(user.is_setup_complete, true);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// mockViewer
// ---------------------------------------------------------------------------

test('mockViewer: /api/auth/me returns viewer user (read-only)', async () => {
  const { restore } = mockViewer();
  try {
    const user = await authenticatedJson('/api/auth/me') as ReturnType<typeof buildViewerUser>;
    assert.equal(user.userId, FIXTURE_VIEWER_USER_ID);
    assert.ok(user.roles.includes('viewer'), 'Should have viewer role');
    assert.ok(user.permissions.includes('workflows:read'), 'Viewer should have workflows:read');
    assert.ok(!user.permissions.includes('workflows:create'), 'Viewer must NOT have workflows:create');
    assert.ok(!user.permissions.includes('workflows:delete'), 'Viewer must NOT have workflows:delete');
    assert.ok(!user.permissions.includes('users:invite'), 'Viewer must NOT have users:invite');
    assert.equal(user.is_setup_complete, true);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// mockSetupMode
// ---------------------------------------------------------------------------

test('mockSetupMode: /api/auth/me returns user with is_setup_complete=false', async () => {
  const { restore } = mockSetupMode();
  try {
    const user = await authenticatedJson('/api/auth/me') as ReturnType<typeof buildAdminUser>;
    assert.equal(user.is_setup_complete, false);
    assert.deepEqual(user.roles, []);
    assert.deepEqual(user.permissions, []);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// restore() properly restores original fetch
// ---------------------------------------------------------------------------

test('restore: fetch is restored after mock', async () => {
  const originalFetch = globalThis.fetch;
  const { restore } = mockAdmin();
  restore();
  assert.equal(globalThis.fetch, originalFetch, 'fetch should be restored to original');
});

// ---------------------------------------------------------------------------
// buildXxxUser helpers (no fetch mock — pure object construction)
// ---------------------------------------------------------------------------

test('buildAdminUser: returns User with admin role and all permissions', () => {
  const user = buildAdminUser();
  assert.equal(user.userId, FIXTURE_ADMIN_USER_ID);
  assert.ok(user.roles.includes('admin'));
  assert.ok(user.permissions.includes('users:invite'));
  assert.ok(user.permissions.includes('settings:update'));
});

test('buildEditorUser: returns User with editor role, no admin-only permissions', () => {
  const user = buildEditorUser();
  assert.equal(user.userId, FIXTURE_EDITOR_USER_ID);
  assert.ok(user.roles.includes('editor'));
  assert.ok(!user.permissions.includes('users:invite'));
});

test('buildViewerUser: returns User with viewer role, read-only permissions', () => {
  const user = buildViewerUser();
  assert.equal(user.userId, FIXTURE_VIEWER_USER_ID);
  assert.ok(user.roles.includes('viewer'));
  assert.ok(user.permissions.includes('workflows:read'));
  assert.ok(!user.permissions.includes('workflows:create'));
});

// ---------------------------------------------------------------------------
// mockDeploymentMode — locks in the /api/auth/mode bootstrap contract
// (Required for the single-user mode redirect-ping-pong fix: route gates
// must check `modeLoaded` before redirecting.)
// ---------------------------------------------------------------------------

test('mockDeploymentMode: /api/auth/mode returns single_user', async () => {
  const { restore } = mockDeploymentMode('single_user');
  try {
    const body = await authenticatedJson('/api/auth/mode') as { mode: string };
    assert.equal(body.mode, 'single_user');
  } finally {
    restore();
  }
});

test('mockDeploymentMode: /api/auth/mode returns multi_tenant', async () => {
  const { restore } = mockDeploymentMode('multi_tenant');
  try {
    const body = await authenticatedJson('/api/auth/mode') as { mode: string };
    assert.equal(body.mode, 'multi_tenant');
  } finally {
    restore();
  }
});

test('mockDeploymentMode: does NOT intercept /api/auth/me', async () => {
  // Without a /me mock, /me should reach the real fetch (which will fail
  // in a node:test env, but importantly must NOT return mode's mock).
  const { restore } = mockDeploymentMode('single_user');
  try {
    let threw = false;
    try {
      await authenticatedJson('/api/auth/me');
    } catch {
      threw = true;
    }
    assert.ok(threw, 'Should throw because /me is not mocked');
  } finally {
    restore();
  }
});
