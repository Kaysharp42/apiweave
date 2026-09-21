import type { TutorialChapter } from "../../types";

/**
 * Chapter 5 — Organize and reuse. Presets, projects, workflow JSON and
 * collection export/import, and the two import surfaces.
 */
export const organizeChapter: TutorialChapter = {
  id: "organize",
  title: "Organize and reuse",
  summary:
    "Save reusable nodes, group workflows into projects, and bring work in or take it out.",
  lessons: [
    {
      id: "presets",
      chapterId: "organize",
      title: "Save and reuse node presets",
      summary:
        "Save a node's configuration to a workspace library, drag it onto any canvas, and manage the library.",
      outcome:
        "A standard auth header block or assertion set is one drag away in every workflow in the workspace.",
      keywords: [
        "preset",
        "node preset",
        "save as preset",
        "library",
        "reuse",
        "saved presets",
      ],
      durationMinutes: 5,
      prerequisites: ["A configured node on the canvas you want to reuse."],
      steps: [
        {
          title: "Save a node as a preset",
          instruction:
            "Configure the node until it works, then click the ⋯ button in the node's header and choose Save as preset. Name it and press Enter.",
          detail:
            "The prompt starts from the node's current label, so pressing Enter accepts something reasonable.",
        },
        {
          title: "Know which node types can be presets",
          instruction:
            "HTTP Request, SSE Stream, Assertion, Delay, Merge and Call Workflow nodes can become presets. Start and End cannot, because they carry no configuration.",
        },
        {
          title: "Drag a preset onto a canvas",
          instruction:
            "Open Add Nodes and expand Saved Presets. Drag a preset onto the canvas; it creates a normal node carrying the preset's configuration and name.",
          detail:
            "Presets are ordered by name and labelled with their node type; HTTP presets also show a method badge.",
        },
        {
          title: "Edit a dropped node freely",
          instruction:
            "Treat the dropped node as independent. Editing it does not change the preset, and editing the preset does not change nodes already dropped.",
        },
        {
          title: "Rename or delete a preset",
          instruction:
            "Hover or keyboard-focus a preset row in the palette. Use the pencil to rename (Enter saves, Escape or clicking away cancels) or the trash to delete.",
        },
        {
          title: "Know what a preset stores",
          instruction:
            "A preset holds its id, workspace, name, node type, config, a revision counter and timestamps — no position, no edges, no run history.",
          detail:
            "The config is canonicalised on write and validated against the node type it claims, so a preset can never hold a config its node type cannot load.",
        },
        {
          title: "Understand the local-only boundary",
          instruction:
            "Remember that presets are local to this machine. Cloud sync has no record type for a preset, so it never uploads and never appears on another machine.",
          detail:
            "{{secrets.NAME}} references in a preset stay references and resolve against each workflow's environment; a literal token typed into a header is stored literally, in the same database as the workflow.",
        },
      ],
      example: {
        caption: "The three ways to reuse, and how long each lasts",
        language: "text",
        code: "Preset                SQLite, with your workflows   survives restart   whole workspace\nSwagger-imported group  React state in the window     session only       current window\nCopy/paste a node       sessionStorage                session only       current session",
      },
      expectedResult:
        "The preset appears immediately under Saved Presets in Add Nodes and drags into any workflow in the workspace.",
      troubleshooting: [
        {
          title: "The Saved Presets section is missing",
          instruction:
            "The workspace has no presets yet, or the canvas has not resolved a workspace. Save one preset to make the section appear.",
        },
        {
          title: "Save as preset is absent from the menu",
          instruction:
            "The node is a Start or End node, which cannot be presets.",
        },
        {
          title: "A dropped preset fails on an unresolved secret",
          instruction:
            "The preset kept the {{secrets.NAME}} reference but the newly selected environment does not declare that key. Add it on the right scope.",
        },
        {
          title: "A preset is missing after switching machines",
          instruction:
            "That is expected: presets do not sync. Put the configuration in a workflow or export a project instead.",
        },
      ],
      relatedLessonIds: ["http-requests", "call-workflow", "projects"],
    },
    {
      id: "projects",
      chapterId: "organize",
      title: "Projects and workflow order",
      summary:
        "Create a project, attach and reorder workflows, use the enabled and continue-on-failure flags, and know the current execution limit.",
      outcome:
        "You can group related workflows into an ordered project with colours and per-row failure intent.",
      keywords: [
        "project",
        "collection",
        "order",
        "reorder",
        "enabled",
        "continue on fail",
        "color",
        "group",
      ],
      durationMinutes: 6,
      prerequisites: ["At least one saved workflow."],
      steps: [
        {
          title: "Create a project",
          instruction:
            "Switch the sidebar to Projects, then click New Project (or Create Project in the empty state). Fill in a name, optional description and a colour tag, then save.",
        },
        {
          title: "Attach workflows from the workflow side",
          instruction:
            "Open a workflow, switch the right-side panel to Settings, open the Projects section and use Add to Project to pick a project. Save.",
          detail:
            "A workflow belongs to at most one project. Reassigning it to another project removes it from the first.",
        },
        {
          title: "Or attach an existing workflow from the sidebar",
          instruction:
            "In the sidebar's project list, expand the project and use the Assign control to pick a workflow that is not yet assigned. The Add workflow button instead creates a brand-new workflow in the project.",
          detail:
            "Assigning only sets membership. The per-row enabled and continue-on-failure flags are recorded when you manage workflow order in the project's Manage workflow order view.",
        },
        {
          title: "Reorder the workflows",
          instruction:
            "Open the Projects dialog (New Project in the Projects section; it lists existing projects too) and click the list icon on the project row to manage workflow order. Drag a row by its grip handle into the new position, then click Save Order to persist.",
          detail:
            "Order records the sequence the workflows are intended to run in.",
        },
        {
          title: "Enable and disable rows",
          instruction:
            "Use each row's eye control to mark it Enabled or Disabled. A disabled workflow stays in the list so the order remains stable.",
        },
        {
          title: "Set the per-row continue-on-failure intent",
          instruction:
            "Use each row's Continue / Stop button to record intent: Continue means the next workflow should run after a failure, Stop means the sequence should halt.",
          detail:
            "This flag is project metadata, independent of the workflow's own continue-on-failure setting, which governs nodes inside that workflow.",
        },
        {
          title: "Know the current execution limit",
          instruction:
            "Remember that one-click ordered project runs are not available in this release: there is no runner that executes a whole project in order, so the order, Enabled and Continue flags are recorded intent rather than live execution settings. Run each workflow from its own canvas, in project order.",
          detail:
            "Variable and secret state does not pass between workflows. Promote a value to an environment variable or duplicate it if a downstream workflow needs it.",
        },
      ],
      example: {
        caption: "A project with order, enabled state and failure intent",
        language: "text",
        code: "Project: \"Checkout API\"  color: green\n  1. [x] Auth          continue: true\n  2. [x] Add to cart   continue: true\n  3. [ ] Visual check  (disabled, kept in place)\n  4. [x] Pay           continue: false",
      },
      expectedResult:
        "The project appears in the sidebar with its workflows in the order you saved, each row carrying its enabled state and failure intent.",
      troubleshooting: [
        {
          title: "A workflow row will not go away",
          instruction:
            "Click Remove on the row, or open the workflow's Settings panel, use Remove from project, and save.",
        },
        {
          title: "The order reverted after a drag",
          instruction:
            "Drag-and-drop updates the list in memory only. Click Save Order to persist it.",
        },
        {
          title: "You expected the project to run end to end",
          instruction:
            "Ordered project runs are not shipped. Run each workflow from its canvas in the saved order.",
        },
      ],
      relatedLessonIds: ["workspaces", "import-export", "presets"],
      destination: { label: "Go to Workflows", path: "workflows" },
    },
    {
      id: "import-export",
      chapterId: "organize",
      title: "Workflow JSON and collection export/import",
      summary:
        "The raw JSON editor, workflow export/import, .awecollection bundles, references-only secrets, and dry-run validation.",
      outcome:
        "You can edit a workflow as JSON and move a whole project to another machine without leaking secrets.",
      keywords: [
        "json editor",
        "export",
        "import",
        "awecollection",
        "bundle",
        "dry run",
        "validate",
        "references only",
        "move",
      ],
      durationMinutes: 7,
      prerequisites: ["At least one workflow, and a project for the bundle flow."],
      steps: [
        {
          title: "Open the JSON editor",
          instruction:
            "Click JSON in the canvas toolbar or press Ctrl+J. The editor shows the workflow's nodes, edges and variables as raw JSON.",
        },
        {
          title: "Edit and apply",
          instruction:
            "Make a targeted edit and apply it. The editor validates against the workflow schema and reports field-level errors if the shape is wrong.",
          detail:
            "This is for precise edits the canvas does not expose directly; small edits are safer than large rewrites.",
        },
        {
          title: "Export a single workflow",
          instruction:
            "Use the workflow's row menu to export it as a JSON bundle, and import one from the same surface to bring a workflow back.",
        },
        {
          title: "Export a project as .awecollection",
          instruction:
            "In the sidebar's project list, use the Download action on the project row (Export project), or the Export… item in its right-click menu. Save the .awecollection file.",
          detail:
            "The bundle carries project metadata and workflow order, every attached workflow with its nodes, edges, variables and settings, and environment references with their plain variables plus the secret references to re-create.",
        },
        {
          title: "Import a project",
          instruction:
            "With the Projects section selected, use Import → Collection in the sidebar header, then pick or paste the .awecollection file. Click Validate for the dry-run report, then Import Project to commit.",
        },
        {
          title: "Read the dry-run report",
          instruction:
            "The validation pass reports counts of the workflows and environments that will be created, counts any secret references that will be unresolved after import, and warns when the bundle's schema version differs from the one this app writes.",
          detail:
            "Imports always create new workflow records; existing workflows are not overwritten. Every referenced environment is created fresh, and an existing environment with the same name is not reused or merged.",
        },
        {
          title: "Re-create secrets locally",
          instruction:
            "After import, add each referenced secret through the write flow on the destination scope. Until then, every {{secrets.NAME}} placeholder resolves to nothing.",
          detail:
            "The bundle carries references only: no secret values, no sealed ciphertext, no private keys. Each install derives its own keypair from its local keyfile, so shipping ciphertext would not help anyway.",
        },
      ],
      example: {
        caption: "The secret side of a bundle (trimmed to the relevant fields)",
        language: "json",
        code: "{\n  \"schemaVersion\": \"2.0\",\n  \"type\": \"awecollection\",\n  \"secretReferences\": [\n    { \"name\": \"API_KEY\", \"scopeType\": \"workspace\", \"scopeId\": \"ws_123\" }\n  ]\n}",
      },
      expectedResult:
        "The JSON editor round-trips a valid workflow, and an exported project imports on another machine with its structure intact and a clear list of secrets to re-enter.",
      troubleshooting: [
        {
          title: "The JSON editor rejects an edit",
          instruction:
            "A missing comma or quote broke the structure. Use the validation feedback and apply smaller edits.",
        },
        {
          title: "Secrets are missing after import",
          instruction:
            "Bundles reference secret names and scopes but never values. Add each key on the destination scope through the write flow.",
        },
        {
          title: "An imported workflow reports workflow not found",
          instruction:
            "A Call Workflow node points at an id from the source workspace. Import does not remap those targets, so open the node in the imported workflow and pick the target again from the picker, then save.",
        },
      ],
      relatedLessonIds: ["projects", "openapi", "curl-har", "secrets"],
    },
    {
      id: "openapi",
      chapterId: "organize",
      title: "Import from OpenAPI or Swagger",
      summary:
        "Environment-linked spec sync, one-time file import, reusable request templates, supported versions, and private-host refresh limits.",
      outcome:
        "You can turn a spec into reusable request templates and refresh them as the spec evolves.",
      keywords: [
        "openapi",
        "swagger",
        "spec",
        "import",
        "refresh",
        "check api",
        "templates",
        "endpoints",
      ],
      durationMinutes: 7,
      prerequisites: [
        "An environment (for the environment-linked path).",
        "A reachable spec URL or a local .json/.yaml file.",
      ],
      steps: [
        {
          title: "Pick a path",
          instruction:
            "Choose environment-linked sync when the API definition changes often and you want templates to stay in step. Choose one-time file import for a quick prototype or a spec that lives only on your machine.",
        },
        {
          title: "Pin the spec URL on an environment",
          instruction:
            "Open Settings → Environments, create or open an environment, and paste the spec URL into the Swagger Doc URL field. Save.",
          detail:
            "Both a direct spec URL and a Swagger UI landing URL are accepted. Putting the URL on the environment lets you swap specs per stage without touching the canvas.",
        },
        {
          title: "Refresh on the canvas",
          instruction:
            "Open the workflow, select that environment in the toolbar, and click Refresh. The importer fetches the document and adds a group labelled Swagger: <Environment Name> to Add Nodes.",
          detail:
            "The group also refreshes automatically when you open a workflow against that environment.",
        },
        {
          title: "Drag a template onto the canvas",
          instruction:
            "Open Add Nodes, find the Swagger group, and drag a template in. It arrives pre-filled with the method, URL, parameters and body shape from the operation.",
          detail:
            "Placeholders like {{env.BASE_URL}} and {{secrets.API_KEY}} work in every field, so the imported request is usable against your selected environment.",
        },
        {
          title: "Heed the Check API badge",
          instruction:
            "When a refreshed spec no longer matches a node originally imported from it, the node gets a Check API badge. Open it to see the mismatch reason, the last refresh time, and the source URL.",
          detail:
            "A refresh never overwrites your edited body, headers or parameters. The badge is a drift signal; you decide how to reconcile it.",
        },
        {
          title: "Import from a file instead",
          instruction:
            "Open the Import panel from the canvas toolbar, choose OpenAPI, upload a .json or .yaml spec, click Preview, optionally pick a server URL, filter by tags or enable Sanitize sensitive headers, then click Add to Nodes.",
          detail:
            "A file-imported group is local to the workflow, does not depend on an environment, does not refresh, and never produces Check API badges.",
        },
        {
          title: "Know the supported versions and limits",
          instruction:
            "OpenAPI 3.0 and newer and Swagger 2.0 are supported; Swagger 1.0 is not. The spec must be reachable from the app's main process.",
        },
      ],
      example: {
        caption: "Accepted URL shapes",
        language: "text",
        code: "Direct spec URL:         https://api.example.com/v3/api-docs\nDirect spec URL:         https://api.example.com/swagger/v1/swagger.json\nSwagger UI landing URL:  https://api.example.com/swagger-ui/index.html",
      },
      expectedResult:
        "The Add Nodes panel gains a Swagger group full of ready-to-drag request templates, and nodes that drifted from the spec are flagged with a Check API badge.",
      troubleshooting: [
        {
          title: "Refresh reports Select an environment before refreshing Swagger",
          instruction:
            "Pick an environment in the canvas toolbar first; the importer reads the URL from the environment.",
        },
        {
          title: "Refresh reports the environment has no Swagger/OpenAPI URL",
          instruction:
            "Open the Environment editor and paste the spec URL into the Swagger Doc URL field.",
        },
        {
          title: "Only some endpoints import from a multi-definition Swagger UI",
          instruction:
            "One definition failed while the others succeeded. Point the environment's URL at the failing definition's direct spec URL to isolate it.",
        },
        {
          title: "Preview shows zero operations",
          instruction:
            "The file is not a valid OpenAPI 3.x or Swagger 2.0 document. Confirm the top-level openapi or swagger key is present.",
        },
      ],
      relatedLessonIds: ["environments", "http-requests", "curl-har"],
    },
    {
      id: "curl-har",
      chapterId: "organize",
      title: "Import cURL and HAR",
      summary:
        "Paste or upload a cURL command or HAR capture, inspect the generated requests, and handle captured credentials before sharing.",
      outcome:
        "You can turn a copied cURL command or a browser HAR capture into canvas nodes in seconds.",
      keywords: [
        "curl",
        "har",
        "import",
        "capture",
        "browser",
        "devtools",
        "paste",
      ],
      durationMinutes: 5,
      prerequisites: ["A cURL command or a HAR file from your browser's network tab."],
      steps: [
        {
          title: "Open the import panel",
          instruction:
            "Click Import in the canvas toolbar. The panel offers OpenAPI, HAR and Curl sources.",
        },
        {
          title: "Paste a cURL command",
          instruction:
            "Switch to the Curl tab and paste one or more commands into Curl Commands; multiple commands can be separated by &&.",
          detail:
            "The importer parses method, URL, headers, body and auth into a request node.",
        },
        {
          title: "Import a HAR capture",
          instruction:
            "Switch to the HAR tab, upload or paste a HAR file, and review the requests the importer found.",
        },
        {
          title: "Inspect before adding",
          instruction:
            "Read the generated request rows before adding them. Check the method, URL, headers and body for anything captured by accident.",
        },
        {
          title: "Add to nodes",
          instruction:
            "Click Add to Nodes. The parsed requests are saved into a group in the Add Nodes palette; open Add Nodes and drag the ones you want onto the canvas, where they behave like any other HTTP Request node.",
        },
        {
          title: "Scrub captured credentials",
          instruction:
            "Before sharing a workflow or export that came from a HAR or cURL capture, replace literal tokens and cookies with {{secrets.NAME}} references.",
          detail:
            "The JSON editor's AI Prompt copy redacts credential-shaped values, but a literal token stored in a node is stored in the same database as the workflow — treat it like a workflow node, no better or worse.",
        },
      ],
      example: {
        caption: "A cURL command the importer understands",
        language: "bash",
        code: "curl --request POST https://api.example.com/login \\\n  --header 'Content-Type: application/json' \\\n  --data '{\"user\":\"demo\",\"pass\":\"{{secrets.DEMO_PASS}}\"}'",
      },
      expectedResult:
        "The pasted requests appear as a group in the Add Nodes palette, ready to drag onto the canvas and connect.",
      troubleshooting: [
        {
          title: "The paste produces no requests",
          instruction:
            "Check the command is a valid cURL invocation and that multiple commands are separated by &&.",
        },
        {
          title: "A HAR import shows unexpected requests",
          instruction:
            "A HAR captures every request the page made. Remove the ones you do not need before adding.",
        },
        {
          title: "A captured token ended up as a literal",
          instruction:
            "Replace it with a {{secrets.NAME}} reference and store the value through the Secrets write flow.",
        },
      ],
      relatedLessonIds: ["http-requests", "openapi", "secrets", "import-export"],
    },
  ],
};
