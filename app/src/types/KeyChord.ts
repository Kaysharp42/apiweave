/**
 * One key combination. `key` is `KeyboardEvent.key` lowercased. `modifier`
 * "mod" is the platform's primary modifier (⌘ on macOS, Ctrl elsewhere);
 * "ctrl" is the Control key on every platform.
 */
export interface KeyChord {
  key: string;
  modifier?: "mod" | "ctrl";
  shift?: boolean;
}
