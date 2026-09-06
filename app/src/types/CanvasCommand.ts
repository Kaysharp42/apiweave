export interface CanvasCommand {
  id: string;
  title: string;
  group: string;
  keywords: readonly string[];
  shortcut?: string;
  when: () => boolean;
  run: () => void;
}
