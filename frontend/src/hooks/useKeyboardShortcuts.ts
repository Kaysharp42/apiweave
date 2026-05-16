import { useEffect, useRef } from 'react';
import Mousetrap from 'mousetrap';

interface UseKeyboardShortcutsParams {
  onNewWorkflow?: () => void;
  onSave?: () => void;
  onRun?: () => void;
  onCloseTab?: () => void;
  onNextTab?: () => void;
  onPrevTab?: () => void;
  onToggleEnvironmentManager?: () => void;
  onToggleJsonEditor?: () => void;
  onToggleSidebar?: () => void;
  onShowShortcutsHelp?: () => void;
}

interface ShortcutCallbacks {
  onNewWorkflow?: (() => void) | undefined;
  onSave?: (() => void) | undefined;
  onRun?: (() => void) | undefined;
  onCloseTab?: (() => void) | undefined;
  onNextTab?: (() => void) | undefined;
  onPrevTab?: (() => void) | undefined;
  onToggleEnvironmentManager?: (() => void) | undefined;
  onToggleJsonEditor?: (() => void) | undefined;
  onToggleSidebar?: (() => void) | undefined;
  onShowShortcutsHelp?: (() => void) | undefined;
}

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
}: UseKeyboardShortcutsParams = {}) {
  const callbacks = useRef<ShortcutCallbacks>({});

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
    const call = (name: keyof ShortcutCallbacks) => (e: Mousetrap.ExtendedKeyboardEvent) => {
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
    Mousetrap.bind('?', (e: Mousetrap.ExtendedKeyboardEvent) => {
      const tag = e.target ? (e.target as HTMLElement).tagName.toLowerCase() : '';
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
