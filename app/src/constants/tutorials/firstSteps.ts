import type { TutorialChapter } from "../../types";

/**
 * Chapter 1 — First steps. Gets a reader from a blank canvas to a passing run
 * and orients them in the workspace and canvas surfaces.
 */
export const firstStepsChapter: TutorialChapter = {
  id: "first-steps",
  title: "First steps",
  summary:
    "Build and run a workflow, understand workspaces, and learn the canvas.",
  lessons: [
    {
      id: "first-workflow",
      chapterId: "first-steps",
      title: "Build and run your first workflow",
      summary:
        "Create a workflow, add a request and an assertion, run it, and read the result.",
      outcome:
        "A workflow that calls a public endpoint, asserts its status, runs green end to end, and saves itself.",
      keywords: [
        "first",
        "start",
        "new workflow",
        "httpbin",
        "run",
        "auto-save",
        "beginner",
      ],
      durationMinutes: 6,
      requiresNetwork: true,
      prerequisites: [
        "The APIWeave desktop app is installed and open.",
        "A network connection, because this exercise calls a public test endpoint.",
      ],
      steps: [
        {
          title: "Create a new workflow",
          instruction:
            "In the left sidebar, click New Workflow (or press Ctrl+N). In the prompt, type a name such as First workflow and click Create.",
          detail:
            "The workflow opens in its own tab with a single Start node already on the canvas. Start is the entry point every run begins from.",
        },
        {
          title: "Add an HTTP Request node",
          instruction:
            "Click the plus button at the bottom-right of the canvas to open Add Nodes, then drag GET Request onto the canvas.",
          detail:
            "The palette groups nodes under HTTP Requests, Streaming, Control Flow, Validation, Annotations and Layout.",
        },
        {
          title: "Add an Assertion node and an End node",
          instruction:
            "With Add Nodes still open, drag an Assertion node from Validation, then drag an End node from Control Flow. You now have Start, GET Request, Assertion and End on the canvas.",
          detail:
            "End marks a path as complete. A workflow needs at least one End node.",
        },
        {
          title: "Connect all three edges",
          instruction:
            "Drag from Start's output handle to the GET Request's input handle. Drag from GET Request's output handle to the Assertion's input handle. Drag from the Assertion's pass handle to the End node's input handle.",
          detail:
            "That is three edges: Start → GET, GET → Assertion, Assertion (pass) → End. A node with no incoming edge is never reached, so if Start is not wired to GET the run will not call the API. The Assertion's fail handle can stay unwired — the run records the failure and ends that branch.",
        },
        {
          title: "Point the request at a public endpoint",
          instruction:
            "Double-click the GET Request node to open its editor. On the Params tab, set the URL to https://httpbin.org/get and leave the method as GET.",
          detail:
            "httpbin.org is a public, auth-free test service. It is normally reachable and returns 200 for /get, but it is a third-party host: if it is down or your network blocks it, the request node turns red with a connection error (see the troubleshooting below).",
        },
        {
          title: "Configure the assertion",
          instruction:
            "Open the Assertion node. On the Rules tab, set Source to Status code, Operator to equals, and Expected value to 200.",
          detail:
            "Source status needs no path — the comparison is the response code against your expected value.",
        },
        {
          title: "Run the workflow",
          instruction:
            "Click Run in the canvas toolbar (or press Ctrl+R). An environment is optional here: this URL is hardcoded, so the run does not need one. If you already have an environment selected it is used for variable and secret resolution, but nothing in this workflow references either.",
          detail:
            "Run always executes the full graph from the Start node; there is no resume-from-failure in this release.",
        },
        {
          title: "Inspect the result",
          instruction:
            "When the run finishes, double-click the GET node to open its editor and read the status code and JSON body in the Response pane. A single click only selects the node — it does not open the editor. The nodes turn green when the run passes.",
          detail:
            "The run is written to History, reachable from the toolbar. The Variables panel shows values produced during the run.",
        },
        {
          title: "Confirm it saved",
          instruction:
            "Press Ctrl+S to flush immediately, or wait about 700 milliseconds after your last edit for the automatic save to persist the workflow.",
          detail:
            "Auto-save is on by default. The header's save indicator shows whether it is enabled.",
        },
      ],
      example: {
        caption: "The four nodes and three edges you are building",
        language: "text",
        code: "[ Start ] --edge1--> [ GET https://httpbin.org/get ] --edge2--> [ Assertion: status equals 200 ] --edge3 (pass)--> [ End ]",
      },
      expectedResult:
        "The run reaches the GET node, calls the endpoint, and the Assertion node reports that status equals 200 passed. Both working nodes render green and the End node is marked reached. The exact timing depends on the network; the result is what confirms success, not the clock.",
      troubleshooting: [
        {
          title: "Run does nothing, or a node never lights up",
          instruction:
            "Check the graph first: the workflow must have exactly one Start node, and every node you expect to run must have an incoming edge. The most common cause is a missing Start → GET edge. Then confirm the workflow is the active tab.",
        },
        {
          title: "The HTTP node turns red with a connection error",
          instruction:
            "Your network blocked the outbound call or httpbin.org is temporarily unavailable. Check the endpoint and your proxy settings, then try again.",
        },
        {
          title: "The Assertion node turns red",
          instruction:
            "The status did not match. Open the node to see the actual status code, then correct the endpoint or the expected value.",
        },
        {
          title: "Run is disabled or reports the workflow is still loading",
          instruction:
            "Wait for the workflow to finish hydrating after opening its tab, then run again. The run button also disables while a run is already in flight.",
        },
      ],
      relatedLessonIds: [
        "canvas",
        "http-requests",
        "assertions",
        "runs-history",
      ],
    },
    {
      id: "workspaces",
      chapterId: "first-steps",
      title: "Workspaces and where your work lives",
      summary:
        "How local workspaces scope workflows, environments, projects and presets, and how to switch or move between them.",
      outcome:
        "You can create a workspace, switch between workspaces, and move a workflow without duplicating it.",
      keywords: [
        "workspace",
        "personal",
        "switch",
        "scope",
        "local",
        "move workflow",
      ],
      durationMinutes: 4,
      prerequisites: ["The app is open with at least one workflow."],
      steps: [
        {
          title: "Know the container",
          instruction:
            "Read the workspace switcher in the sidebar header. A personal workspace is created for you on first launch and is the scope every other resource belongs to.",
          detail:
            "Workflows, environments, projects and node presets are all scoped to one workspace. Runs belong to the workflow that produced them.",
        },
        {
          title: "Create another workspace",
          instruction:
            "Open the workspace switcher and choose the create option, then give the workspace a name and slug.",
          detail:
            "Workspaces are local structures. No account is required, and everything stays on your machine.",
        },
        {
          title: "Switch and watch the scope change",
          instruction:
            "Pick the new workspace from the switcher. The sidebar's workflow and project lists, and the environments used by the run picker, all reload for that workspace.",
          detail:
            "Tabs you opened in the previous workspace stay in the tab store, so switching back restores them rather than discarding your place.",
        },
        {
          title: "Move a workflow between workspaces",
          instruction:
            "Right-click a workflow in the sidebar and choose Move to workspace, or use the workflow's row menu. Pick the destination workspace and confirm.",
          detail:
            "Moving clears the workflow's selected environment and drops any Call Workflow target that was left behind, because a workspace is the scope those references resolve in.",
        },
        {
          title: "Verify isolation",
          instruction:
            "In the destination workspace, open the moved workflow. Confirm it appears in the sidebar list and that its project attachment reflects the destination, not the source.",
        },
      ],
      example: {
        caption: "Workspace scoping at a glance",
        language: "text",
        code: "Workspace: Personal\n  workflows      -> scoped here\n  environments   -> scoped here\n  projects       -> scoped here\n  node presets   -> scoped here, never synced\n  runs           -> owned by their workflow",
      },
      expectedResult:
        "The sidebar, project list and environment selector all reflect the workspace you selected, and the moved workflow opens cleanly in its new home.",
      troubleshooting: [
        {
          title: "A workflow is missing after switching",
          instruction:
            "It belongs to a different workspace. Use the switcher to return to the workspace that owns it.",
        },
        {
          title: "A moved workflow's request stopped resolving a variable",
          instruction:
            "Moving clears the selected environment. Re-select an environment in the canvas toolbar.",
        },
        {
          title: "Two workspaces have the same workflow",
          instruction:
            "Moving relocates a workflow; duplicating creates a second copy. If you see two, one was copied rather than moved.",
        },
      ],
      relatedLessonIds: ["canvas", "projects", "environments"],
      destination: { label: "Go to Workflows", path: "workflows" },
    },
    {
      id: "canvas",
      chapterId: "first-steps",
      title: "The canvas, tabs and shortcuts",
      summary:
        "Palette, handles, editing, tabs, copy/paste, undo, grouping, notes, camera lock, command palette and preferences.",
      outcome:
        "You can assemble and edit a graph quickly, organise it with frames and notes, and find any action from the command palette.",
      keywords: [
        "canvas",
        "palette",
        "handles",
        "tabs",
        "copy paste",
        "undo redo",
        "group",
        "frame",
        "note",
        "camera lock",
        "shortcuts",
        "command palette",
      ],
      durationMinutes: 7,
      prerequisites: ["A workflow is open on the canvas."],
      steps: [
        {
          title: "Add nodes from the palette",
          instruction:
            "Click the plus button at the bottom-right to open Add Nodes, then drag a node onto the canvas. You can also click a palette row to add it, or right-click the canvas for the node menu.",
          detail:
            "Sections include HTTP Requests, Streaming, Control Flow, Validation, Annotations (Note) and Layout (Group Frame), plus Saved Presets and imported groups when present.",
        },
        {
          title: "Connect with handles",
          instruction:
            "Drag from a node's output handle on the right edge to the next node's input handle on the left edge.",
          detail:
            "Assertion and SSE nodes have two output handles (pass/fail and Ready/Complete). A node with no incoming edge is never reached by a run.",
        },
        {
          title: "Edit a node",
          instruction:
            "Double-click a node to open its editor. Make a change and close it; the canvas auto-saves about 700ms later.",
          detail:
            "Press Ctrl+S at any time to flush to disk immediately, bypassing the debounce.",
        },
        {
          title: "Work with tabs",
          instruction:
            "Open a second workflow from the sidebar. Switch with Ctrl+Tab and Ctrl+Shift+Tab, and close the active tab with Ctrl+W.",
          detail:
            "Tabs are workspace-scoped; each workflow opens in its own tab on the one canvas.",
        },
        {
          title: "Copy, duplicate and undo",
          instruction:
            "Select a node and press Ctrl+C then Ctrl+V to paste it, Ctrl+D to duplicate it, and Ctrl+Z / Ctrl+Shift+Z to undo and redo.",
          detail:
            "Copy and paste are canvas-only and context-aware: inside a text field, normal text copy and paste take precedence. The clipboard is session-only and does not survive a restart.",
        },
        {
          title: "Frame and ungroup nodes",
          instruction:
            "Select two or more ungrouped nodes and press Ctrl+G to frame them; select a frame and press Ctrl+Shift+G to release it.",
          detail:
            "A frame is a persisted Group node you can drag as a unit, so a large graph stays readable.",
        },
        {
          title: "Annotate without running",
          instruction:
            "Drag a Note from the Annotations section and type documentation into it. Notes are never executed.",
        },
        {
          title: "Lock the camera and follow a run",
          instruction:
            "Use the lock icon in the canvas toolbar to freeze the viewport. During a run, the camera can follow the active branch; any manual zoom or pan takes over, and a Resume follow pill at the top of the canvas hands control back.",
          detail:
            "The minimap freezes while the camera is moving so the moving viewport does not smear it.",
        },
        {
          title: "Open the command palette",
          instruction:
            "Press Ctrl+K (or click the command icon in the toolbar) and start typing. Commands include save, run, history, auto-layout, JSON editor, import, undo, redo, grouping, camera lock, snap-to-grid, focus mode, and adding each node type.",
        },
        {
          title: "Read the shortcut sheet",
          instruction:
            "Press ? to open Keyboard Shortcuts, grouped into General, Tabs, Panels and Canvas.",
        },
        {
          title: "Tune canvas behaviour",
          instruction:
            "Open Settings → Canvas to choose what left-drag does (pan or box-select), toggle wheel zoom, snap to grid with a grid size, and switch contextual canvas tips on or off.",
          detail:
            "Holding Space always pans, whichever drag mode is chosen; middle-drag pans either way.",
        },
      ],
      example: {
        caption: "Common canvas shortcuts",
        language: "text",
        code: "Ctrl+N        New workflow\nCtrl+S        Save now (auto-save still runs)\nCtrl+R / F5   Run active workflow\nCtrl+K        Command palette\nCtrl+J        JSON editor\nCtrl+C / V    Copy / paste node (canvas only)\nCtrl+D        Duplicate node\nCtrl+G        Frame selection\nCtrl+Shift+G  Ungroup\nCtrl+Z        Undo\nCtrl+Shift+Z  Redo\n?             Keyboard shortcuts",
      },
      expectedResult:
        "You can add, connect and edit nodes without leaving the canvas, reorganise the graph into frames, and reach any canvas action from the command palette.",
      troubleshooting: [
        {
          title: "A node never runs",
          instruction:
            "There is no edge from an upstream node into it. Drag a connection from the previous node's output handle.",
        },
        {
          title: "Paste drops a node on top of the source",
          instruction:
            "Click the canvas first so focus is not inside a text field; copy/paste is canvas-only.",
        },
        {
          title: "Ctrl+Z edits text instead of the canvas",
          instruction:
            "Focus is in an input or editor, where native undo applies. Click the canvas background and try again.",
        },
      ],
      relatedLessonIds: ["first-workflow", "assertions", "runs-history"],
    },
  ],
};
