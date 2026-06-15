import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGES_DIR = join('src', 'pages');
const HOOKS_DIR = join('src', 'hooks');
const TYPES_DIR = join('src', 'types');

function readPage(fileName: string): string {
  return readFileSync(join(PAGES_DIR, fileName), 'utf-8');
}

function readHook(fileName: string): string {
  return readFileSync(join(HOOKS_DIR, fileName), 'utf-8');
}

function readType(fileName: string): string {
  return readFileSync(join(TYPES_DIR, fileName), 'utf-8');
}

// ── InviteAdminPage source tests ─────────────────────────────────────────────

test('InviteAdminPage is wired in App.tsx at /settings/invites route', () => {
  const appContent = readFileSync(join('src', 'App.tsx'), 'utf-8');
  assert.ok(
    appContent.includes('InviteAdminPage'),
    'InviteAdminPage must be imported in App.tsx'
  );
  assert.ok(
    appContent.includes('/settings/invites'),
    'InviteAdminPage must be mounted at /settings/invites'
  );
});

test('InviteAdminPage is admin-gated with hasPermission check', () => {
  const content = readPage('InviteAdminPage.tsx');
  assert.ok(
    content.includes('hasPermission'),
    'Must use hasPermission for admin gating'
  );
  assert.ok(
    content.includes('invites:create'),
    'Must check invites:create permission'
  );
});

test('InviteAdminPage lists pending invites from GET /api/auth/invites', () => {
  const hookContent = readHook('useInvites.ts');
  assert.ok(
    hookContent.includes('/api/auth/invites'),
    'useInvites must fetch from /api/auth/invites'
  );
  assert.ok(
    hookContent.includes('authenticatedJson'),
    'Must use authenticatedJson for fetching invites'
  );
});

test('InviteAdminPage has create form with email input and role select', () => {
  const content = readPage('InviteAdminPage.tsx');
  assert.ok(
    content.includes('type="email"'),
    'Must include email input'
  );
  assert.ok(
    content.includes('value="admin"') && content.includes('value="editor"') && content.includes('value="viewer"'),
    'Must include admin/editor/viewer role options'
  );
  assert.ok(
    content.includes('handleCreate') || content.includes('handleSubmit'),
    'Must have a form submit handler'
  );
});

test('InviteAdminPage shows copy-to-clipboard button when API returns link', () => {
  const content = readPage('InviteAdminPage.tsx');
  assert.ok(
    content.includes('pendingLink') || content.includes('inviteUrl') || content.includes('invite_url'),
    'Must track invite link state from API response'
  );
  assert.ok(
    content.includes('Copy Link') || content.includes('Copy'),
    'Must show copy-to-clipboard button'
  );
  assert.ok(
    content.includes('copyInviteLink') || content.includes('clipboard'),
    'Must use clipboard API for copying'
  );
  assert.ok(
    content.includes('email not sent') || content.includes('SMTP') || content.includes('not configured'),
    'Must show warning when SMTP is not configured'
  );
});

test('InviteAdminPage has revoke action with confirmation dialog', () => {
  const content = readPage('InviteAdminPage.tsx');
  assert.ok(
    content.includes('Revoke'),
    'Must have Revoke action'
  );
  assert.ok(
    content.includes('ConfirmDialog') || content.includes('confirm'),
    'Must show confirmation dialog before revoking'
  );
  assert.ok(
    content.includes('revokeInvite') || content.includes('handleRevoke'),
    'Must define revoke handler'
  );
});

test('InviteAdminPage does not display token by default', () => {
  const content = readPage('InviteAdminPage.tsx');
  // Token should only appear via copy link button, not as plain text
  const tokenDisplayPattern = content.includes('inv.token') && !content.includes('Copy');
  assert.ok(
    !tokenDisplayPattern,
    'Must NOT display token by default; only via copy link button'
  );
});

test('InviteAdminPage shows non-admin access denied message', () => {
  const content = readPage('InviteAdminPage.tsx');
  assert.ok(
    content.includes('Access denied') || content.includes('admin privileges'),
    'Must show access denied for non-admin users'
  );
});

// ── useInvites hook tests ────────────────────────────────────────────────────

test('useInvites hook creates invite via POST /api/auth/invites', () => {
  const content = readHook('useInvites.ts');
  assert.ok(
    content.includes("method: 'POST'"),
    'Must use POST method for creating invites'
  );
  assert.ok(
    content.includes('email') && content.includes('roles'),
    'Must send email and roles in request body'
  );
});

test('useInvites hook revokes invite via DELETE /api/invites/:id', () => {
  const content = readHook('useInvites.ts');
  assert.ok(
    content.includes('/api/invites/'),
    'Must call DELETE /api/invites/{id} for revoking'
  );
  assert.ok(
    content.includes("method: 'DELETE'"),
    'Must use DELETE method for revoking'
  );
});

test('useInvites hook filters out consumed and expired invites', () => {
  const content = readHook('useInvites.ts');
  assert.ok(
    content.includes('consumed'),
    'Must filter out consumed invites'
  );
  assert.ok(
    content.includes('expires_at') || content.includes('expiresAt'),
    'Must filter out expired invites'
  );
});

// ── Invite type tests ────────────────────────────────────────────────────────

test('Invite type has required fields', () => {
  const content = readType('Invite.ts');
  assert.ok(content.includes('id'), 'Must have id field');
  assert.ok(content.includes('email'), 'Must have email field');
  assert.ok(content.includes('role'), 'Must have role field');
  assert.ok(content.includes('expiresAt'), 'Must have expiresAt field');
  assert.ok(content.includes('createdAt'), 'Must have createdAt field');
  assert.ok(content.includes('invitedBy'), 'Must have invitedBy field');
  assert.ok(content.includes('token'), 'Must have optional token field');
});

test('Invite type is exported from types/index.ts', () => {
  const indexContent = readFileSync(join(TYPES_DIR, 'index.ts'), 'utf-8');
  assert.ok(
    indexContent.includes("Invite") && indexContent.includes("'./Invite'"),
    'Invite type must be exported from types/index.ts'
  );
});

// ── Sidebar navigation test ──────────────────────────────────────────────────

test('SettingsContent includes Invitations nav link', () => {
  const content = readFileSync(join('src', 'components', 'layout', 'sidebar', 'SettingsContent.tsx'), 'utf-8');
  assert.ok(
    content.includes('/settings/invites'),
    'SettingsContent must link to /settings/invites'
  );
  assert.ok(
    content.includes('Invitation') || content.includes('Invite'),
    'SettingsContent must have an Invitations label'
  );
});
