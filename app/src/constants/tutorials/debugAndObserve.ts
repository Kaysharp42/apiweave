import type { TutorialChapter } from "../../types";

/**
 * Chapter 4 — Debug and observe. Runs and history, the visualization
 * surface (timeline, provenance, secret confidence and the run camera), and
 * load runs.
 */
export const debugAndObserveChapter: TutorialChapter = {
  id: "debug-and-observe",
  title: "Debug and observe",
  summary:
    "Run, cancel and inspect; read the timeline, trace variables, and follow the camera; then measure a workflow under load.",
  lessons: [
    {
      id: "runs-history",
      chapterId: "debug-and-observe",
      title: "Runs and run history",
      summary:
        "Running and cancelling, full-graph behaviour, node states, timing, request/response inspection, and reading failures.",
      outcome:
        "You can run a workflow, read exactly what each node did, and find a past run's outcome in history.",
      keywords: [
        "run",
        "cancel",
        "history",
        "node status",
        "response",
        "failure",
        "unresolved placeholder",
        "timing",
        "duration",
      ],
      durationMinutes: 6,
      prerequisites: ["A workflow with at least one HTTP Request node."],
      steps: [
        {
          title: "Run the workflow",
          instruction:
            "Select an environment in the canvas toolbar and click Run (or press Ctrl+R / F5).",
          detail:
            "Run always executes the full graph from the Start node. The Run menu also shows Run from last failed node and Run all failed nodes and continue, but they are not wired to a resume path in this release and start a full run; treat them as unavailable.",
        },
        {
          title: "Cancel a run in flight",
          instruction:
            "While a run is going, the Run button becomes Cancel. Click it to stop the run.",
        },
        {
          title: "Read node states on the canvas",
          instruction:
            "Watch nodes change state as they execute: idle, running, success, error, warning/retry, and skipped. Each state carries a colour, a glyph and, where space allows, a label.",
          detail:
            "A skipped node shows a dash, never a check — it is a distinct state, not a success with a caveat.",
        },
        {
          title: "Inspect one node's result",
          instruction:
            "Double-click a node after the run to open its editor and output. Use the Tree tab to browse the response, and the Raw tab to read the exact body.",
          detail:
            "The request bar shows the method and URL that ran, and Copy as cURL copies the configured request.",
        },
        {
          title: "Open run history",
          instruction:
            "Click History in the canvas toolbar to see the workflow's runs. Select a run to load its node results back onto the canvas.",
        },
        {
          title: "Read a failure",
          instruction:
            "For a failed node, read the error message and status. The run records unresolved placeholders per node, so a missing or misspelled key is named rather than silent.",
        },
        {
          title: "Use the run's summary facts",
          instruction:
            "Read the run's overall status, duration, start and completion times, and the failed node list.",
        },
        {
          title: "Understand run persistence and masking",
          instruction:
            "Know that each completed node is persisted through the run repository and every resolved secret value is scrubbed before persistence.",
          detail:
            "Run history stays on this machine (Git sync never commits it), and agents connected over MCP can read it. Addresses are kept whole, query and fragment included, so a value a site put in an address itself — a sign-in code, a signed download link, a session id — is stored as it was: only your {{secrets.*}} values are masked. Report files leave the query out.",
        },
      ],
      example: {
        caption: "What a completed run records",
        language: "text",
        code: "Run  workflow \"Login flow\"  env: Staging\n  nodes: 5 / 5 passed\n  duration: 1.2s\n  per node: status, http status code, duration, startedAt, completedAt\n  unresolved placeholders: none\n  secrets: API_TOKEN . environment (resolved)",
      },
      expectedResult:
        "Nodes light up in execution order, each one reports its own status and payload, and the run appears in History with its timing and outcome.",
      troubleshooting: [
        {
          title: "Run does nothing",
          instruction:
            "The main process may not be responsive. Quit and relaunch, then retry.",
        },
        {
          title: "A node is skipped unexpectedly",
          instruction:
            "An upstream assertion or condition routed the flow around it. Check the edges and the assertion's pass/fail handles.",
        },
        {
          title: "The response body is missing",
          instruction:
            "Only runs that produced a body store one, and large bodies live in a separate blob table read on demand. Re-run if the node did not execute.",
        },
      ],
      relatedLessonIds: [
        "first-workflow",
        "visual-debugging",
        "assertions",
        "sse",
      ],
    },
    {
      id: "visual-debugging",
      chapterId: "debug-and-observe",
      title: "Visualize and debug a run",
      summary:
        "Run timeline and waterfall, branch durations, variable provenance, secret resolution confidence, and the run camera.",
      outcome:
        "You can see what ran in parallel, where time went, where a variable came from, and whether a secret resolved.",
      keywords: [
        "timeline",
        "waterfall",
        "gantt",
        "provenance",
        "trace",
        "variable source",
        "secret confidence",
        "camera",
        "minimap",
        "follow",
      ],
      durationMinutes: 6,
      prerequisites: ["At least one completed run of the workflow."],
      steps: [
        {
          title: "Open the run timeline",
          instruction:
            "Open History and click the activity icon on a run row. The timeline opens as a modal over the canvas.",
        },
        {
          title: "Read the waterfall",
          instruction:
            "Each executed node gets one row with a bar positioned by its start time and sized by its duration, coloured by outcome: green passed, red failed, grey skipped.",
          detail:
            "Parallel branches overlap naturally, so you can see what ran concurrently and where a merge stalled waiting on a slow branch.",
        },
        {
          title: "Open a node's detail card",
          instruction:
            "Click a timeline row to see its status, duration, start and finish times, HTTP status code, error message, and the secrets it referenced with their resolution status.",
        },
        {
          title: "Read the summary header",
          instruction:
            "The top of the timeline shows the run status, total duration, and a count of secret references.",
          detail:
            "Runs recorded before per-node timestamps existed degrade to duration-only bars with no horizontal placement.",
        },
        {
          title: "Trace a variable's provenance",
          instruction:
            "In the Variables panel, click the trace icon on a variable card to open the provenance modal. Produced by shows the node and extractor path; Consumed by lists every node that references {{variables.NAME}} and the fields that contain it.",
          detail:
            "A manually defined variable with no producer or consumer shows a Manual variable empty state.",
        },
        {
          title: "Read secret resolution confidence",
          instruction:
            "In the timeline detail card and the run-level Resolved secrets summary, read each badge: NAME · environment or NAME · workspace when resolved, NAME · missing when no scope declared it.",
          detail:
            "The value itself is never shown — only that a substitution happened and which scope won.",
        },
        {
          title: "Follow the run camera",
          instruction:
            "While a run executes, the camera smoothly follows the active branch. Zoom, pan or fit-view at any time to take over; the Resume follow pill at the top of the canvas hands control back.",
        },
        {
          title: "Use the minimap during a run",
          instruction:
            "Note that the minimap freezes while the camera is moving so the moving viewport does not smear it, and unfreezes the moment you take over.",
        },
      ],
      example: {
        caption: "Reading the timeline",
        language: "text",
        code: "run  status: failed   duration: 2.4s   secrets referenced: 2\n\nStart           |##\nGET /login      |###########           200   320ms   API_TOKEN . environment (resolved)\nAssertion       |             ##       fail  reason: template-unresolved\nPOST /orders    |               (skipped)\nEnd             |",
      },
      expectedResult:
        "The waterfall makes parallelism and the bottleneck visible, provenance names the exact node and path behind each variable, and the secret badges say which scope resolved each reference.",
      troubleshooting: [
        {
          title: "Timeline bars have no horizontal position",
          instruction:
            "The run predates per-node timestamps. Re-run the workflow to capture them.",
        },
        {
          title: "A variable shows no producer",
          instruction:
            "It was defined manually rather than by an extractor, or the producing node's extractor was removed.",
        },
        {
          title: "A secret badge reads missing",
          instruction:
            "No scope in the chain declares the key. Add it through the Secrets write flow on the environment or workspace scope.",
        },
      ],
      relatedLessonIds: ["runs-history", "variables-extractors", "secrets"],
    },
    {
      id: "load-runs",
      chapterId: "debug-and-observe",
      title: "Load runs",
      summary:
        "Run one workflow many times at once: iterations, concurrency, duration, ramp-up, thresholds, and the per-step latency report.",
      outcome:
        "You can check that an endpoint stays fast and correct under concurrent use, and fail a build when p95 latency or the error rate goes over a limit.",
      keywords: [
        "load",
        "load run",
        "load test",
        "performance",
        "concurrency",
        "latency",
        "p95",
        "percentiles",
        "throughput",
        "threshold",
        "ramp-up",
        "duration",
      ],
      durationMinutes: 6,
      prerequisites: [
        "A workflow that runs on its own and has no browser steps.",
      ],
      steps: [
        {
          title: "Open the Load run dialog",
          instruction:
            "Click the arrow beside Run to open Run options, then choose Load run….",
        },
        {
          title: "Set iterations and concurrency",
          instruction:
            "Under Load, set Iterations (the total runs to make, 100 by default) and Concurrency (the runs in flight at once, 10 by default).",
          detail:
            "Starting a load run raises the usual limit of 4 concurrent runs to at least this number, so iterations are not queued. Iterations go up to 100,000.",
        },
        {
          title: "Pace it",
          instruction:
            "Under Pacing, optionally set Duration (s) to stop starting runs after that long, and Ramp-up (s) to grow from 1 to full concurrency instead of starting a full batch.",
        },
        {
          title: "Add thresholds",
          instruction:
            "Under Pass criteria, write one threshold per line, such as p95<500 or errors<1%. A breach fails the load run.",
          detail:
            "Latency metrics are min, mean, p50, p90, p95, p99 and max in milliseconds; errors<1% is a rate and errors<5 a count of failed iterations; throughput>20 is executions per second. Each threshold is checked against every step.",
        },
        {
          title: "Feed it data",
          instruction:
            "Under Data, optionally choose a CSV or JSON file. Each iteration reads its row as {{data.<column>}}, and Iterations is set from the number of rows; with more iterations than rows, rows are reused in order.",
        },
        {
          title: "Start and read the result",
          instruction:
            "Click Start load run. The canvas follows the first iteration, and when the load run ends a notice says how it went and offers Save report, an HTML report with the latency table.",
          detail:
            "The result is kept until the app closes, for the last 20 load runs.",
        },
        {
          title: "Know what is kept",
          instruction:
            "Per step, a load run keeps the count, the error rate, latency min, mean, p50, p90, p95, p99 and max, the throughput, and the first failure. Every other iteration's results are folded into those numbers and dropped.",
          detail:
            "Each iteration still appears in History, showing only its status and timing.",
        },
        {
          title: "Gate a build in CI",
          instruction:
            "Run apiweave run with --workflow, --concurrency and one of --iteration-count, --iteration-data or --duration. Add --ramp-up and one --threshold per gate; a breach exits 1.",
        },
      ],
      example: {
        caption: "The same load run in the app and in CI",
        language: "bash",
        code: '# App: Run options > Load run…\n#   Iterations 500   Concurrency 20   Ramp-up (s) 10\n#   Thresholds: p95<500\n#               errors<1%\n\napiweave run api.aweproject --workflow "Search" --env Staging \\\n  --concurrency 20 --iteration-count 500 --ramp-up 10s \\\n  --threshold "p95<500" --threshold "errors<1%" --reporter cli,html',
      },
      expectedResult:
        "The load run reports each step's latency percentiles, error rate and throughput, marks any breached threshold, and offers an HTML report; in CI a breach exits 1.",
      troubleshooting: [
        {
          title: "A load run cannot run a workflow with browser steps",
          instruction:
            "Load runs refuse browser steps, because each iteration would start a real browser. Run the workflow normally, or move the API calls into a workflow of their own.",
        },
        {
          title: "Latencies look too good",
          instruction:
            "The target may be caching: every iteration sends the same request unless it reads {{data.<column>}} or a dynamic function.",
        },
        {
          title: "Throughput is lower than expected",
          instruction:
            "The app or CI machine is the limit: a load run shares one process with its own request handling, so very high concurrency measures the client too.",
        },
      ],
      relatedLessonIds: ["runs-history", "visual-debugging", "git-ci"],
    },
  ],
};
