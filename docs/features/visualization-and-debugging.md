# Visualization and Debugging

*Three read-mostly views that turn APIWeave's implicit dataflow and run data into
something you can see: a per-run timeline, variable provenance, and masked-secret
resolution confidence. Every one is additive — no change to the local-first,
secret-safe contract, and no secret value is ever shown.*

## What's new

1. **Run timeline / waterfall** — a per-run Gantt view of every node's execution
   window, so you can see what ran in parallel, what was the bottleneck, and
   where a Merge stalled waiting on a slow branch.
2. **Variable provenance** — click any variable in the Variables panel and trace
   it back to the node + extractor path that produced it, and forward to every
   node that consumes it via `{{variables.NAME}}`.
3. **Masked-secret debug confidence** — a value-free indicator showing whether
   each `{{secrets.NAME}}` reference resolved and at which scope, so the
   write-only secret model stops being guesswork.

---

## 1. Run timeline / waterfall

### Where to find it

Open **Run history** (the history button on the canvas toolbar) and click the
**activity** icon on any run row. The timeline opens as a modal over the canvas.

### What it shows

- A summary header: run status, total duration, and a count of secret references.
- A **waterfall** — one row per executed node, with a colored bar positioned by
  the node's start time relative to the run start and sized by its execution
  duration. Bars are colored by outcome (green = passed, red = failed, grey =
  skipped). Parallel branches overlap on the timeline naturally.
- Click a row to see a detail card: status, duration, start/finish times, HTTP
  status code, the error message (if any), and the secrets that node referenced
  with their resolution status.

### How timing is captured

Each node now records an ISO `startedAt` / `completedAt` pair on the injected
run clock, stored on the per-node run result. The run already carried a
run-level `startedAt` / `completedAt` / `duration`; the per-node windows are
additive. Runs recorded before this feature had no per-node timestamps, so
those rows degrade to duration-only bars (no horizontal placement).

### Data contract (additive)

`RunResult` gained two optional fields:

```ts
startedAt?: string | null   // ISO timestamp the node began executing
completedAt?: string | null // ISO timestamp the node finished
```

These ride in the run's persisted results and flow to the renderer over the
existing `runs.get` IPC channel. The lean live progress stream
(`run.started` / `node.status` / `run.finished` events) is unchanged — the
timeline is a post-run read.

---

## 2. Variable provenance

### Where to find it

In the **Variables** panel, each variable card has a **trace** (branch) icon next
to its edit/delete actions. Click it to open the provenance modal.

### What it shows

- **Produced by** — the node(s) whose *Store response as variables* extractor
  defines this variable, with the response path it extracts (e.g.
  `response.body.access_token`).
- **Consumed by** — the node(s) that reference `{{variables.NAME}}` anywhere in
  their config, with the fields that contain the reference (e.g. `headers`,
  `url`, `body`).
- A **Manual variable** empty state when a variable is defined by hand and no
  node produces or consumes it yet.

### How it's computed

Provenance is computed on the canvas from the live graph — no server round-trip.
A `computeProvenance(nodes)` utility walks every node's config: extractor
entries (`config.extractors`) become producers, and `{{variables.NAME}}`
placeholders found in any config string become consumers. The result is
published to a small Zustand store (`VariableProvenanceStore`) by an effect in
`WorkflowCanvas` and read by the Variables panel.

The effect only recomputes when a node's *config* actually changes (add/remove
an extractor, add a new placeholder), not on position-only drag frames, so it
stays cheap while you pan the canvas.

---

## 3. Masked-secret debug confidence

### Where to find it

- In a node's **response panel** (open an HTTP node after a run): a *Secrets*
  row lists every `{{secrets.NAME}}` the node referenced, each with a badge.
- In the **run timeline** detail card and the run-level *Resolved secrets*
  summary at the top of the timeline modal.

### What it shows

Per referenced secret, a badge that says one of:

- **`NAME · environment`** (green) — resolved, and the value came from the
  environment scope.
- **`NAME · workspace`** (green) — resolved, from the workspace scope.
- **`NAME · missing`** (red) — the name was not set in any scope, so the
  placeholder was not substituted.

The value itself is **never** shown — only that a substitution happened and
which scope won. This is safe metadata; the masking layer that redacts
secret-looking variables in run snapshots and exports is unchanged.

### How it's captured

When a run starts, the scheduler scans the workflow graph for
`{{secrets.NAME}}` references and resolves each down the environment → workspace
chain. Alongside the plaintext map handed to the executor, it now records a
safe `resolvedSecrets` array on the run:

```ts
interface ResolvedSecretInfo {
  name: string
  scopeType: "environment" | "workspace" | null
  resolved: boolean
}
```

This is persisted per-run (a targeted metadata patch, never a whole-row write)
and exposed via `runs.get`. Each node's run result also carries `secretRefs` —
the names it referenced — so the renderer can cross-reference the two without
ever receiving a value.

---

## 4. Camera-follow during runs

While a run executes, the canvas can track it so the active node stays in view
on large workflows.

### What it does

- When a run starts, the camera smoothly follows execution one branch at a
  time (a damped-spring tracker that picks the active "run front" — the deepest
  in-progress node on the branch the camera is following).
- **Any manual gesture takes over.** Zooming, panning, or using fit-view while
  the camera is moving stops the follow immediately, so your view is never
  stolen.
- A **Follow run** pill appears at the top of the canvas whenever the camera is
  not currently following. Click it to hand control back and resume tracking
  the run.
- The **minimap freezes** while the camera is in motion, so the moving
  viewport does not smear the minimap; it unfreezes the moment you take over.

### Privacy and safety

- No secret **value**, ciphertext, or key material is stored, streamed, or shown
  by any of these features. Only names, scopes, booleans, and timestamps.
- The existing `sanitizeVariablesForExport` pass still redacts secret-looking
  variables in live `node.status` snapshots and run history.
- URLs continue to forbid `{{secrets.*}}` substitution (the executor's
  `allowSecrets: false` guard is unchanged).

## Related

- [Workflows and Nodes](workflows-and-nodes.md) — node types, running, and the run camera.
- [Variables and Extractors](variables-and-extractors.md) — the placeholder
  namespaces and extractor model that provenance traces.
- [Environments and Secrets](environments-and-secrets.md) — the encrypted secret
  store and scope chain that resolution confidence reports on.
- [Documentation Hub](../README.md)
