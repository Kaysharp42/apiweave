import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCanvasClipboardShortcutAction,
  hasSelectedText,
  isEditableKeyboardTarget,
} from './shortcutGuards.js';

const createSelectionDoc = ({ text = '', isCollapsed = false, rangeCount = 1 } = {}) => ({
  getSelection: () => ({
    rangeCount,
    isCollapsed,
    toString: () => text,
  }),
});

test('isEditableKeyboardTarget detects input and textarea', () => {
  assert.equal(isEditableKeyboardTarget({ tagName: 'input' }), true);
  assert.equal(isEditableKeyboardTarget({ tagName: 'textarea' }), true);
});

test('isEditableKeyboardTarget detects contenteditable and rich editor wrappers', () => {
  assert.equal(isEditableKeyboardTarget({ isContentEditable: true }), true);

  const richTarget = {
    closest: (selector) => selector.includes('.monaco-editor') ? {} : null,
  };
  assert.equal(isEditableKeyboardTarget(richTarget), true);
});

test('hasSelectedText returns true only for non-empty user selections', () => {
  assert.equal(hasSelectedText(createSelectionDoc({ text: 'abc', isCollapsed: false })), true);
  assert.equal(hasSelectedText(createSelectionDoc({ text: '   ', isCollapsed: false })), false);
  assert.equal(hasSelectedText(createSelectionDoc({ text: 'abc', isCollapsed: true })), false);
  assert.equal(hasSelectedText(createSelectionDoc({ text: 'abc', rangeCount: 0 })), false);
});

test('getCanvasClipboardShortcutAction blocks in editor overlays', () => {
  const action = getCanvasClipboardShortcutAction({
    event: { key: 'c', ctrlKey: true, target: {} },
    hasSelectedNode: true,
    isEditorOverlayOpen: true,
  });
  assert.equal(action, null);
});

test('getCanvasClipboardShortcutAction prioritizes text/editable contexts', () => {
  const eventInInput = {
    key: 'c',
    ctrlKey: true,
    target: { tagName: 'INPUT' },
  };

  assert.equal(
    getCanvasClipboardShortcutAction({
      event: eventInInput,
      hasSelectedNode: true,
      isEditorOverlayOpen: false,
    }),
    null,
  );

  const eventWithSelection = {
    key: 'c',
    ctrlKey: true,
    target: { ownerDocument: createSelectionDoc({ text: 'copy me' }) },
  };

  assert.equal(
    getCanvasClipboardShortcutAction({
      event: eventWithSelection,
      hasSelectedNode: true,
      isEditorOverlayOpen: false,
    }),
    null,
  );
});

test('getCanvasClipboardShortcutAction handles canvas copy/paste intent', () => {
  const copyAction = getCanvasClipboardShortcutAction({
    event: {
      key: 'c',
      ctrlKey: true,
      target: { ownerDocument: createSelectionDoc({ text: '', isCollapsed: true }) },
    },
    hasSelectedNode: true,
    isEditorOverlayOpen: false,
  });
  assert.equal(copyAction, 'copy');

  const copyWithoutSelection = getCanvasClipboardShortcutAction({
    event: {
      key: 'c',
      ctrlKey: true,
      target: { ownerDocument: createSelectionDoc({ text: '', isCollapsed: true }) },
    },
    hasSelectedNode: false,
    isEditorOverlayOpen: false,
  });
  assert.equal(copyWithoutSelection, null);

  const pasteAction = getCanvasClipboardShortcutAction({
    event: {
      key: 'v',
      metaKey: true,
      target: { ownerDocument: createSelectionDoc({ text: '', isCollapsed: true }) },
    },
    hasSelectedNode: false,
    isEditorOverlayOpen: false,
  });
  assert.equal(pasteAction, 'paste');
});
