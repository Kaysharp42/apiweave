import { Fragment } from "react";
import { Modal } from "../molecules/Modal";
import type { KeyboardShortcutsHelpProps } from "../../types/KeyboardShortcutsHelpProps";
import type { KeyboardShortcut } from "../../types";
import {
  KEYBOARD_SHORTCUTS,
  chordKeys,
} from "../../constants/keyboardShortcuts";

const GROUPS: ReadonlyArray<KeyboardShortcut["group"]> = [
  "General",
  "Tabs",
  "Panels",
  "Canvas",
];

export function KeyboardShortcutsHelp({
  open,
  onClose,
}: KeyboardShortcutsHelpProps) {
  return (
    <Modal isOpen={open} onClose={onClose} title="Keyboard Shortcuts" size="md">
      <div className="space-y-5 py-2">
        <p className="text-xs text-text-muted dark:text-text-muted-dark">
          Node copy/paste shortcuts are context-aware. When typing or selecting
          text in editors/modals, native text copy/paste is used instead of node
          copy/paste.
        </p>
        {GROUPS.map((group) => (
          <div key={group}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark mb-2">
              {group}
            </h3>
            <div className="space-y-1">
              {KEYBOARD_SHORTCUTS.filter((s) => s.group === group).map(
                (shortcut) => (
                  <div
                    key={shortcut.action}
                    className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors motion-reduce:transition-none"
                  >
                    <span className="text-sm text-text-primary dark:text-text-primary-dark">
                      {shortcut.description}
                    </span>
                    <div className="flex items-center gap-1">
                      {shortcut.chords.map((chord, chordIndex) => (
                        <Fragment key={chordKeys(chord).join("+")}>
                          {chordIndex > 0 && (
                            <span className="px-1 text-xs text-text-muted dark:text-text-muted-dark">
                              or
                            </span>
                          )}
                          {chordKeys(chord).map((key, keyIndex) => (
                            <Fragment key={key}>
                              {keyIndex > 0 && (
                                <span className="text-xs text-text-muted dark:text-text-muted-dark">
                                  +
                                </span>
                              )}
                              <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-surface-overlay dark:bg-surface-dark-overlay border border-border dark:border-border-dark text-text-primary dark:text-text-primary-dark text-xs min-w-[24px] font-mono">
                                {key}
                              </kbd>
                            </Fragment>
                          ))}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
