import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAccountDisplayName,
  getAccountInitials,
  getRoleSummary,
} from './accountMenuUtils.ts';
import type { User } from '../../types/User.ts';

const baseUser: User = {
  userId: 'user-123',
  verified_email: 'jane.doe@example.com',
  display_name: 'Jane Doe',
  avatar_url: null,
  roles: ['editor'],
  permissions: ['workflows:read'],
  is_setup_complete: true,
  created_at: '2026-01-01T00:00:00Z',
};

test('getAccountDisplayName prefers display name and falls back to verified email', () => {
  assert.equal(getAccountDisplayName(baseUser), 'Jane Doe');
  assert.equal(getAccountDisplayName({ ...baseUser, display_name: '   ' }), 'jane.doe');
  assert.equal(getAccountDisplayName({ ...baseUser, display_name: null, verified_email: '', userId: 'user-456' }), 'user-456');
});

test('getAccountInitials derives a stable two-letter fallback', () => {
  assert.equal(getAccountInitials(baseUser, 'Jane Doe'), 'JD');
  assert.equal(getAccountInitials(baseUser, ''), 'JD');
  assert.equal(getAccountInitials({ ...baseUser, verified_email: '', userId: 'user-789' }, ''), 'U');
});

test('getRoleSummary shows role-specific account summary', () => {
  assert.equal(getRoleSummary({ ...baseUser, roles: ['admin'] }), 'Admin · full access');
  assert.equal(getRoleSummary({ ...baseUser, roles: ['editor'] }), 'Editor · workflow author');
  assert.equal(getRoleSummary({ ...baseUser, roles: ['viewer'] }), 'Viewer · read only');
  assert.equal(getRoleSummary({ ...baseUser, roles: ['support', 'auditor'] }), 'Support · Auditor');
  assert.equal(getRoleSummary({ ...baseUser, roles: [] }), 'No role assigned');
});
