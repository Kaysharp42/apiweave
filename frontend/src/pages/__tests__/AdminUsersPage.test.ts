import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGES_DIR = join('src', 'pages');
const AUTH_COMPONENTS_DIR = join('src', 'components', 'auth');

function readPage(fileName: string): string {
  return readFileSync(join(PAGES_DIR, fileName), 'utf-8');
}

function readAuthComponent(fileName: string): string {
  return readFileSync(join(AUTH_COMPONENTS_DIR, fileName), 'utf-8');
}

// ── AdminUsersPage source tests ──────────────────────────────────────────────

test('AdminUsersPage renders on /settings/users route (wired in App.tsx)', () => {
  const appContent = readFileSync(join('src', 'App.tsx'), 'utf-8');
  assert.ok(
    appContent.includes('AdminUsersPage'),
    'AdminUsersPage must be imported in App.tsx'
  );
  assert.ok(
    appContent.includes('/settings/users'),
    'AdminUsersPage must be mounted at /settings/users'
  );
});

test('AdminUsersPage fetches users from /api/users', () => {
  const content = readPage('AdminUsersPage.tsx');
  assert.ok(
    content.includes('/api/users'),
    'Must fetch users from /api/users endpoint'
  );
  assert.ok(
    content.includes('authenticatedJson'),
    'Must use authenticatedJson for authenticated requests'
  );
});

test('AdminUsersPage includes InviteUserModal and invite button', () => {
  const content = readPage('AdminUsersPage.tsx');
  assert.ok(
    content.includes('InviteUserModal'),
    'Must import and render InviteUserModal'
  );
  assert.ok(
    content.includes('inviteModalOpen'),
    'Must track invite modal open state'
  );
  assert.ok(
    content.includes('Invite User'),
    'Must have an Invite User button'
  );
});

test('AdminUsersPage has role-change handler wired to /api/users/:id/roles', () => {
  const content = readPage('AdminUsersPage.tsx');
  assert.ok(
    content.includes('/api/users/${userId}/roles') ||
      content.includes('/api/users/'),
    'Must call role update endpoint'
  );
  assert.ok(
    content.includes('handleRoleChange'),
    'Must define handleRoleChange handler'
  );
  assert.ok(
    content.includes("method: 'PATCH'"),
    'Role update must use PATCH method'
  );
});

test('AdminUsersPage enforces last-admin safeguard', () => {
  const content = readPage('AdminUsersPage.tsx');
  assert.ok(
    content.includes('last admin') ||
      content.includes('Cannot demote the last admin'),
    'Must show error when demoting the last admin'
  );
  assert.ok(
    content.includes('adminCount'),
    'Must count admins before allowing demotion'
  );
  assert.ok(
    content.includes('adminCount <= 1'),
    'Must block demotion when only one admin remains'
  );
});

test('AdminUsersPage shows role selector with admin/editor/viewer options', () => {
  const content = readPage('AdminUsersPage.tsx');
  assert.ok(content.includes('value="admin"'), 'Must include admin role option');
  assert.ok(content.includes('value="editor"'), 'Must include editor role option');
  assert.ok(content.includes('value="viewer"'), 'Must include viewer role option');
});

test('AdminUsersPage shows loading spinner while fetching users', () => {
  const content = readPage('AdminUsersPage.tsx');
  assert.ok(
    content.includes('animate-spin') || content.includes('Loader2'),
    'Must show loading indicator while fetching users'
  );
  assert.ok(content.includes('loading'), 'Must track loading state');
});

test('AdminUsersPage shows user status badges (Active/Pending)', () => {
  const content = readPage('AdminUsersPage.tsx');
  assert.ok(
    content.includes('StatusBadge'),
    'Must use StatusBadge for user status display'
  );
  assert.ok(content.includes('Active'), 'Must show Active status for setup-complete users');
  assert.ok(content.includes('Pending'), 'Must show Pending status for incomplete users');
  assert.ok(
    content.includes('is_setup_complete'),
    'Must check is_setup_complete to determine status'
  );
});

test('AdminUsersPage refreshes user list after invite modal closes', () => {
  const content = readPage('AdminUsersPage.tsx');
  assert.ok(
    content.includes('fetchUsers'),
    'Must define fetchUsers callback'
  );
  // onClose callback should call fetchUsers
  const onCloseBlock = content.slice(
    content.indexOf('onClose'),
    content.indexOf('onClose') + 200
  );
  assert.ok(
    onCloseBlock.includes('fetchUsers'),
    'onClose must trigger fetchUsers to refresh the list'
  );
});

// ── InviteUserModal source tests ─────────────────────────────────────────────

test('InviteUserModal posts to /api/auth/invites with email and roles', () => {
  const content = readAuthComponent('InviteUserModal.tsx');
  assert.ok(
    content.includes('/api/auth/invites'),
    'Must POST to /api/auth/invites'
  );
  assert.ok(
    content.includes("method: 'POST'"),
    'Must use POST method'
  );
  assert.ok(
    content.includes('email') && content.includes('roles'),
    'Must send email and roles in request body'
  );
});

test('InviteUserModal shows invite URL after successful creation', () => {
  const content = readAuthComponent('InviteUserModal.tsx');
  assert.ok(
    content.includes('inviteUrl'),
    'Must track invite URL state'
  );
  assert.ok(
    content.includes('invite_url'),
    'Must read invite_url from response'
  );
  assert.ok(
    content.includes('Copy'),
    'Must provide copy-to-clipboard button for invite URL'
  );
});

test('InviteUserModal includes role preset selector', () => {
  const content = readAuthComponent('InviteUserModal.tsx');
  assert.ok(
    content.includes('Role Preset') || content.includes('role'),
    'Must include role selection'
  );
  assert.ok(content.includes("value=\"admin\""), 'Must include admin role option');
  assert.ok(content.includes("value=\"editor\""), 'Must include editor role option');
  assert.ok(content.includes("value=\"viewer\""), 'Must include viewer role option');
});

test('InviteUserModal resets state on close', () => {
  const content = readAuthComponent('InviteUserModal.tsx');
  assert.ok(
    content.includes('resetAndClose'),
    'Must define resetAndClose to clear state on close'
  );
  assert.ok(
    content.includes("setEmail('')"),
    'Must reset email on close'
  );
  assert.ok(
    content.includes("setRole("),
    'Must reset role on close'
  );
});
