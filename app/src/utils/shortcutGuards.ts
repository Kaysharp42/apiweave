const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="textbox"]',
  ".monaco-editor",
  ".cm-editor",
].join(", ");

const hasClosest = (
  value: EventTarget | null,
): value is Element & { closest: Element["closest"] } =>
  value !== null && typeof (value as Element).closest === "function";

export const isEditableKeyboardTarget = (
  target: EventTarget | null | undefined,
): boolean => {
  if (!target) return false;

  if (hasClosest(target) && target.closest(EDITABLE_SELECTOR)) {
    return true;
  }

  const tagName = (target as HTMLElement).tagName?.toUpperCase?.();
  if (tagName === "INPUT" || tagName === "TEXTAREA") {
    return true;
  }

  if (
    (target as HTMLElement).isContentEditable ||
    (target as HTMLElement).contentEditable === "true"
  ) {
    return true;
  }

  return false;
};

export const hasSelectedText = (
  doc: Document | null | undefined = globalThis.document,
): boolean => {
  const selection = doc?.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false;
  }

  return selection.toString().trim().length > 0;
};

type ClipboardAction = "copy" | "paste" | null;

export const getCanvasClipboardShortcutAction = ({
  event,
  hasSelectedNode,
  isEditorOverlayOpen,
}: {
  event: KeyboardEvent | null | undefined;
  hasSelectedNode: boolean;
  isEditorOverlayOpen: boolean;
}): ClipboardAction => {
  if (!event || event.defaultPrevented || isEditorOverlayOpen) {
    return null;
  }

  const key = event.key?.toLowerCase?.();
  const isClipboardCombo =
    (event.ctrlKey || event.metaKey) && (key === "c" || key === "v");
  if (!isClipboardCombo) {
    return null;
  }

  if (isEditableKeyboardTarget(event.target)) {
    return null;
  }

  const doc =
    (event.target as Node | null)?.ownerDocument ?? globalThis.document;
  if (hasSelectedText(doc)) {
    return null;
  }

  if (key === "c") {
    return hasSelectedNode ? "copy" : null;
  }

  return "paste";
};
