import type { CanvasNodeTemplate } from "./CanvasNodeTemplate";

export interface CanvasCommandActions {
  isHydrated: boolean;
  isRunning: boolean;
  canUndo: boolean;
  canRedo: boolean;
  isLocked: boolean;
  snapToGrid: boolean;
  save: () => void;
  run: () => void;
  autoLayout: () => void;
  openJsonEditor: () => void;
  openImport: () => void;
  openHistory: () => void;
  undo: () => void;
  redo: () => void;
  group: () => void;
  ungroup: () => void;
  toggleLock: () => void;
  toggleSnapToGrid: () => void;
  focusMode: () => void;
  addNode: (template: CanvasNodeTemplate) => void;
}
