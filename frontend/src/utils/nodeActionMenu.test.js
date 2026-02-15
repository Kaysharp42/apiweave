import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNodeActionMenuItems,
  getNextNodeActionMenuFocusIndex,
  getNextNodeExpandedState,
} from './nodeActionMenu.js';

test('buildNodeActionMenuItems always includes duplicate and copy', () => {
  const items = buildNodeActionMenuItems({ collapsible: false });

  assert.deepEqual(items.map((item) => item.key), ['duplicate', 'copy']);
});

test('buildNodeActionMenuItems includes expand action for collapsible nodes', () => {
  const items = buildNodeActionMenuItems({ collapsible: true, isExpanded: false });

  assert.deepEqual(items.map((item) => item.key), ['duplicate', 'copy', 'toggle-expand']);
  assert.equal(items[2].label, 'Expand');
});

test('buildNodeActionMenuItems switches expand label when expanded', () => {
  const items = buildNodeActionMenuItems({ collapsible: true, isExpanded: true });
  assert.equal(items[2].label, 'Collapse');
});

test('getNextNodeExpandedState toggles expanded state', () => {
  assert.equal(getNextNodeExpandedState(true), false);
  assert.equal(getNextNodeExpandedState(false), true);
});

test('getNextNodeActionMenuFocusIndex handles keyboard navigation', () => {
  assert.equal(getNextNodeActionMenuFocusIndex({ currentIndex: 0, total: 3, key: 'ArrowDown' }), 1);
  assert.equal(getNextNodeActionMenuFocusIndex({ currentIndex: 0, total: 3, key: 'ArrowUp' }), 2);
  assert.equal(getNextNodeActionMenuFocusIndex({ currentIndex: 1, total: 3, key: 'Home' }), 0);
  assert.equal(getNextNodeActionMenuFocusIndex({ currentIndex: 1, total: 3, key: 'End' }), 2);
});
