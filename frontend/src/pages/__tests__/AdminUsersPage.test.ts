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
    content.includes('animate-spin') || content.includes('Loader2') || content.includes('Spinner'),
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
    content.includes("type: 'reset'") || content.includes('dispatch({ type: \'reset\' })'),
    'Must reset invite form state on close'
  );
  assert.ok(
    content.includes("role: 'viewer'") || content.includes("type: 'reset'"),
    'Must reset role on close'
  );
});

// ── Behavioral source tests ───────────────────────────────────────────────────

test('AdminUsersPage derives Active status from is_setup_complete=true', () => {
  const content = readPage('AdminUsersPage.tsx');
  assert.ok(
    content.includes('is_setup_complete') && content.includes('"Active"') || content.includes("'Active'") || content.includes('label="Active"'),
    'Must show Active label when is_setup_complete is true'
  );
  assert.ok(
    content.includes('"Pending"') || content.includes("'Pending'") || content.includes('label="Pending"'),
    'Must show Pending label when is_setup_complete is false'
  );
  assert.ok(
    content.includes('"Invited"') || content.includes("'Invited'") || content.includes('label="Invited"'),
    'Must show Invited label for orphan invite rows'
  );
});

test('AdminUsersPage has copyInviteLink wired to handleCopyInviteLink', () => {
  const content = readPage('AdminUsersPage.tsx');
  assert.ok(
    content.includes('copyInviteLink'),
    'Must import and call copyInviteLink utility'
  );
  assert.ok(
    content.includes('handleCopyInviteLink'),
    'Must define handleCopyInviteLink handler'
  );
  assert.ok(
    content.includes('copyingInviteId'),
    'Must track copyingInviteId state for feedback'
  );
  assert.ok(
    content.includes("'Copied!'") || content.includes('"Copied!"'),
    'Must show Copied! feedback after copy'
  );
  assert.ok(
    content.includes('Copy Link') || content.includes('Copy link'),
    'Must show Copy Link label before copy'
  );
});

test('AdminUsersPage has handleInviteRoleChange for invited rows', () => {
  const content = readPage('AdminUsersPage.tsx');
  assert.ok(
    content.includes('handleInviteRoleChange'),
    'Must define handleInviteRoleChange for orphan invite rows'
  );
  assert.ok(
    content.includes('/api/invites/') && content.includes('/role'),
    'Must PATCH /api/invites/{id}/role endpoint'
  );
  assert.ok(
    content.includes('role_preset'),
    'Must send role_preset in invite role update body'
  );
  assert.ok(
    content.includes('Invite role updated'),
    'Must show success toast after invite role update'
  );
});

test('AdminUsersPage shows delete confirmation dialog before deleting user or invite', () => {
  const content = readPage('AdminUsersPage.tsx');
  assert.ok(
    content.includes('deleteConfirm'),
    'Must track deleteConfirm state for confirmation dialog'
  );
  assert.ok(
    content.includes('Confirm Delete'),
    'Must show Confirm Delete heading in dialog'
  );
  assert.ok(
    content.includes('cannot be undone'),
    'Must warn that delete action cannot be undone'
  );
  assert.ok(
    content.includes('handleDeleteConfirmed'),
    'Must define handleDeleteConfirmed to execute deletion'
  );
  assert.ok(
    content.includes(`/api/users/`) && content.includes("method: 'DELETE'"),
    'Must call DELETE /api/users/{id} for user deletion'
  );
  assert.ok(
    content.includes('/api/invites/'),
    'Must call DELETE /api/invites/{id} for invite deletion'
  );
  assert.ok(
    content.includes("type: 'user'") && content.includes("type: 'invite'"),
    'Must distinguish between user and invite delete types'
  );
});

test('AdminUsersPage prevents self-delete by hiding delete button for current user', () => {
  const content = readPage('AdminUsersPage.tsx');
  assert.ok(
    content.includes('isSelf'),
    'Must compute isSelf flag for current user row'
  );
  assert.ok(
    content.includes('currentUser?.userId') || content.includes('currentUser?.userId'),
    'Must compare user.userId with currentUser.userId'
  );
  assert.ok(
    content.includes('!isSelf'),
    'Must conditionally render delete button only when !isSelf'
  );
});

test('AdminUsersPage uses authenticatedFetch for delete operations', () => {
  const content = readPage('AdminUsersPage.tsx');
  assert.ok(
    content.includes('authenticatedFetch'),
    'Must import and use authenticatedFetch for delete calls'
  );
  const deleteFetchCount = (content.match(/authenticatedFetch/g) ?? []).length;
  assert.ok(
    deleteFetchCount >= 2,
    'Must call authenticatedFetch at least twice (user delete + invite delete)'
  );
});
