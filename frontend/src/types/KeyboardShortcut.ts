export interface KeyboardShortcut {
  keys: string;
  description: string;
  category: string;
  handler: () => void;
}
