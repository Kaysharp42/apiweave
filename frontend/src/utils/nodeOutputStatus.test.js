import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatNodeOutputDuration,
  getNodeOutputStatusClass,
} from './nodeOutputStatus.js';

test('getNodeOutputStatusClass handles status ranges', () => {
  assert.match(getNodeOutputStatusClass(undefined), /bg-surface-overlay/);
  assert.match(getNodeOutputStatusClass(201), /bg-green-100/);
  assert.match(getNodeOutputStatusClass(302), /bg-orange-100/);
  assert.match(getNodeOutputStatusClass(500), /bg-red-100/);
});

test('formatNodeOutputDuration formats milliseconds and seconds', () => {
  assert.equal(formatNodeOutputDuration(350), '350ms');
  assert.equal(formatNodeOutputDuration(1250), '1.25s');
});

test('formatNodeOutputDuration returns null for invalid duration values', () => {
  assert.equal(formatNodeOutputDuration(undefined), null);
  assert.equal(formatNodeOutputDuration('abc'), null);
});
