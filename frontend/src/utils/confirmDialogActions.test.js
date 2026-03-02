import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveConfirmDialogIntent,
  runConfirmDialogAction,
} from './confirmDialogActions.js';

test('resolveConfirmDialogIntent keeps supported semantic intents', () => {
  assert.equal(resolveConfirmDialogIntent('error'), 'error');
  assert.equal(resolveConfirmDialogIntent('warning'), 'warning');
  assert.equal(resolveConfirmDialogIntent('INFO'), 'info');
});

test('resolveConfirmDialogIntent falls back to default intent', () => {
  assert.equal(resolveConfirmDialogIntent('unknown'), 'default');
  assert.equal(resolveConfirmDialogIntent(undefined), 'default');
});

test('runConfirmDialogAction triggers both callbacks in order', () => {
  const calls = [];

  runConfirmDialogAction({
    onConfirm: () => calls.push('confirm'),
    onClose: () => calls.push('close'),
  });

  assert.deepEqual(calls, ['confirm', 'close']);
});
