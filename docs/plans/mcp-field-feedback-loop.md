# MCP field feedback loop

How problems that coding agents run into while building real test suites over
the APIWeave MCP server become fixes, one pull request at a time.

## Why

Agents that build browser and API workflows against a large, real application
hit problems no unit test catches: tools that accept a broken graph, placeholders
that silently resolve to nothing, evidence that hides the page they need, guides
that leave out the one rule that matters. They write these problems down as they
go. This loop turns those notes into tracked issues, fixes them in this
repository, and feeds the result back to the agents.

## The inputs

Two notes files are kept by the agents in the application's repository, outside
this one. They are **private working notes**: they name a real application, its
hosts, its test data and its records, so they are never copied into this
repository, staged, committed or pushed.

| File | What it holds |
| --- | --- |
| MCP difficulties | Every problem an agent hit with the APIWeave MCP server, with the workaround it used, tagged `[bug]`, `[usability]` or `[missing feature]` and dated. Ends with a numbered list of suggested APIWeave improvements. |
| Target-app notes | Facts about the application under test: pages, locators, data rules, and the workflows built so far. Useful as evidence of *how* a tool was used; not a source of issues by itself. |

Both are linked into this worktree, read-only, under `docs/.scratch/field-notes/`
(ignored by git, see `.gitignore`):

```bash
mkdir -p docs/.scratch/field-notes
ln -sfn <path-to>/mcp-difficulties.md docs/.scratch/field-notes/mcp-difficulties.md
ln -sfn <path-to>/target-app-notes.md docs/.scratch/field-notes/target-app-notes.md
```

Symlinks, not copies: the agents keep editing the originals, and every triage
reads the current version.

## The tracker

[`mcp-field-feedback-plan.md`](mcp-field-feedback-plan.md) is the single list of
everything reported, with an ID per issue (`FB-001`, `FB-002`, …), its verdict,
root cause, planned fix, batch and state. It is written in **generic terms only**:

- Never name the application under test, its company, hosts, URLs, records,
  accounts or UI labels. Describe the pattern instead ("a custom select that
  wraps a hidden native `<select>` in a button", "a modal outside `main` with no
  `dialog` role").
- Reproductions use made-up data and neutral labels.
- The same rule applies to commit messages, PR titles and descriptions, test
  fixtures and code comments.

## One round

Each time the notes are updated:

1. **Diff the notes.** Compare the difficulties file against the tracker. New
   bullets, new dated sections and new numbered suggestions are candidates.
   Entries already in the tracker are only re-read if the agent added evidence.
2. **Triage each new entry against the code.** Investigation runs in parallel
   subagents, one per area (placeholders and Call Workflow, graph edits and
   revisions, inspection and evidence, browser actions and MCP surface). Each
   returns, per entry: a verdict, the root cause with `file:line`, the simplest
   long-term fix, the tests that pin it, and a size. Verdicts:
   - **bug** — the code does the wrong thing; fix it.
   - **gap** — works as designed, but an agent cannot learn the rule from the
     tool schema, error or guide; fix the error message, schema description or
     guide.
   - **feature** — a missing capability; plan it, or record why not.
   - **works** — already fixed or a misunderstanding; note the evidence and,
     if a guide misled the agent, treat it as a gap.
   - **external** — a property of the application under test or the network,
     not of APIWeave; record it and close it.
3. **Update the tracker.** Add each new entry with its ID, verdict and batch.
   Group fixes into batches that share a root cause or a file, so one PR closes
   several entries.
4. **Fix batch by batch on the tracking branch.** One long-lived branch carries
   the tracker and the fixes; each batch is its own commit (or a few), so a
   batch can be reviewed or reverted alone. After a round's PR merges, the
   branch is rebased on `main` for the next round. Follow `AGENTS.md`: no compatibility shims, repositories only for SQLite,
   handlers through the registry, strict TypeScript. Every bug gets a test that
   fails before the fix. A gap fix that changes `MCP_INSTRUCTIONS` must stay
   under its byte cap; prefer the tool's description, its error message or a
   guide.
5. **Verify.** From `app/`: `npm test`, `npm run typecheck`, `npm run lint`,
   `npm run build:app`. For MCP-facing changes, also exercise the tool through
   the running app's MCP bridge with a throwaway workflow in a scratch workspace.
6. **Open the PR.** One PR per round, from the tracking branch. Commits use
   conventional-commit titles (`fix(mcp): …`, `feat(runner): …`); the PR body
   lists the batches and the tracker IDs they close, written generically. The
   user reviews and merges.
7. **Close the loop.** Mark the entries `fixed in #<PR>` in the tracker. Tell the
   user which notes entries can now be rewritten as "fixed in APIWeave
   vX.Y.Z" in the agents' difficulties file; the agents' files are theirs to
   edit, so this loop never writes to them.

## Subagents

Triage and fixes are spread over several models so each area gets a fresh
context and the expensive models are kept for the hard parts:

| Work | Model |
| --- | --- |
| Runner semantics, placeholder resolution, cross-cutting design | Opus 5.5 |
| Browser executor, MCP tool surface, guides | Sonnet 5.5 |
| Inspection, evidence, redaction | GLM-5.3 |
| Graph-edit validation, diagnosis codes, mechanical fixes | DeepSeek Flash |

A subagent's report is a claim, not a result: the coordinator checks the
`file:line` references before an entry's verdict goes into the tracker, and
reviews every diff before it is committed.

## What never leaves this machine

- The notes files and anything under `docs/.scratch/`.
- Workspace, workflow, run and record IDs from the agents' sessions.
- Any value that came from the application under test.
