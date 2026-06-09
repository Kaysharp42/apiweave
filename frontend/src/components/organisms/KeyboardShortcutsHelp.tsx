import { Fragment } from 'react';
import { Modal } from '../molecules/Modal';
import type { ShortcutGroup } from '../../types/ShortcutGroup';
import type { KeyboardShortcutsHelpProps } from '../../types/KeyboardShortcutsHelpProps';

const shortcutGroups: ShortcutGroup[] = [
  {
    title: 'General',
    shortcuts: [
      { keys: ['Ctrl', 'N'], description: 'New workflow' },
      { keys: ['Ctrl', 'S'], description: 'Save workflow' },
      { keys: ['Ctrl', 'R'], description: 'Run workflow' },
      { keys: ['F5'], description: 'Run workflow (alt)' },
      { keys: ['?'], description: 'Show keyboard shortcuts' },
    ],
  },
  {
    title: 'Tabs',
    shortcuts: [
      { keys: ['Ctrl', 'W'], description: 'Close active tab' },
      { keys: ['Ctrl', 'Tab'], description: 'Next tab' },
      { keys: ['Ctrl', 'Shift', 'Tab'], description: 'Previous tab' },
    ],
  },
  {
    title: 'Panels',
    shortcuts: [
      { keys: ['Ctrl', 'B'], description: 'Toggle sidebar' },
      { keys: ['Ctrl', 'E'], description: 'Toggle environment manager' },
      { keys: ['Ctrl', 'J'], description: 'Toggle JSON editor' },
    ],
  },
  {
    title: 'Canvas',
    shortcuts: [
      { keys: ['Delete'], description: 'Delete selected nodes' },
      { keys: ['Ctrl', 'C'], description: 'Copy selected node (canvas only)' },
      { keys: ['Ctrl', 'V'], description: 'Paste node (canvas only)' },
      { keys: ['Ctrl', 'D'], description: 'Duplicate node' },
    ],
  },
];

export function KeyboardShortcutsHelp({ open, onClose }: KeyboardShortcutsHelpProps) {
  return (
    <Modal isOpen={open} onClose={onClose} title="Keyboard Shortcuts" size="md">
      <div className="space-y-5 py-2">
        <p className="text-xs text-text-muted dark:text-text-muted-dark">
          Node copy/paste shortcuts are context-aware. When typing or selecting text in editors/modals,
          native text copy/paste is used instead of node copy/paste.
        </p>
        {shortcutGroups.map((group) => (
          <div key={group.title}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark mb-2">
              {group.title}
            </h3>
            <div className="space-y-1">
              {group.shortcuts.map((shortcut) => (
                <div
                  key={`${group.title}-${shortcut.description}`}
                  className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors motion-reduce:transition-none"
                >
                  <span className="text-sm text-text-primary dark:text-text-primary-dark">
                    {shortcut.description}
                  </span>
                  <div className="flex items-center gap-1">
                    {shortcut.keys.map((key, keyIndex) => (
                      <Fragment key={key}>
                        {keyIndex > 0 && (
                          <span className="text-xs text-text-muted dark:text-text-muted-dark">+</span>
                        )}
                        <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-surface-overlay dark:bg-surface-dark-overlay border border-border dark:border-border-dark text-text-primary dark:text-text-primary-dark text-xs min-w-[24px] font-mono">
                          {key}
                        </kbd>
                      </Fragment>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
