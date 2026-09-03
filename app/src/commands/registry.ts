import type {
  CanvasCommand,
  CanvasCommandActions,
  CanvasNodeTemplate,
} from "../types";

const nodeCommands: readonly CanvasNodeTemplate[] = [
  {
    type: "http-request",
    label: "GET Request",
    config: { method: "GET" },
  },
  {
    type: "http-request",
    label: "POST Request",
    config: { method: "POST" },
  },
  {
    type: "http-request",
    label: "PUT Request",
    config: { method: "PUT" },
  },
  {
    type: "http-request",
    label: "DELETE Request",
    config: { method: "DELETE" },
  },
  {
    type: "http-request",
    label: "PATCH Request",
    config: { method: "PATCH" },
  },
  { type: "assertion", label: "Assertion" },
  { type: "delay", label: "Delay" },
  { type: "merge", label: "Merge" },
  { type: "workflow", label: "Call Workflow" },
  { type: "end", label: "End" },
];

export function createCanvasCommandRegistry(
  actions: CanvasCommandActions,
): readonly CanvasCommand[] {
  const commands: CanvasCommand[] = [
    {
      id: "workflow.save",
      title: "Save workflow",
      group: "Workflow",
      keywords: ["save", "persist"],
      shortcut: "Ctrl+S",
      when: () => actions.isHydrated,
      run: actions.save,
    },
    {
      id: "workflow.run",
      title: "Run workflow",
      group: "Workflow",
      keywords: ["run", "execute", "test"],
      shortcut: "Ctrl+R",
      when: () => actions.isHydrated && !actions.isRunning,
      run: actions.run,
    },
    {
      id: "workflow.history",
      title: "Open run history",
      group: "Workflow",
      keywords: ["history", "runs", "previous"],
      when: () => actions.isHydrated,
      run: actions.openHistory,
    },
    {
      id: "canvas.auto-layout",
      title: "Auto-layout canvas",
      group: "Canvas",
      keywords: ["layout", "arrange", "diagram"],
      when: () => actions.isHydrated,
      run: actions.autoLayout,
    },
    {
      id: "canvas.json-editor",
      title: "Open JSON editor",
      group: "Canvas",
      keywords: ["json", "editor", "source"],
      shortcut: "Ctrl+J",
      when: () => actions.isHydrated,
      run: actions.openJsonEditor,
    },
    {
      id: "canvas.import",
      title: "Import nodes",
      group: "Canvas",
      keywords: ["import", "openapi", "curl"],
      when: () => actions.isHydrated,
      run: actions.openImport,
    },
    {
      id: "canvas.undo",
      title: "Undo",
      group: "Canvas",
      keywords: ["undo", "history", "revert"],
      shortcut: "Ctrl+Z",
      when: () => actions.canUndo,
      run: actions.undo,
    },
    {
      id: "canvas.redo",
      title: "Redo",
      group: "Canvas",
      keywords: ["redo", "history", "repeat"],
      shortcut: "Ctrl+Shift+Z",
      when: () => actions.canRedo,
      run: actions.redo,
    },
    {
      id: "canvas.group",
      title: "Group selected nodes",
      group: "Canvas",
      keywords: ["group", "frame", "selection"],
      shortcut: "Ctrl+G",
      when: () => actions.isHydrated,
      run: actions.group,
    },
    {
      id: "canvas.ungroup",
      title: "Ungroup selected nodes",
      group: "Canvas",
      keywords: ["ungroup", "frame", "selection"],
      shortcut: "Ctrl+Shift+G",
      when: () => actions.isHydrated,
      run: actions.ungroup,
    },
    {
      id: "canvas.lock",
      title: actions.isLocked ? "Unlock camera" : "Lock camera",
      group: "Canvas",
      keywords: ["lock", "camera", "pan"],
      when: () => true,
      run: actions.toggleLock,
    },
    {
      id: "canvas.snap-to-grid",
      title: actions.snapToGrid ? "Disable snap to grid" : "Enable snap to grid",
      group: "Canvas",
      keywords: ["snap", "grid", "align"],
      when: () => true,
      run: actions.toggleSnapToGrid,
    },
    {
      id: "canvas.focus-mode",
      title: "Focus selected node",
      group: "Canvas",
      keywords: ["focus", "node", "inspect", "full screen"],
      when: () => actions.isHydrated,
      run: actions.focusMode,
    },
  ];

  return [
    ...commands,
    ...nodeCommands.map(
      (template): CanvasCommand => ({
        id: `node.add.${template.label.toLowerCase().replaceAll(" ", "-")}`,
        title: `Add ${template.label}`,
        group: "Add node",
        keywords: ["add", "node", template.type, ...Object.values(template.config ?? {})]
          .filter((value): value is string => typeof value === "string"),
        when: () => actions.isHydrated,
        run: () => actions.addNode(template),
      }),
    ),
  ];
}
