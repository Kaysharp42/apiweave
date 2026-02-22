const EDITABLE_SELECTOR = [
  'input',
  'textarea',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '.monaco-editor',
  '.cm-editor',
].join(', ');

const hasClosest = (value) => value && typeof value.closest === 'function';

export const isEditableKeyboardTarget = (target) => {
  if (!target) return false;

  if (hasClosest(target) && target.closest(EDITABLE_SELECTOR)) {
    return true;
  }

  const tagName = target.tagName?.toUpperCase();
  if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
    return true;
  }

  if (target.isContentEditable || target.contentEditable === 'true') {
    return true;
  }

  return false;
};

export const hasSelectedText = (doc = globalThis.document) => {
  const selection = doc?.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false;
  }

  return selection.toString().trim().length > 0;
};

export const getCanvasClipboardShortcutAction = ({
  event,
  hasSelectedNode,
  isEditorOverlayOpen,
}) => {
  if (!event || event.defaultPrevented || isEditorOverlayOpen) {
    return null;
  }

  const key = event.key?.toLowerCase?.();
  const isClipboardCombo = (event.ctrlKey || event.metaKey) && (key === 'c' || key === 'v');
  if (!isClipboardCombo) {
    return null;
  }

  if (isEditableKeyboardTarget(event.target)) {
    return null;
  }

  const doc = event.target?.ownerDocument || globalThis.document;
  if (hasSelectedText(doc)) {
    return null;
  }

  if (key === 'c') {
    return hasSelectedNode ? 'copy' : null;
  }

  return 'paste';
};
