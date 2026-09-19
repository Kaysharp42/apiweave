# In-App Tutorials

*The bundled, offline learning library inside the APIWeave desktop app: how to open it, read and search lessons, track progress, follow along while you work, and how to add or correct a lesson.*

## Prerequisites

- The APIWeave desktop app is installed and open. See [Installation](../getting-started/installation.md).
- No account, upload, or network connection is required to read lessons. Lessons that call a public endpoint state that requirement themselves.

## Contents

- [Open the Tutorials](#open-the-tutorials)
- [Read and Search Lessons](#read-and-search-lessons)
- [Track Progress](#track-progress)
- [Follow Along](#follow-along)
- [Maintain the Curriculum](#maintain-the-curriculum)
- [Troubleshooting](#troubleshooting)
- [Related](#related)

## Open the Tutorials

The tutorial library is a route in the same shell as the canvas, so opening it never closes your workflow tab. There are three ways in.

### From the header

Click the book icon in the header, labelled **Tutorials**. The app navigates to the workspace-scoped route:

```text
/{orgSlug}/{workspaceSlug}/tutorials
```

For the personal workspace that is `/personal/personal/tutorials`. The header button is present on every workspace surface, including while a lesson is open.

### From an empty workspace

When no workflow tab is open, the canvas shows the workspace empty state. Its secondary action reads **Start tutorial** the first time, and **Continue tutorial** once any progress exists. Both open the library at the same scoped route.

### From the command palette

Open the command palette with **Ctrl+K** (the **Open command palette** control in the canvas toolbar also opens it). Search for any of `learn`, `guide`, `tour`, or `help`, or choose **Open tutorials** in the **Help** group. The command appears once the workflow has finished hydrating.

The library header shows the chapter outline, a search field, and the progress summary:

```text
Tutorials
Learn the workflow, one feature at a time.
0 of 24 completed
[ Search lessons... ]
```

## Read and Search Lessons

### Library and reader layout

The library groups lessons into seven chapters in reading order: First steps, Requests and data, Control flow, Debug and observe, Organize and reuse, Agents, and App. Each lesson shows its status and estimated duration. When you open a lesson, the article presents the outcome, prerequisites, numbered steps, an example, the expected result, troubleshooting, and related lessons.

The split between the outline and the article is based on the width of the tutorial container, not the viewport:

- At roughly 768px of available tutorial width or more, the outline stays beside the article.
- Below that, the article fills the view; the **All lessons** action returns to the outline, and the search query is preserved across the round trip.

Open a specific lesson directly by URL:

```text
/personal/personal/tutorials/variables-extractors
```

### Search behavior

Search is case-insensitive and matches across titles, summaries, feature keywords, outcomes, prerequisites, steps, examples, expected results, and troubleshooting entries. Results keep their chapter context so a match is still placed in the curriculum.

```text
Search: sse
1 lesson match "sse".
Control flow
  Listen to an SSE stream
```

When nothing matches, the library shows a no-results state with a **Clear search** action. Searching does not change which lessons are complete.

## Track Progress

### Complete a lesson

Completion is always explicit. At the end of an article, choose **Mark complete**; the badge flips to **Completed** and the header count increases. Choose **Mark not complete** to undo it. Nothing else — scrolling, opening a lesson, or following along — marks a lesson complete.

A worked round trip:

1. Open `/personal/personal/tutorials/variables-extractors`.
2. Choose **Mark complete**; the badge reads **Completed**.
3. Reload the window; the badge still reads **Completed** and the header count still includes the lesson.

The library shows a resume card once you have opened a lesson: **Start here** for the first incomplete lesson, **Continue where you left off** for the lesson you last read, and **You've finished every lesson** with a **Revisit lesson** action once all lessons are complete.

### Reset progress

At the bottom of a lesson article, choose **Reset progress**. A confirmation dialog explains that this clears every completed lesson and the resume position and does not touch your workflows. Confirm with **Reset**.

Progress is stored locally on this machine, separate from workflows and from Cloud sync. It is not written into a workflow, an export, or a sync payload.

## Follow Along

### How follow-along differs from reading

**Follow along** starts a practice session for a lesson and navigates back to the workspace, where the instructions float beside the canvas. Reading is independent: opening another lesson to consult it does not change or end the practice session, and the practice session has its own position in the lesson.

### Companion controls

One companion panel is mounted at a time. It shows the active lesson, the step count, the step title and instruction, the lesson-wide **Lesson result**, and these controls:

- **Previous** and **Next** move one step at a time. They never mark anything complete.
- **Full lesson** opens the lesson article while keeping the practice position.
- **Return to workspace** or **Back to workspace** closes the instructions view and reveals the workspace.
- **Close follow-along** ends the session.
- On the final step the primary action becomes **Mark lesson complete**; after completion it becomes **Next lesson**.

The practised lesson and step are persisted, so reopening the app can resume where you stopped. The companion does not reopen automatically at startup.

### Wide and compact layouts

- On a wide main content region, the companion is a floating panel in the lower-left, leaving the canvas and the right inspector usable.
- On a narrow region it starts as a resume strip. Expanding it covers the content area on request; the covered content is made inert while open, so keyboard and pointer input stay inside the instructions. The compact view keeps an explicit **Back to workspace** action.

Escape collapses the companion only while focus is inside it, so it never competes with the terminal, an editor, or a dialog.

The panel reads:

```text
Follow along
Build and run your first workflow
Step 1 of 9
Create a new workflow
Lesson result
[Previous] [Next]
```

### Cloud and other full-screen destinations

A lesson's **Go to** link is a router link, not a document anchor. Most destinations resolve to a workspace-scoped route and keep the companion visible. **Cloud Sync** is different: it is a global route outside the main shell. Following it pauses the companion, and returning to the workspace does not reopen it automatically — start the practice again from the lesson or the library.

## Maintain the Curriculum

All lesson content ships in the renderer bundle under `app/src/constants/tutorials/`, split into one file per chapter. The example that follows is the shape every lesson uses.

```json
{
  "id": "variables-extractors",
  "chapterId": "requests-and-data",
  "title": "Chain requests with extracted data",
  "summary": "Capture a value from a response and reuse it downstream.",
  "outcome": "A second request uses a value extracted from the first response.",
  "keywords": ["extractor", "variable", "chain"],
  "durationMinutes": 5,
  "requiresNetwork": false,
  "prerequisites": ["A workflow with one HTTP request."],
  "steps": [
    { "title": "Add a variable", "instruction": "Open the Variables panel and add a name." }
  ],
  "example": { "caption": "Reference the value", "language": "text", "code": "{{variables.token}}" },
  "expectedResult": "The second request sends the extracted value.",
  "troubleshooting": [{ "title": "The value is empty", "instruction": "Confirm the extractor ran first." }],
  "relatedLessonIds": ["http-requests"]
}
```

### Add or correct a lesson

1. Add the lesson to the chapter file it belongs to, or create a new chapter file and register it in `curriculum.ts`.
2. Give it a unique, stable `id`. Ids are persisted with progress and embedded in `/tutorials/:lessonId` links, so renaming one strands a reader's progress and breaks bookmarks. Correct wording instead of renaming an id.
3. Fill every field. The curriculum tests require a chapter, title, summary, outcome, at least five steps, at least one troubleshooting entry, and an example.
4. Add `keywords` for the words a user is likely to search. Search looks inside the text of each field, so a missing keyword means the lesson may not surface for that term.
5. If the lesson links to a destination, use one of the verified destination paths resolved by `tutorialDestinationHref`; do not invent a route.

### Search and index

`curriculum.ts` aggregates the chapters into `TUTORIAL_CHAPTERS` and `TUTORIAL_LESSONS`, and derives the search index, id lookup, chapter lookup, and href builders from them. There is no separate index file to update: adding a lesson to a registered chapter is enough for search, direct links, and related-lesson titles.

### Schema-validated examples

Structured examples (JSON a reader is expected to paste) are validated against the schemas the app actually ships. A malformed example fails the test suite rather than shipping. When you change a schema, update the matching tutorial example and the content-example test together.

### Verify with tests

Keep the behavior protected without duplicating lesson prose. Run the tutorial-focused checks:

```bash
cd app
npm test -- src/constants/tutorials src/pages/TutorialPage.test.tsx src/components/TutorialCompanion.test.tsx
npm run typecheck
npm run lint
npx playwright test e2e/tutorial.spec.ts --workers=1
```

The Playwright flow boots the renderer on the mocked desktop IPC bridge and covers the library, search, marking complete across a reload, the follow-along companion, and returning to a mounted canvas.

## Troubleshooting

- **If a lesson describes a control that is not on screen**, verify the visible label against the editor or route it references and correct the bundled content.
- **If search does not find a topic**, add the term to that lesson's `keywords` array rather than only mentioning it in prose.
- **If a reader's progress disappears**, a lesson id was renamed or removed; restore the id or accept that the sanitizer drops unknown ids.
- **If a follow-along step jumps or restarts**, check the researched lesson and step stored locally; the companion clamps the step to the lesson's current bounds.
- **If a structured example fails its test**, correct the example to the shipped schema, or update the schema and the example together.
- **If the compact companion covers the workspace unexpectedly**, collapse it with Escape or **Back to workspace**; it only expands on an explicit request.

## Related

- [Workflows and Nodes](workflows-and-nodes.md)
- [Variables and Extractors](variables-and-extractors.md)
- [Documentation Hub](../README.md)
