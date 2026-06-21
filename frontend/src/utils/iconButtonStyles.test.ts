import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  buildIconButtonClassName,
  resolveIconButtonSizeClass,
  resolveIconButtonVariantClass,
} from './iconButtonStyles.ts';

test('resolveIconButtonSizeClass falls back to small size', () => {
  assert.equal(resolveIconButtonSizeClass('md'), 'h-9 w-9');
  assert.equal(resolveIconButtonSizeClass('unknown' as never), 'h-8 w-8');
});

test('resolveIconButtonVariantClass falls back to ghost variant', () => {
  assert.match(resolveIconButtonVariantClass('primary'), /bg-\[var\(--aw-primary\)\]/);
  assert.match(resolveIconButtonVariantClass('unknown' as never), /border-transparent/);
});

test('buildIconButtonClassName does not use removed DaisyUI semantic button classes', () => {
  const classes = buildIconButtonClassName({ variant: 'error' });

  assert.equal(/\bbtn-[a-z-]+\b/.test(classes), false);
  assert.match(classes, /bg-status-error/);
  assert.match(classes, /focus-visible:outline-2/);
  assert.match(classes, /cursor-pointer/);
});
