import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIconButtonClassName,
  resolveIconButtonSizeClass,
  resolveIconButtonVariantClass,
} from './iconButtonStyles.js';

test('resolveIconButtonSizeClass falls back to small size', () => {
  assert.equal(resolveIconButtonSizeClass('md'), 'h-9 w-9');
  assert.equal(resolveIconButtonSizeClass('unknown'), 'h-8 w-8');
});

test('resolveIconButtonVariantClass falls back to ghost variant', () => {
  assert.match(resolveIconButtonVariantClass('primary'), /bg-primary/);
  assert.match(resolveIconButtonVariantClass('unknown'), /border-transparent/);
});

test('buildIconButtonClassName does not use removed DaisyUI semantic button classes', () => {
  const classes = buildIconButtonClassName({ variant: 'error' });

  assert.equal(/\bbtn-[a-z-]+\b/.test(classes), false);
  assert.match(classes, /bg-red-600/);
});
