import { useEffect, useRef } from 'react';
import Mousetrap from 'mousetrap';

/**
 * useKeyboardShortcuts — global keyboard shortcut bindings via mousetrap.
 *
 * Binds once on mount, unbinds on unmount.
 * All callbacks are stored in a ref so they can be updated without rebinding.
 */
export default function useKeyboardShortcuts({
  onNewWorkflow,
  onSave,
  onRun,
  onCloseTab,
  onNextTab,
  onPrevTab,
  onToggleEnvironmentManager,
  onToggleJsonEditor,
  onToggleSidebar,
  onShowShortcutsHelp,
} = {}) {
  const callbacks = useRef({});

  // Keep callbacks fresh without rebinding
  useEffect(() => {
    callbacks.current = {
      onNewWorkflow,
      onSave,
      onRun,
      onCloseTab,
      onNextTab,
      onPrevTab,
      onToggleEnvironmentManager,
      onToggleJsonEditor,
      onToggleSidebar,
      onShowShortcutsHelp,
    };
  });

  useEffect(() => {
    const call = (name) => (e) => {
      e.preventDefault();
      callbacks.current[name]?.();
    };

    Mousetrap.bind('ctrl+n', call('onNewWorkflow'));
    Mousetrap.bind('ctrl+s', call('onSave'));
    Mousetrap.bind(['ctrl+r', 'f5'], call('onRun'));
    Mousetrap.bind('ctrl+w', call('onCloseTab'));
    Mousetrap.bind('ctrl+e', call('onToggleEnvironmentManager'));
    Mousetrap.bind('ctrl+j', call('onToggleJsonEditor'));
    Mousetrap.bind('ctrl+b', call('onToggleSidebar'));
    Mousetrap.bind('?', (e) => {
      // Only fire if not typing in an input/textarea
      const tag = e.target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      e.preventDefault();
      callbacks.current.onShowShortcutsHelp?.();
    });

    return () => {
      Mousetrap.unbind('ctrl+n');
      Mousetrap.unbind('ctrl+s');
      Mousetrap.unbind(['ctrl+r', 'f5']);
      Mousetrap.unbind('ctrl+w');
      Mousetrap.unbind('ctrl+e');
      Mousetrap.unbind('ctrl+j');
      Mousetrap.unbind('ctrl+b');
      Mousetrap.unbind('?');
    };
  }, []);
}
