# Node Editor Internals

*How the node editor dialog is built, how Previous/Next decide where to go, and the rendering rules that keep a step from flashing. For contributors changing `NodeModal` or anything mounted inside it.*

## Prerequisites

- [Stepping between nodes in the editor](../features/workflows-and-nodes.md#stepping-between-nodes-in-the-editor), for what the user sees.
- [Architecture](architecture.md), for where the renderer sits.

## Table of Contents

- [Component Layers](#component-layers)
- [Rendering Rules for a Step](#rendering-rules-for-a-step)
- [Where Previous and Next Go](#where-previous-and-next-go)
- [Keyboard and Focus](#keyboard-and-focus)
- [Tests That Guard This](#tests-that-guard-this)
- [Troubleshooting](#troubleshooting)
- [Related](#related)

## Component Layers

A step changes the `node` prop and nothing else. Each layer below either outlives the step or is rebuilt for the new node, and which one it is matters:

```text
WorkflowCanvas           renders <NodeModal> while a node is open: no `key`
└─ NodeModal             the Headless UI dialog (Modal molecule): lives for the whole walk
   └─ NodeEditor         per-node state, reset in render when node.id changes: no `key`
      └─ NodeModalShell  title bar, tabs, Allotment split, footer: lives for the whole walk
         ├─ name Input            key={nodeId}
         ├─ request bar content   key={nodeId}
         ├─ form scroll container key={nodeId}   (each node starts scrolled to the top)
         └─ response content      key={nodeId}
```

| File | Role |
| --- | --- |
| `components/NodeModal.tsx` | `NodeModal` owns the dialog; the inner `NodeEditor` owns the draft, the HTTP config and the tab states, and exposes `close()` through `useImperativeHandle` so the dialog's Escape and outside-click apply the draft |
| `components/node-modal/NodeModalShell.tsx` | The layout. Takes `nodeId` and keys every per-node area with it |
| `components/node-modal/NodeModalTitleBar.tsx` | Previous, the node name, the type badge, Next, close |
| `components/molecules/NodeStepButton.tsx`, `NodeStepMenu.tsx`, `NodeStepMenuItem.tsx` | The step buttons and the branch picker |
| `hooks/useNodeEditorWalk.ts` | Which node is open, the walked trail, and which way the last step went (`arrivedBy`) |
| `hooks/useNodeStepPicker.ts`, `hooks/usePopoverDismiss.ts`, `utils/nodeStepPickerIntent.ts` | Picker keyboard and dismiss handling |
| `utils/nodeNavigation.ts` | Pure graph logic: `nextNodeSteps`, `previousStepsFor`, `trailAfterStep`, `isEditableNode`, `toNodeStep` |

## Rendering Rules for a Step

Each rule below fixed a visible glitch. Breaking one brings that glitch back.

### 1. Never key the dialog by node id

Symptom: on every step the backdrop and panel fade and scale in from nothing, and for a frame there is no dialog at all.

Cause: `<NodeModal key={modalNode.id}>` makes React unmount the Headless UI `Dialog` and mount a new one, which replays its `Transition` enter animation. The `Modal` molecule's `appear` transition always runs on mount.

Rule: the canvas renders `NodeModal` without a key. Anything that must start fresh per node is keyed *inside* it.

### 2. Never key the editor or the shell by node id

Symptom: for one frame after a step, the Response pane is drawn over the left half of the form at the wrong width, hiding some inputs, then snaps back. Users describe this as fields that appear and disappear.

Cause: Allotment measures its container with a `ResizeObserver`, whose callback runs after paint. A freshly mounted `<Allotment>` paints once before it knows its width. Keying `NodeEditor` (or anything above the `Allotment`) remounts the split on every step.

Rule: `NodeEditor` and `NodeModalShell` stay mounted. Key only the per-node leaves, as in [Component Layers](#component-layers). A side benefit is that the split width and a hidden Response pane carry over from node to node.

### 3. Reset per-node state during render, not in an effect

Symptom (if done in an effect): the new node's form paints once beside the old node's request bar (method and URL).

Cause: an effect runs after the commit has painted, so the first frame mixes the new keyed panels with the old `httpConfig` state.

Rule: `NodeEditor` stores the draft in state with the id of the node it belongs to and swaps it during render, which React re-runs before committing:

```tsx
const [draft, setDraft] = useState(() => draftFor(node));
const [httpConfig, setHttpConfig] = useState(() => httpConfigFor(node));
if (draft.nodeId !== node.id) {
  setDraft(draftFor(node));
  setHttpConfig(httpConfigFor(node));
}
const workingDataRef = draft.working; // handed to the config panels
```

The draft (`NodeEditorDraft`) holds the `{ current }` object the config panels write to, plus `applied`, the last data sent to `onSave`. A different object in `working.current` means unapplied edits. The tab states are deliberately *not* reset, so each node type keeps its tab across a walk.

### 4. Apply the draft before the step, not after

`NodeEditor` wraps `steps.onStep` so it calls `applyDraft()` first, while `node` and `draft` still belong to the node being left. Only **Cancel** discards edits.

### 5. Keep the picker in the dialog's DOM

The branch picker renders inline (absolutely positioned under the button), not in a portal. Headless UI treats a click on a portalled element as a click outside the `Dialog` and closes it.

## Where Previous and Next Go

`nextNodeSteps(nodes, edges, nodeId)` returns one `NodeStep` per outgoing edge to an editable node (never Start, End, group or note), ordered pass/ready, plain, complete, fail. A step records its `handle`, whether it `ranLastRun`, and a one-line `detail`:

```ts
// browser step: browserStepSummary, the same line the canvas card shows
{ label: "Click", detail: "click getByRole('button', { name: 'Save' })" }
// request: METHOD url
{ label: "Get user", detail: "GET /users/{{variables.id}}" }
```

The button always reads **Previous**/**Next**. Recorded browser steps are mostly all named "Click", so a button titled with the destination reads as an action. The destination goes in the tooltip and the picker rows.

**Previous** pops the walked trail (`trailAfterStep`). With an empty trail, `previousStepsFor` follows incoming edges, so a Merge offers each of its inputs. When the editor closes after a walk, the canvas calls `selectAndFrame` on the node it ended on.

## Keyboard and Focus

| Key | Where | Effect |
| --- | --- | --- |
| `←` / `→` | Focus not in a text field | Step (`previousNode` / `nextNode` in the **Node editor** shortcut group) |
| `Alt+←` / `Alt+→` | Anywhere in the editor | Step |
| `↑` `↓` `1`–`9` `Enter` `Escape` | Picker open | Move, pick, take, close the picker only |

The dialog's `initialFocus` is the name field, and it runs once per open. After a step, `NodeModalTitleBar` focuses the button the step went by (an effect on `[nodeId, arrivedBy]`), so the next bare arrow press steps again even when the step came from `Alt+→` inside a field that was just remounted.

## Tests That Guard This

```bash
cd app
npx vitest run src/components/NodeModal.keyboard.test.tsx src/components/NodeModal.test.ts src/utils/nodeNavigation.test.ts src/hooks/useNodeEditorWalk.test.ts
```

- "a step keeps the dialog and its layout, and replaces only the node's fields" asserts that the dialog element and the Save button are the same elements before and after a step, that a hidden Response pane stays hidden, and that a rename after the step saves to the new node only.
- `NodeModal.test.ts` asserts that `NodeModal` has no `key={editor.node.id}` and that the shell keys by `nodeId`.

## Troubleshooting

- **If a step flashes the whole dialog**, something above `NodeEditor` gained a `key` that changes per node. Search `WorkflowCanvas.tsx` and `NodeModal.tsx` for `key=` and remove it.
- **If the Response pane jumps or covers the form for a frame**, the `Allotment` is being remounted. Move the `key` down to the content inside the pane.
- **If a field shows the previous node's value after a step**, that field seeds from a prop once (`defaultValue`, or `useState(initial)`) and sits outside a keyed area. Key it by `nodeId` in the shell, or move it into a keyed area.
- **If a new piece of per-node state leaks across steps**, reset it in the `draft.nodeId !== node.id` block in `NodeEditor`, not in a `useEffect`.
- **If clicking in the picker closes the editor**, the picker was moved into a portal. Render it inline.

## Related

- [Workflows and Nodes](../features/workflows-and-nodes.md)
- [Browser Steps](../features/browser-steps.md)
- [Architecture](architecture.md)
