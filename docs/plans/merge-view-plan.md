# Merge view plan

Kept out of git. Stacked PRs from `main` (fa1dbd13), one branch per phase.

## Why

A user tracked a workspace (Kyra), pushed it to `github.com/DT-AhmedKhiari/kyra-apiweave-workspace`
(root commit `e9f3597a`, Oct 22), later stopped and restarted tracking (new root `24b00c6`), and
tried to connect again. `GitSyncService.joinRemote` (`app/core/git/git_sync_service.ts`) refuses
with `UNRELATED_HISTORY_MESSAGE` ("…Open a workspace from git instead."), and Open from git
resolves `duplicate` and links back to the Kyra already here: a dead end. The repository's
`workspace.json` holds the same `workspaceId` as the local workspace.

The user wants a merge UI like IntelliJ / GitKraken where they choose what to keep and can edit
the result.

## Decisions (user-approved)

- Same workspace id + no common ancestor = a **two-way merge**, not a refusal. Different
  workspace id stays refused (with wording that says it is another workspace, naming it).
- In a two-way merge: identical content merges silently; anything only one side has is kept
  (nothing lost); a record both sides hold is merged **field by field** (not the whole-record
  `clash` that `mergeRecord` uses today for "both added under one id"), and every field that
  differs is a conflict.
- Users can settle a conflict with their **own value**, validated so the record stays valid and
  carries no secret values.
- A new merge view replaces `GitMergeDialog`: item list, Yours | Result | Theirs, arrows, editable
  result, Monaco diff for long values, accept all yours/theirs, next/previous conflict.

## Phases

### M1 `merge-view/1-unrelated-join` (core + minimal UI hook)

- `connectRemote`: when the remote branch exists and shares no ancestor with HEAD, read the
  remote's `workspace.json`; same id → bind the remote and start a merge with **no base**
  (workspace `merging`), returning the status; different id or unreadable → refuse (new wording
  naming the other workspace when readable). A remote with branches but not ours is still refused.
- Sync-time unrelated remote (`mergeFetched`, `UNRELATED_REMOTE_MESSAGE`): same rule — same id
  starts the no-base merge; otherwise the existing error.
- Storage: a merge with no ancestor must be representable. Prefer making `base_commit` nullable
  in a new migration over a synthetic commit; decide by reading the code, justify in the PR.
- Engine: `mergeTree`/`mergeRecord` gain the two-way behaviour above when there is no base (pass
  it explicitly; do not infer from "base tree empty", since an ordinary three-way merge may have
  a base without a given record). Picks, resolve, abandon, notes and the merge commit (two
  parents: HEAD and the remote tip; pushed as a fast-forward of the remote) work unchanged.
- Abandon of a no-base connect-merge: the workspace stays connected? Decide: abandon must leave
  the workspace in a coherent state the user can recover from (likely: keep the binding, state
  `diverged` with a message saying Sync now merges again, mirroring today's abandon). Justify.
- UI: after Connect resolves with `state === "merging"`, open the existing merge dialog; the
  dialog's intro copy says when the two copies have no shared history. Tests.

### M2 `merge-view/2-own-values` (core + shared + IPC)

- `GitMergePick` can carry an own value instead of a side (a discriminated union; one type per
  file). Stored with the other picks (migration). The resolve request and `mergePicks` read
  carry it. Validation: the merged record must canonicalize, path must name a conflict, and the
  value must pass `assertNoSecretValues`; failures are a plain sentence.
- No UI yet beyond what keeps the existing dialog working.

### M3 `merge-view/3-merge-view` (UI)

- Replace `GitMergeDialog` with the new view (large modal or full-window route — decide from
  `apiweave-context.md` / `DESIGN.md`): left list of conflicted items grouped by kind with
  resolved/unresolved markers and counts; main area with rows per conflicting field: Yours |
  Result | Theirs, `»`/`«` arrows taking a side into Result, Result editable (JSON-aware input
  for scalars, Monaco for long strings/objects such as bodies and scripts), Monaco DiffEditor
  for comparing long values; accept yours/theirs per item and for all; next/previous conflict
  (buttons + keyboard); a count of what merged on its own; Finish / Abandon as today.
- Accessible (labels, `aria-pressed`, focus order), tokens not hex, existing atoms.

### M4 `merge-view/4-docs`

- Tutorial lesson on merging (version-history chapter), `docs/guides/git-workflows.md`,
  CHANGELOG `[Unreleased]`.
