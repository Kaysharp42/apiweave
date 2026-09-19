import { describe, expect, it, vi } from "vitest";
import { createCanvasCommandRegistry } from "./registry";

function createActions(overrides: Partial<Parameters<typeof createCanvasCommandRegistry>[0]> = {}) {
  return {
    isHydrated: true,
    isRunning: false,
    canUndo: true,
    canRedo: true,
    isLocked: false,
    snapToGrid: false,
    save: vi.fn(),
    run: vi.fn(),
    autoLayout: vi.fn(),
    openJsonEditor: vi.fn(),
    openImport: vi.fn(),
    openHistory: vi.fn(),
    openTutorials: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    group: vi.fn(),
    ungroup: vi.fn(),
    toggleLock: vi.fn(),
    toggleSnapToGrid: vi.fn(),
    focusMode: vi.fn(),
    addNode: vi.fn(),
    ...overrides,
  };
}

describe("createCanvasCommandRegistry", () => {
  it("has unique command ids", () => {
    const commands = createCanvasCommandRegistry(createActions());

    expect(new Set(commands.map((command) => command.id)).size).toBe(commands.length);
  });

  it("hides unavailable commands and preserves runnable commands", () => {
    const actions = createActions({ isRunning: true, canUndo: false });
    const commands = createCanvasCommandRegistry(actions);

    expect(commands.find((command) => command.id === "workflow.run")?.when()).toBe(false);
    expect(commands.find((command) => command.id === "canvas.undo")?.when()).toBe(false);
    const save = commands.find((command) => command.id === "workflow.save");
    expect(save?.when()).toBe(true);
    save?.run();
    expect(actions.save).toHaveBeenCalledOnce();
  });

  it("exposes an available Help-group tutorials command", () => {
    const actions = createActions();
    const commands = createCanvasCommandRegistry(actions);

    const tutorials = commands.find((command) => command.id === "help.tutorials");
    expect(tutorials?.group).toBe("Help");
    expect(tutorials?.keywords).toEqual(
      expect.arrayContaining(["learn", "guide", "tour", "help"]),
    );
    expect(tutorials?.when()).toBe(true);
    tutorials?.run();
    expect(actions.openTutorials).toHaveBeenCalledOnce();
  });

  it("hides the tutorials command until the workflow is hydrated", () => {
    const commands = createCanvasCommandRegistry(
      createActions({ isHydrated: false }),
    );

    expect(
      commands.find((command) => command.id === "help.tutorials")?.when(),
    ).toBe(false);
  });
});
