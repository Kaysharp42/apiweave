import test from 'node:test';
import assert from 'node:assert/strict';
import { getSidebarItemLabel } from './sidebarItemLabel.js';

test('getSidebarItemLabel keeps short labels unchanged', () => {
  const result = getSidebarItemLabel('Checkout API');

  assert.equal(result.label, 'Checkout API');
  assert.equal(result.fullLabel, 'Checkout API');
  assert.equal(result.truncated, false);
});

test('getSidebarItemLabel truncates long labels with a stable suffix', () => {
  const result = getSidebarItemLabel('A very long workflow name that should be shortened', 18);

  assert.equal(result.label, 'A very long workf...');
  assert.equal(result.fullLabel, 'A very long workflow name that should be shortened');
  assert.equal(result.truncated, true);
});

test('getSidebarItemLabel falls back for blank values', () => {
  const result = getSidebarItemLabel('   ', 20, 'Untitled workflow');

  assert.equal(result.label, 'Untitled workflow');
  assert.equal(result.fullLabel, 'Untitled workflow');
  assert.equal(result.truncated, false);
});
